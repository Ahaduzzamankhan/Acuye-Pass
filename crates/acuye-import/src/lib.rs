//! Import from other password managers.
//!
//! Supported formats:
//! * Acuye Pass JSON export (array of items);
//! * Bitwarden JSON export;
//! * Bitwarden CSV;
//! * Google Chrome / Edge CSV (`name,url,username,password,note`);
//! * 1Password CSV (`Title,Url,Username,Password,OTPAuth`);
//! * generic CSV with title/username/password/url headers.
//!
//! Import is pure: parsed items are returned to the caller, which asks the
//! user to confirm before anything is written to the vault.

use acuye_core::{AcuyeError, Item, ItemFields, ItemType, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportFormat {
    AcuyeJson,
    BitwardenJson,
    BitwardenCsv,
    ChromeCsv,
    OnePasswordCsv,
    GenericCsv,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParsedImport {
    pub format: ImportFormat,
    pub items: Vec<Item>,
    pub skipped: usize,
    pub warnings: Vec<String>,
}

/// Detect the format from the payload itself; never trusts a file extension.
pub fn detect_format(payload: &str) -> ImportFormat {
    let trimmed = payload.trim_start();
    if trimmed.starts_with('[') || trimmed.starts_with('{') {
        if trimmed.contains("\"encrypted\"") && trimmed.contains("\"ciphertext\"") {
            return ImportFormat::AcuyeJson;
        }
        if trimmed.contains("\"login\"") || trimmed.contains("\"items\"") {
            return ImportFormat::BitwardenJson;
        }
        return ImportFormat::AcuyeJson;
    }
    let header = trimmed.lines().next().unwrap_or("").to_lowercase();
    if header.contains("login_password") || header.contains("login_uri") {
        ImportFormat::BitwardenCsv
    } else if header.starts_with("title,url,username,password") {
        ImportFormat::OnePasswordCsv
    } else if header.starts_with("name,url,username,password") {
        ImportFormat::ChromeCsv
    } else {
        ImportFormat::GenericCsv
    }
}

pub fn parse(payload: &str, format: Option<ImportFormat>) -> Result<ParsedImport> {
    if payload.trim().is_empty() {
        return Err(AcuyeError::Validation("The import file is empty".into()));
    }
    if payload.len() > 32 * 1024 * 1024 {
        return Err(AcuyeError::Validation(
            "The import file is larger than 32 MB".into(),
        ));
    }
    let format = format.unwrap_or_else(|| detect_format(payload));
    match format {
        ImportFormat::AcuyeJson => parse_acuye_json(payload),
        ImportFormat::BitwardenJson => parse_bitwarden_json(payload),
        ImportFormat::BitwardenCsv
        | ImportFormat::ChromeCsv
        | ImportFormat::OnePasswordCsv
        | ImportFormat::GenericCsv => parse_csv(payload, format),
    }
}

#[derive(Debug, Deserialize)]
struct AcuyeExportItem {
    #[serde(flatten)]
    item: Item,
}

fn parse_acuye_json(payload: &str) -> Result<ParsedImport> {
    let raw: serde_json::Value = serde_json::from_str(payload).map_err(|_| AcuyeError::Format)?;
    let array = match raw {
        serde_json::Value::Array(items) => items,
        serde_json::Value::Object(mut map) => {
            // Encrypted exports are handled by acuye-export, not here.
            if map.contains_key("ciphertext") {
                return Err(AcuyeError::Validation(
                    "This is an encrypted Acuye Pass export. Use the encrypted import option."
                        .into(),
                ));
            }
            map.remove("items")
                .and_then(|v| v.as_array().cloned())
                .ok_or(AcuyeError::Format)?
        }
        _ => return Err(AcuyeError::Format),
    };
    let mut items = Vec::new();
    let mut skipped = 0;
    let mut warnings = Vec::new();
    for value in array {
        match serde_json::from_value::<AcuyeExportItem>(value) {
            Ok(parsed) => {
                let mut item = parsed.item;
                if item.title.trim().is_empty() {
                    skipped += 1;
                    continue;
                }
                item.normalize();
                if item.validate().is_err() {
                    skipped += 1;
                    continue;
                }
                if items.iter().any(|i: &Item| i.id == item.id) {
                    item.id = uuid::Uuid::new_v4().to_string();
                    warnings.push("Duplicate item ids were rewritten".into());
                }
                items.push(item);
            }
            Err(_) => skipped += 1,
        }
    }
    Ok(ParsedImport {
        format: ImportFormat::AcuyeJson,
        items,
        skipped,
        warnings,
    })
}

#[derive(Debug, Deserialize)]
struct BitwardenJson {
    #[serde(default)]
    items: Vec<BitwardenItem>,
}

#[derive(Debug, Deserialize)]
struct BitwardenItem {
    #[serde(default)]
    name: String,
    #[serde(default)]
    notes: Option<String>,
    #[serde(rename = "type")]
    #[serde(default)]
    item_type: Option<u8>,
    #[serde(default)]
    favorite: bool,
    #[serde(default)]
    login: Option<BitwardenLogin>,
    #[serde(default)]
    card: Option<BitwardenCard>,
    #[serde(default)]
    identity: Option<BitwardenIdentity>,
}

#[derive(Debug, Deserialize, Default)]
struct BitwardenLogin {
    #[serde(default)]
    username: Option<String>,
    #[serde(default)]
    password: Option<String>,
    #[serde(default)]
    uri: Option<String>,
    #[serde(default)]
    totp: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct BitwardenCard {
    #[serde(default)]
    cardholder_name: Option<String>,
    #[serde(default)]
    number: Option<String>,
    #[serde(default)]
    exp_month: Option<String>,
    #[serde(default)]
    exp_year: Option<String>,
    #[serde(default)]
    code: Option<String>,
    #[serde(default)]
    brand: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct BitwardenIdentity {
    #[serde(default)]
    first_name: Option<String>,
    #[serde(default)]
    last_name: Option<String>,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    phone: Option<String>,
    #[serde(default)]
    address1: Option<String>,
    #[serde(default)]
    city: Option<String>,
    #[serde(default)]
    state: Option<String>,
    #[serde(default)]
    postal_code: Option<String>,
    #[serde(default)]
    country: Option<String>,
    #[serde(default)]
    company: Option<String>,
}

fn opt(value: Option<String>) -> String {
    value.unwrap_or_default()
}

fn parse_bitwarden_json(payload: &str) -> Result<ParsedImport> {
    let export: BitwardenJson = serde_json::from_str(payload).map_err(|_| AcuyeError::Format)?;
    let mut items = Vec::new();
    let mut skipped = 0;
    for entry in export.items {
        if entry.name.trim().is_empty() {
            skipped += 1;
            continue;
        }
        let fields = match entry.item_type {
            Some(3) => ItemFields::Card {
                cardholder: entry
                    .card
                    .as_ref()
                    .map(|c| opt(c.cardholder_name.clone()))
                    .unwrap_or_default(),
                number: entry
                    .card
                    .as_ref()
                    .map(|c| opt(c.number.clone()))
                    .unwrap_or_default(),
                expiry_month: entry
                    .card
                    .as_ref()
                    .map(|c| opt(c.exp_month.clone()))
                    .unwrap_or_default(),
                expiry_year: entry
                    .card
                    .as_ref()
                    .map(|c| opt(c.exp_year.clone()))
                    .unwrap_or_default(),
                cvv: entry
                    .card
                    .as_ref()
                    .map(|c| opt(c.code.clone()))
                    .unwrap_or_default(),
                brand: entry
                    .card
                    .as_ref()
                    .map(|c| opt(c.brand.clone()))
                    .unwrap_or_default(),
                pin: String::new(),
            },
            Some(4) => {
                let identity = entry.identity.unwrap_or_default();
                ItemFields::Identity {
                    first_name: opt(identity.first_name),
                    last_name: opt(identity.last_name),
                    email: opt(identity.email),
                    phone: opt(identity.phone),
                    address: opt(identity.address1),
                    city: opt(identity.city),
                    state: opt(identity.state),
                    postal_code: opt(identity.postal_code),
                    country: opt(identity.country),
                    company: opt(identity.company),
                }
            }
            Some(2) => ItemFields::SecureNote {},
            _ => {
                let login = entry.login.unwrap_or_default();
                ItemFields::Login {
                    username: opt(login.username),
                    password: opt(login.password),
                    url: opt(login.uri),
                    totp: opt(login.totp),
                    password_changed_at: None,
                }
            }
        };
        let mut item = Item::new(fields, entry.name);
        item.notes = opt(entry.notes);
        item.favorite = entry.favorite;
        item.normalize();
        if item.validate().is_ok() {
            items.push(item);
        } else {
            skipped += 1;
        }
    }
    Ok(ParsedImport {
        format: ImportFormat::BitwardenJson,
        items,
        skipped,
        warnings: Vec::new(),
    })
}

/// Minimal RFC 4180 CSV reader with quoted fields and doubled quotes.
pub fn parse_csv_rows(input: &str) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut in_quotes = false;
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        if in_quotes {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    chars.next();
                    field.push('"');
                } else {
                    in_quotes = false;
                }
            } else {
                field.push(c);
            }
        } else {
            match c {
                '"' if field.is_empty() => in_quotes = true,
                ',' => {
                    row.push(std::mem::take(&mut field));
                }
                '\r' => {}
                '\n' => {
                    row.push(std::mem::take(&mut field));
                    if row.iter().any(|f| !f.trim().is_empty()) {
                        rows.push(std::mem::take(&mut row));
                    } else {
                        row.clear();
                    }
                }
                _ => field.push(c),
            }
        }
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        if row.iter().any(|f| !f.trim().is_empty()) {
            rows.push(row);
        }
    }
    rows
}

fn find_column(headers: &[String], names: &[&str]) -> Option<usize> {
    headers.iter().position(|h| {
        let lower = h.trim().to_lowercase();
        names.iter().any(|n| lower == *n)
    })
}

fn parse_csv(payload: &str, format: ImportFormat) -> Result<ParsedImport> {
    let rows = parse_csv_rows(payload);
    if rows.is_empty() {
        return Err(AcuyeError::Format);
    }
    let headers: Vec<String> = rows[0].iter().map(|h| h.trim().to_lowercase()).collect();
    let title_col = find_column(&headers, &["name", "title", "login_uri", "account"])
        .ok_or(AcuyeError::Format)?;
    let username_col = find_column(&headers, &["login_username", "username", "user", "login"]);
    let password_col = find_column(&headers, &["login_password", "password", "pass"]);
    let url_col = find_column(&headers, &["url", "website", "login_uri", "uri"]);
    let notes_col = find_column(&headers, &["note", "notes", "comments", "extra"]);
    let fav_col = find_column(&headers, &["favorite"]);
    let type_col = find_column(&headers, &["type"]);
    let totp_col = find_column(&headers, &["login_totp", "otp", "totp", "otpauth"]);

    let cell = |row: &[String], index: Option<usize>| -> String {
        index
            .and_then(|i| row.get(i))
            .map(|s| s.trim().to_string())
            .unwrap_or_default()
    };

    let mut items = Vec::new();
    let mut skipped = 0;
    let warnings: Vec<String> = Vec::new();
    for row in rows.iter().skip(1) {
        let title = cell(row, Some(title_col));
        if title.is_empty() {
            skipped += 1;
            continue;
        }
        let is_note = type_col
            .map(|i| cell(row, Some(i)).eq_ignore_ascii_case("note"))
            .unwrap_or(false);
        let fields = if is_note {
            ItemFields::SecureNote {}
        } else {
            ItemFields::Login {
                username: cell(row, username_col),
                password: cell(row, password_col),
                url: cell(row, url_col),
                totp: cell(row, totp_col),
                password_changed_at: None,
            }
        };
        let mut item = Item::new(fields, title);
        item.notes = cell(row, notes_col);
        item.favorite = matches!(
            cell(row, fav_col).to_lowercase().as_str(),
            "1" | "true" | "yes"
        );
        item.normalize();
        if item.validate().is_ok() {
            items.push(item);
        } else {
            skipped += 1;
        }
    }
    if items.is_empty() && skipped == 0 {
        return Err(AcuyeError::Format);
    }
    Ok(ParsedImport {
        format,
        items,
        skipped,
        warnings: dedupe(warnings),
    })
}

fn dedupe(values: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::BTreeSet::new();
    values
        .into_iter()
        .filter(|v| seen.insert(v.clone()))
        .collect()
}

/// Counts per imported type, for the confirmation dialog.
pub fn summarize(items: &[Item]) -> Vec<(ItemType, usize)> {
    ItemType::all()
        .iter()
        .map(|kind| {
            (
                *kind,
                items.iter().filter(|i| i.item_type() == *kind).count(),
            )
        })
        .filter(|(_, count)| *count > 0)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_reader_handles_quotes_commas_and_newlines() {
        let rows = parse_csv_rows("a,b\n\"x, y\",\"he said \"\"hi\"\"\"\n1,2\n");
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[1][0], "x, y");
        assert_eq!(rows[1][1], "he said \"hi\"");
    }

    #[test]
    fn chrome_csv_imports_logins() {
        let payload = "name,url,username,password,note\nGitHub,https://github.com,ada@example.com,secret123,work\n";
        let parsed = parse(payload, None).unwrap();
        assert_eq!(parsed.format, ImportFormat::ChromeCsv);
        assert_eq!(parsed.items.len(), 1);
        assert_eq!(parsed.items[0].subtitle(), "ada@example.com");
        if let ItemFields::Login { url, password, .. } = &parsed.items[0].fields {
            assert_eq!(url, "https://github.com");
            assert_eq!(password, "secret123");
        } else {
            panic!("expected login");
        }
    }

    #[test]
    fn bitwarden_csv_detected_and_parsed() {
        let payload = "folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\nWork,1,login,Mail,,,0,https://mail.example.com,ada,mailpass,\n";
        let parsed = parse(payload, None).unwrap();
        assert_eq!(parsed.format, ImportFormat::BitwardenCsv);
        assert_eq!(parsed.items.len(), 1);
        assert!(parsed.items[0].favorite);
        assert_eq!(parsed.items[0].title, "Mail");
    }

    #[test]
    fn empty_titles_are_skipped_and_reported() {
        let payload = "name,url,username,password\n,https://x,a,b\nReal,https://y,c,d\n";
        let parsed = parse(payload, None).unwrap();
        assert_eq!(parsed.items.len(), 1);
        assert_eq!(parsed.skipped, 1);
    }

    #[test]
    fn bitwarden_json_maps_cards_identities_and_notes() {
        let payload = r#"{"items":[
            {"type":1,"name":"Mail","login":{"username":"a","password":"b","uri":"https://m"}},
            {"type":2,"name":"Note","notes":"hello"},
            {"type":3,"name":"Visa","card":{"cardholder_name":"Ada","number":"4111","exp_month":"1","exp_year":"2030","code":"123"}},
            {"type":4,"name":"Me","identity":{"first_name":"Ada","email":"a@b.c"}}
        ]}"#;
        let parsed = parse(payload, None).unwrap();
        assert_eq!(parsed.format, ImportFormat::BitwardenJson);
        assert_eq!(parsed.items.len(), 4);
        assert_eq!(parsed.items[0].item_type(), ItemType::Login);
        assert_eq!(parsed.items[1].item_type(), ItemType::SecureNote);
        assert_eq!(parsed.items[2].item_type(), ItemType::Card);
        assert_eq!(parsed.items[3].item_type(), ItemType::Identity);
    }

    #[test]
    fn acuye_json_roundtrip_and_duplicate_ids_rewritten() {
        let mut vault_items = Vec::new();
        for i in 0..2 {
            let mut item = Item::new(ItemFields::SecureNote {}, format!("Note {i}"));
            item.notes = "body".into();
            vault_items.push(item);
        }
        vault_items[1].id = vault_items[0].id.clone();
        let payload = serde_json::to_string(&vault_items).unwrap();
        let parsed = parse(&payload, None).unwrap();
        assert_eq!(parsed.items.len(), 2);
        assert_ne!(parsed.items[0].id, parsed.items[1].id);
        assert!(!parsed.warnings.is_empty());
    }

    #[test]
    fn encrypted_export_is_not_imported_as_plaintext() {
        let payload = r#"{"format":"acuye-export","ciphertext":"abc","nonce":"x"}"#;
        assert!(parse(payload, None).is_err());
    }

    #[test]
    fn malformed_payloads_are_rejected() {
        assert!(parse("", None).is_err());
        assert!(parse("not json at all {{{", None).is_err());
        assert!(parse("name,url\n", None).is_err());
    }

    #[test]
    fn summary_counts_by_type() {
        let payload = "name,url,username,password\nA,https://a,u,p\nB,https://b,u,p\n";
        let parsed = parse(payload, None).unwrap();
        let summary = summarize(&parsed.items);
        assert_eq!(summary.len(), 1);
        assert_eq!(summary[0].1, 2);
    }
}
