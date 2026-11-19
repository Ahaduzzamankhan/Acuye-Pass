use serde::{Deserialize, Serialize};

use crate::error::{AcuyeError, Result};
use crate::time::{now, Timestamp};

pub const MAX_TITLE_LEN: usize = 256;
pub const MAX_NOTES_LEN: usize = 100_000;
pub const MAX_TAGS: usize = 32;
pub const MAX_TAG_LEN: usize = 64;
pub const MAX_CUSTOM_FIELDS: usize = 100;

/// Vault item categories. These mirror the sidebar filters in the desktop UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ItemType {
    Login,
    SecureNote,
    Card,
    Identity,
    Document,
    Custom,
}

impl ItemType {
    pub fn label(self) -> &'static str {
        match self {
            Self::Login => "Password",
            Self::SecureNote => "Secure Note",
            Self::Card => "Card",
            Self::Identity => "Identity",
            Self::Document => "Document",
            Self::Custom => "Custom",
        }
    }

    pub fn all() -> [ItemType; 6] {
        [
            Self::Login,
            Self::SecureNote,
            Self::Card,
            Self::Identity,
            Self::Document,
            Self::Custom,
        ]
    }
}

/// A user defined label/value pair used by custom items.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CustomField {
    pub label: String,
    pub value: String,
    #[serde(default)]
    pub concealed: bool,
}

/// Type specific payload. The `kind` tag is stable on disk and over the wire;
/// change it only with a documented protocol/format version bump.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ItemFields {
    Login {
        #[serde(default)]
        username: String,
        #[serde(default)]
        password: String,
        #[serde(default)]
        url: String,
        #[serde(default)]
        totp: String,
        /// When the password itself last changed. Used by the Security Center.
        #[serde(default)]
        password_changed_at: Option<Timestamp>,
    },
    SecureNote {},
    Card {
        #[serde(default)]
        cardholder: String,
        #[serde(default)]
        number: String,
        #[serde(default)]
        expiry_month: String,
        #[serde(default)]
        expiry_year: String,
        #[serde(default)]
        cvv: String,
        #[serde(default)]
        brand: String,
        #[serde(default)]
        pin: String,
    },
    Identity {
        #[serde(default)]
        first_name: String,
        #[serde(default)]
        last_name: String,
        #[serde(default)]
        email: String,
        #[serde(default)]
        phone: String,
        #[serde(default)]
        address: String,
        #[serde(default)]
        city: String,
        #[serde(default)]
        state: String,
        #[serde(default)]
        postal_code: String,
        #[serde(default)]
        country: String,
        #[serde(default)]
        company: String,
    },
    Document {
        #[serde(default)]
        filename: String,
        #[serde(default)]
        mime_type: String,
        #[serde(default)]
        size_bytes: u64,
        #[serde(default)]
        sha256: String,
    },
    Custom {
        #[serde(default)]
        fields: Vec<CustomField>,
    },
}

impl ItemFields {
    pub fn kind(&self) -> ItemType {
        match self {
            Self::Login { .. } => ItemType::Login,
            Self::SecureNote {} => ItemType::SecureNote,
            Self::Card { .. } => ItemType::Card,
            Self::Identity { .. } => ItemType::Identity,
            Self::Document { .. } => ItemType::Document,
            Self::Custom { .. } => ItemType::Custom,
        }
    }

    pub fn empty(kind: ItemType) -> Self {
        match kind {
            ItemType::Login => Self::Login {
                username: String::new(),
                password: String::new(),
                url: String::new(),
                totp: String::new(),
                password_changed_at: None,
            },
            ItemType::SecureNote => Self::SecureNote {},
            ItemType::Card => Self::Card {
                cardholder: String::new(),
                number: String::new(),
                expiry_month: String::new(),
                expiry_year: String::new(),
                cvv: String::new(),
                brand: String::new(),
                pin: String::new(),
            },
            ItemType::Identity => Self::Identity {
                first_name: String::new(),
                last_name: String::new(),
                email: String::new(),
                phone: String::new(),
                address: String::new(),
                city: String::new(),
                state: String::new(),
                postal_code: String::new(),
                country: String::new(),
                company: String::new(),
            },
            ItemType::Document => Self::Document {
                filename: String::new(),
                mime_type: String::new(),
                size_bytes: 0,
                sha256: String::new(),
            },
            ItemType::Custom => Self::Custom { fields: Vec::new() },
        }
    }

    /// Password used by the Security Center. `None` for non-login items.
    pub fn password(&self) -> Option<&str> {
        match self {
            Self::Login { password, .. } => Some(password.as_str()),
            _ => None,
        }
    }
}

/// A decrypted vault item. Only ever serialized after explicit user action
/// (detail view, export) — never written to disk in this shape.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Item {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub favorite: bool,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    #[serde(flatten)]
    pub fields: ItemFields,
}

/// Non-sensitive projection of an item used by list views.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ItemSummary {
    pub id: String,
    pub title: String,
    pub item_type: ItemType,
    pub subtitle: String,
    pub favorite: bool,
    pub tags: Vec<String>,
    pub updated_at: Timestamp,
    /// Domain (never the full URL) used for the generated initials avatar.
    pub host: String,
    pub has_password: bool,
}

impl Item {
    pub fn new(fields: ItemFields, title: impl Into<String>) -> Self {
        let ts = now();
        let mut item = Self {
            id: uuid::Uuid::new_v4().to_string(),
            title: title.into(),
            notes: String::new(),
            tags: Vec::new(),
            favorite: false,
            created_at: ts,
            updated_at: ts,
            fields,
        };
        if let ItemFields::Login {
            password_changed_at,
            password,
            ..
        } = &mut item.fields
        {
            if !password.is_empty() {
                *password_changed_at = Some(ts);
            }
        }
        item
    }

    pub fn item_type(&self) -> ItemType {
        self.fields.kind()
    }

    /// Field used as the list subtitle (never contains the password).
    pub fn subtitle(&self) -> String {
        match &self.fields {
            ItemFields::Login { username, url, .. } => {
                if !username.is_empty() {
                    username.clone()
                } else {
                    host_of(url)
                }
            }
            ItemFields::Card {
                cardholder, brand, ..
            } => {
                if !brand.is_empty() {
                    brand.clone()
                } else {
                    cardholder.clone()
                }
            }
            ItemFields::Identity {
                email,
                first_name,
                last_name,
                ..
            } => {
                if !email.is_empty() {
                    email.clone()
                } else {
                    format!("{first_name} {last_name}").trim().to_string()
                }
            }
            ItemFields::Document { filename, .. } => filename.clone(),
            ItemFields::Custom { fields } => {
                fields.first().map(|f| f.label.clone()).unwrap_or_default()
            }
            ItemFields::SecureNote {} => String::new(),
        }
    }

    pub fn host(&self) -> String {
        match &self.fields {
            ItemFields::Login { url, .. } => host_of(url),
            _ => String::new(),
        }
    }

    pub fn normalize(&mut self) {
        self.title = self.title.trim().to_string();
        self.tags = self
            .tags
            .iter()
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .collect();
        self.tags.sort();
        self.tags.dedup();
    }

    pub fn validate(&self) -> Result<()> {
        if self.title.trim().is_empty() {
            return Err(AcuyeError::Validation("A title is required".into()));
        }
        if self.title.chars().count() > MAX_TITLE_LEN {
            return Err(AcuyeError::Validation("Title is too long".into()));
        }
        if self.notes.chars().count() > MAX_NOTES_LEN {
            return Err(AcuyeError::Validation("Notes are too long".into()));
        }
        if self.tags.len() > MAX_TAGS {
            return Err(AcuyeError::Validation("Too many tags".into()));
        }
        if self.tags.iter().any(|t| t.chars().count() > MAX_TAG_LEN) {
            return Err(AcuyeError::Validation("A tag is too long".into()));
        }
        if let ItemFields::Custom { fields } = &self.fields {
            if fields.len() > MAX_CUSTOM_FIELDS {
                return Err(AcuyeError::Validation("Too many custom fields".into()));
            }
        }
        if let ItemFields::Login { url, .. } = &self.fields {
            if !url.is_empty() && url.chars().count() > 2048 {
                return Err(AcuyeError::Validation("Website URL is too long".into()));
            }
        }
        Ok(())
    }

    pub fn summary(&self) -> ItemSummary {
        ItemSummary {
            id: self.id.clone(),
            title: self.title.clone(),
            item_type: self.item_type(),
            subtitle: self.subtitle(),
            favorite: self.favorite,
            tags: self.tags.clone(),
            updated_at: self.updated_at,
            host: self.host(),
            has_password: self
                .fields
                .password()
                .map(|p| !p.is_empty())
                .unwrap_or(false),
        }
    }
}

/// Lowercased host of a user supplied URL, tolerating missing schemes.
pub fn host_of(url: &str) -> String {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let after_scheme = with_scheme.split_once("://").map(|x| x.1).unwrap_or("");
    let authority = after_scheme
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("")
        .rsplit('@')
        .next()
        .unwrap_or("");
    let host = authority.split(':').next().unwrap_or("");
    host.trim_start_matches("www.").to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn login() -> Item {
        let mut item = Item::new(
            ItemFields::Login {
                username: "ada@example.com".into(),
                password: "correct horse battery staple".into(),
                url: "https://github.com/login".into(),
                totp: String::new(),
                password_changed_at: None,
            },
            "GitHub",
        );
        item.tags = vec![" work ".into(), "work".into(), "".into()];
        item
    }

    #[test]
    fn host_parsing_handles_missing_scheme_and_ports() {
        assert_eq!(host_of("example.com/path"), "example.com");
        assert_eq!(host_of("https://www.example.com:8443/x"), "example.com");
        assert_eq!(host_of("https://user:pass@example.com/x"), "example.com");
        assert_eq!(host_of(""), "");
    }

    #[test]
    fn validation_rejects_blank_title() {
        let mut item = login();
        item.title = "   ".into();
        assert!(item.validate().is_err());
    }

    #[test]
    fn normalization_trims_and_dedupes_tags() {
        let mut item = login();
        item.normalize();
        assert_eq!(item.tags, vec!["work".to_string()]);
    }

    #[test]
    fn summary_never_contains_password() {
        let item = login();
        let json = serde_json::to_string(&item.summary()).unwrap();
        assert!(!json.contains("correct horse"));
        assert_eq!(item.summary().host, "github.com");
        assert!(item.summary().has_password);
    }

    #[test]
    fn fields_roundtrip_through_json() {
        let item = login();
        let raw = serde_json::to_string(&item).unwrap();
        let back: Item = serde_json::from_str(&raw).unwrap();
        assert_eq!(item, back);
        assert_eq!(back.item_type(), ItemType::Login);
    }
}
