//! Vault business logic: item management, in-memory search, local security
//! analysis and the item encryption codec.
//!
//! The vault only exists decrypted in memory while a session is unlocked. On
//! disk every item is an XChaCha20-Poly1305 ciphertext bound (AAD) to its vault
//! and item id, so ciphertexts cannot be moved between items or vaults.

use std::collections::HashMap;

use acuye_core::time::Timestamp;
use acuye_core::{AcuyeError, CustomField, Item, ItemFields, ItemSummary, ItemType, Result};
use acuye_crypto::{open, seal, Sealed, SecretKey};
use serde::{Deserialize, Serialize};

pub const DEFAULT_VAULT_NAME: &str = "Personal";
pub const OLD_PASSWORD_DAYS: i64 = 365;

pub mod codec {
    //! Item <-> ciphertext helpers.

    use super::*;

    fn aad(vault_id: &str, item_id: &str) -> Vec<u8> {
        format!("acuye:item:{vault_id}:{item_id}").into_bytes()
    }

    /// Serialize and encrypt one item.
    pub fn encrypt_item(key: &SecretKey, vault_id: &str, item: &Item) -> Result<Sealed> {
        let plaintext = serde_json::to_vec(item)?;
        seal(key, &aad(vault_id, &item.id), &plaintext)
    }

    /// Decrypt and deserialize one item. Fails closed on tampering.
    pub fn decrypt_item(
        key: &SecretKey,
        vault_id: &str,
        item_id: &str,
        sealed: &Sealed,
    ) -> Result<Item> {
        let plaintext = open(key, &aad(vault_id, item_id), sealed)?;
        let item: Item = serde_json::from_slice(&plaintext).map_err(|_| AcuyeError::Format)?;
        if item.id != item_id {
            return Err(AcuyeError::Crypto);
        }
        Ok(item)
    }
}

/// Decrypted vault contents. Lives only in backend memory while unlocked.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Vault {
    pub id: String,
    pub name: String,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub items: Vec<Item>,
}

impl Vault {
    pub fn new(name: impl Into<String>) -> Self {
        let ts = acuye_core::time::now();
        let name = name.into();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name: if name.trim().is_empty() {
                DEFAULT_VAULT_NAME.to_string()
            } else {
                name.trim().to_string()
            },
            created_at: ts,
            updated_at: ts,
            items: Vec::new(),
        }
    }

    pub fn restore(id: impl Into<String>, name: impl Into<String>, created_at: Timestamp) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            created_at,
            updated_at: created_at,
            items: Vec::new(),
        }
    }

    fn touch(&mut self) {
        self.updated_at = acuye_core::time::now();
    }

    pub fn get(&self, id: &str) -> Option<&Item> {
        self.items.iter().find(|i| i.id == id)
    }

    pub fn add(&mut self, mut item: Item) -> Result<Item> {
        item.normalize();
        item.validate()?;
        if self.items.iter().any(|i| i.id == item.id) {
            return Err(AcuyeError::Conflict("item already exists".into()));
        }
        self.items.push(item.clone());
        self.touch();
        Ok(item)
    }

    pub fn update(&mut self, mut item: Item) -> Result<Item> {
        item.normalize();
        item.validate()?;
        let existing = self
            .items
            .iter_mut()
            .find(|i| i.id == item.id)
            .ok_or_else(|| AcuyeError::NotFound("item".into()))?;

        // Preserve creation time and track password age independently of
        // cosmetic edits (title, notes, tags).
        item.created_at = existing.created_at;
        item.updated_at = acuye_core::time::now();
        if let (
            ItemFields::Login {
                password: new_pw,
                password_changed_at,
                ..
            },
            ItemFields::Login {
                password: old_pw,
                password_changed_at: old_changed,
                ..
            },
        ) = (&mut item.fields, &existing.fields)
        {
            if !new_pw.is_empty() && new_pw != old_pw {
                *password_changed_at = Some(acuye_core::time::now());
            } else {
                *password_changed_at = *old_changed;
            }
        }
        *existing = item.clone();
        self.touch();
        Ok(item)
    }

    pub fn delete(&mut self, id: &str) -> Result<Item> {
        let pos = self
            .items
            .iter()
            .position(|i| i.id == id)
            .ok_or_else(|| AcuyeError::NotFound("item".into()))?;
        let removed = self.items.remove(pos);
        self.touch();
        Ok(removed)
    }

    pub fn duplicate(&mut self, id: &str) -> Result<Item> {
        let source = self
            .get(id)
            .cloned()
            .ok_or_else(|| AcuyeError::NotFound("item".into()))?;
        let ts = acuye_core::time::now();
        let mut copy = source;
        copy.id = uuid::Uuid::new_v4().to_string();
        // Keep the copy inside the title limit: a duplicated item that fails
        // validation could never be edited again.
        const SUFFIX: &str = " (copy)";
        let base: String = copy
            .title
            .chars()
            .take(acuye_core::item::MAX_TITLE_LEN - SUFFIX.chars().count())
            .collect();
        copy.title = format!("{}{SUFFIX}", base.trim_end());
        copy.favorite = false;
        copy.created_at = ts;
        copy.updated_at = ts;
        copy.normalize();
        copy.validate()?;
        self.items.push(copy.clone());
        self.touch();
        Ok(copy)
    }

    pub fn toggle_favorite(&mut self, id: &str) -> Result<Item> {
        let item = self
            .items
            .iter_mut()
            .find(|i| i.id == id)
            .ok_or_else(|| AcuyeError::NotFound("item".into()))?;
        item.favorite = !item.favorite;
        item.updated_at = acuye_core::time::now();
        let out = item.clone();
        self.touch();
        Ok(out)
    }

    pub fn summaries(&self) -> Vec<ItemSummary> {
        let mut out: Vec<ItemSummary> = self.items.iter().map(Item::summary).collect();
        sort_summaries(&mut out);
        out
    }

    /// Search titles, usernames, URLs, tags and notes. Passwords are never
    /// searched so their contents cannot be probed from the UI.
    pub fn search(
        &self,
        query: &str,
        kind: Option<ItemType>,
        favorites_only: bool,
    ) -> Vec<ItemSummary> {
        let q = query.trim().to_lowercase();
        let mut out: Vec<ItemSummary> = self
            .items
            .iter()
            .filter(|item| kind.map(|k| item.item_type() == k).unwrap_or(true))
            .filter(|item| !favorites_only || item.favorite)
            .filter(|item| {
                if q.is_empty() {
                    return true;
                }
                let mut haystack =
                    format!("{} {} {}", item.title, item.subtitle(), item.tags.join(" "))
                        .to_lowercase();
                if !item.notes.is_empty() {
                    haystack.push(' ');
                    haystack.push_str(&item.notes.to_lowercase());
                }
                if let ItemFields::Login { url, username, .. } = &item.fields {
                    haystack.push(' ');
                    haystack.push_str(&url.to_lowercase());
                    haystack.push(' ');
                    haystack.push_str(&username.to_lowercase());
                }
                haystack.contains(&q)
            })
            .map(Item::summary)
            .collect();
        sort_summaries(&mut out);
        out
    }

    pub fn count(&self, kind: ItemType) -> usize {
        self.items.iter().filter(|i| i.item_type() == kind).count()
    }

    pub fn favorites_count(&self) -> usize {
        self.items.iter().filter(|i| i.favorite).count()
    }

    /// Local-only security analysis. No password ever leaves the device and no
    /// breach service is contacted.
    pub fn security_report(&self) -> SecurityReport {
        let mut weak = 0usize;
        let mut old = 0usize;
        let mut empty = 0usize;
        let mut reused = 0usize;
        let mut issues: Vec<VaultSecurityItem> = Vec::new();
        let mut password_groups: HashMap<&str, Vec<&Item>> = HashMap::new();

        for item in &self.items {
            let Some(password) = item.fields.password() else {
                continue;
            };
            if password.is_empty() {
                empty += 1;
                issues.push(VaultSecurityItem {
                    item_id: item.id.clone(),
                    title: item.title.clone(),
                    issue: SecurityIssueKind::EmptyPassword,
                    detail: "This login has no password stored.".into(),
                });
                continue;
            }
            password_groups.entry(password).or_default().push(item);

            let bits = acuye_generator::strength::entropy_bits(password);
            if bits < 60.0 {
                weak += 1;
                issues.push(VaultSecurityItem {
                    item_id: item.id.clone(),
                    title: item.title.clone(),
                    issue: SecurityIssueKind::WeakPassword,
                    detail: format!("Estimated strength is {} bits.", bits.round() as u64),
                });
            }

            let changed_at = match &item.fields {
                ItemFields::Login {
                    password_changed_at,
                    ..
                } => password_changed_at.unwrap_or(item.updated_at),
                _ => item.updated_at,
            };
            let age_days = (acuye_core::time::now() - changed_at).max(0) / 86_400;
            if age_days >= OLD_PASSWORD_DAYS {
                old += 1;
                issues.push(VaultSecurityItem {
                    item_id: item.id.clone(),
                    title: item.title.clone(),
                    issue: SecurityIssueKind::OldPassword,
                    detail: format!("Password unchanged for {age_days} days."),
                });
            }
        }

        for items in password_groups.values().filter(|items| items.len() > 1) {
            reused += items.len();
            for item in items {
                issues.push(VaultSecurityItem {
                    item_id: item.id.clone(),
                    title: item.title.clone(),
                    issue: SecurityIssueKind::ReusedPassword,
                    detail: format!("Shared by {} items.", items.len()),
                });
            }
        }

        issues.sort_by_key(|a| a.title.to_lowercase());
        let logins = self.count(ItemType::Login);
        let penalty =
            (weak as i64 * 6 + reused as i64 * 8 + old as i64 * 3 + empty as i64 * 10).min(100);
        let score = if logins == 0 {
            100
        } else {
            (100 - penalty).max(0) as u8
        };

        SecurityReport {
            total_items: self.items.len(),
            login_items: logins,
            weak,
            reused,
            old,
            empty,
            score,
            issues,
            scanned_at: acuye_core::time::now(),
        }
    }
}

fn sort_summaries(items: &mut [ItemSummary]) {
    items.sort_by(|a, b| {
        b.favorite
            .cmp(&a.favorite)
            .then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase()))
    });
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SecurityIssueKind {
    WeakPassword,
    ReusedPassword,
    OldPassword,
    EmptyPassword,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VaultSecurityItem {
    pub item_id: String,
    pub title: String,
    pub issue: SecurityIssueKind,
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SecurityReport {
    pub total_items: usize,
    pub login_items: usize,
    pub weak: usize,
    pub reused: usize,
    pub old: usize,
    pub empty: usize,
    /// 0-100 local hygiene score. Not an audit result.
    pub score: u8,
    pub issues: Vec<VaultSecurityItem>,
    pub scanned_at: Timestamp,
}

/// Parse a vault from a previously encrypted item set.
pub fn decrypt_all(
    key: &SecretKey,
    vault: &mut Vault,
    stored: impl IntoIterator<Item = (String, Sealed)>,
) -> Result<()> {
    let mut items = Vec::new();
    for (item_id, sealed) in stored {
        items.push(codec::decrypt_item(key, &vault.id, &item_id, &sealed)?);
    }
    vault.items = items;
    Ok(())
}

/// Convenience: an empty custom item, used by the "Custom Item" importer.
pub fn empty_custom_fields() -> Vec<CustomField> {
    vec![CustomField {
        label: "Field".into(),
        value: String::new(),
        concealed: false,
    }]
}

#[cfg(test)]
mod tests {
    use super::*;
    use acuye_core::time::now;

    fn login(title: &str, password: &str) -> Item {
        Item::new(
            ItemFields::Login {
                username: "user".into(),
                password: password.into(),
                url: "https://example.com".into(),
                totp: String::new(),
                password_changed_at: None,
            },
            title,
        )
    }

    #[test]
    fn item_crud_updates_timestamps_and_vault() {
        let mut vault = Vault::new("Personal");
        let item = vault.add(login("Mail", "s3cure-Passphrase-99")).unwrap();
        assert_eq!(vault.items.len(), 1);
        assert!(vault.updated_at >= vault.created_at);

        let mut edited = item.clone();
        edited.title = "Mailbox".into();
        vault.update(edited).unwrap();
        assert_eq!(vault.get(&item.id).unwrap().title, "Mailbox");
        assert_eq!(vault.get(&item.id).unwrap().created_at, item.created_at);

        let copy = vault.duplicate(&item.id).unwrap();
        assert_ne!(copy.id, item.id);
        assert_eq!(vault.items.len(), 2);

        vault.toggle_favorite(&item.id).unwrap();
        assert_eq!(vault.favorites_count(), 1);

        vault.delete(&item.id).unwrap();
        assert!(vault.get(&item.id).is_none());
        assert!(vault.delete(&item.id).is_err());
        assert!(vault.update(login("x", "y")).is_err());
    }

    #[test]
    fn duplicate_keeps_the_title_within_limits() {
        let mut vault = Vault::new("Personal");
        let long = "T".repeat(acuye_core::item::MAX_TITLE_LEN);
        let item = vault.add(login(&long, "password-aaaaaaaaaa")).unwrap();
        let copy = vault.duplicate(&item.id).unwrap();
        assert!(copy.title.chars().count() <= acuye_core::item::MAX_TITLE_LEN);
        assert!(copy.title.ends_with(" (copy)"));
        assert!(copy.validate().is_ok());

        // A duplicated item must still be editable afterwards.
        let mut edited = copy.clone();
        edited.title = "Renamed".into();
        assert!(vault.update(edited).is_ok());
    }

    #[test]
    fn search_filters_and_never_matches_password() {
        let mut vault = Vault::new("Personal");
        vault.add(login("GitHub", "hunter2-secret")).unwrap();
        let mut note = Item::new(ItemFields::SecureNote {}, "Wifi codes");
        note.notes = "rooftop antenna".into();
        note.tags = vec!["home".into()];
        vault.add(note).unwrap();

        assert_eq!(vault.search("github", None, false).len(), 1);
        assert_eq!(vault.search("rooftop", None, false).len(), 1);
        assert_eq!(vault.search("home", None, false).len(), 1);
        assert_eq!(vault.search("hunter2", None, false).len(), 0);
        assert_eq!(vault.search("", Some(ItemType::Login), false).len(), 1);
        assert_eq!(vault.search("", None, true).len(), 0);
    }

    #[test]
    fn security_report_detects_weak_reused_and_empty() {
        let mut vault = Vault::new("Personal");
        vault.add(login("A", "abc")).unwrap();
        vault.add(login("B", "abc")).unwrap();
        vault.add(login("C", "ZX9!vQ2#tR7$kL4&mN8*")).unwrap();
        vault.add(login("D", "")).unwrap();

        let report = vault.security_report();
        assert_eq!(report.empty, 1);
        assert_eq!(report.weak, 2);
        assert_eq!(report.reused, 2);
        assert!(report.score < 100);
        assert!(report.issues.len() >= 4);
    }

    #[test]
    fn password_age_detection() {
        let mut vault = Vault::new("Personal");
        let mut item = login("Old", "ZX9!vQ2#tR7$kL4&mN8*");
        if let ItemFields::Login {
            password_changed_at,
            ..
        } = &mut item.fields
        {
            *password_changed_at = Some(now() - (OLD_PASSWORD_DAYS + 5) * 86_400);
        }
        vault.add(item).unwrap();
        assert_eq!(vault.security_report().old, 1);
    }

    #[test]
    fn item_encryption_binds_to_vault_and_id() {
        let key = SecretKey::generate();
        let item = login("Mail", "super-secret-password");
        let sealed = codec::encrypt_item(&key, "vault-1", &item).unwrap();
        let raw = String::from_utf8_lossy(&sealed.ciphertext);
        assert!(!raw.contains("super-secret-password"));

        let back = codec::decrypt_item(&key, "vault-1", &item.id, &sealed).unwrap();
        assert_eq!(back, item);

        assert!(codec::decrypt_item(&key, "vault-2", &item.id, &sealed).is_err());
        assert!(codec::decrypt_item(&key, "vault-1", "other-id", &sealed).is_err());
        assert!(codec::decrypt_item(&SecretKey::generate(), "vault-1", &item.id, &sealed).is_err());
    }

    #[test]
    fn decrypt_all_rejects_one_tampered_item() {
        let key = SecretKey::generate();
        let mut vault = Vault::new("Personal");
        vault.add(login("A", "password-aaaaaaaaaa")).unwrap();
        vault.add(login("B", "password-bbbbbbbbbb")).unwrap();

        let stored: Vec<(String, Sealed)> = vault
            .items
            .iter()
            .map(|i| {
                (
                    i.id.clone(),
                    codec::encrypt_item(&key, &vault.id, i).unwrap(),
                )
            })
            .collect();
        let mut tampered = stored.clone();
        tampered[1].1.ciphertext[3] ^= 0x10;

        let mut target = Vault::restore(vault.id.clone(), vault.name.clone(), vault.created_at);
        assert!(decrypt_all(&key, &mut target, tampered).is_err());

        let mut good = Vault::restore(vault.id.clone(), vault.name.clone(), vault.created_at);
        decrypt_all(&key, &mut good, stored).unwrap();
        assert_eq!(good.items.len(), 2);
    }

    #[test]
    fn updating_password_refreshes_password_age() {
        let mut vault = Vault::new("Personal");
        let mut item = login("Mail", "old-password-12345");
        if let ItemFields::Login {
            password_changed_at,
            ..
        } = &mut item.fields
        {
            *password_changed_at = Some(1);
        }
        let stored = vault.add(item).unwrap();
        let mut changed = stored.clone();
        if let ItemFields::Login { password, .. } = &mut changed.fields {
            *password = "new-password-67890".into();
        }
        let updated = vault.update(changed).unwrap();
        if let ItemFields::Login {
            password_changed_at,
            ..
        } = updated.fields
        {
            assert!(password_changed_at.unwrap() > 1);
        }
    }
}
