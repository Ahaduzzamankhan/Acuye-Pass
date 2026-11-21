//! Native messaging host for the Acuye Pass browser extension.
//!
//! The extension talks to this process over Chrome's native messaging protocol:
//! a 4-byte little-endian length followed by UTF-8 JSON, in both directions.
//! The host opens the same encrypted database the desktop app uses, unlocks one
//! vault in memory when the user supplies its master password, and answers
//! `list`/`fill` requests with login fields.
//!
//! Security notes:
//! * Nothing is written to disk and nothing is logged. Passwords only travel
//!   over the pipe to the extension that launched this process.
//! * The vault is unlocked per process and the process exits when the browser
//!   closes the port, so no key material outlives the popup session.
//! * An idle timeout locks the in-memory session even if the popup stays open.
//! * Only the encrypted database is read; the host never creates an account and
//!   never modifies items.

use std::io::{Read, Write};
use std::path::PathBuf;
use std::time::{Duration, Instant};

use acuye_auth::{AuthService, UnlockedVault};
use acuye_core::{Item, ItemFields};
use acuye_storage::Database;
use acuye_totp::{OtpConfig, OtpType, TotpAlgorithm, TotpConfig};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Chrome's own limit for a single native message (host → browser is 1 MiB).
const MAX_MESSAGE_BYTES: usize = 1024 * 1024;
/// Lock the in-memory vault after this much inactivity.
const IDLE_LOCK: Duration = Duration::from_secs(10 * 60);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    #[serde(default)]
    id: Value,
    command: String,
    #[serde(default)]
    account_id: Option<String>,
    #[serde(default)]
    password: Option<String>,
    #[serde(default)]
    query: Option<String>,
    #[serde(default)]
    item_id: Option<String>,
    #[serde(default)]
    host: Option<String>,
}

#[derive(Debug, Serialize)]
struct Response<T: Serialize> {
    id: Value,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl<T: Serialize> Response<T> {
    fn ok(id: Value, data: T) -> Self {
        Self {
            id,
            ok: true,
            data: Some(data),
            error: None,
        }
    }

    fn error(id: Value, message: impl Into<String>) -> Self {
        Self {
            id,
            ok: false,
            data: None,
            error: Some(message.into()),
        }
    }
}

struct Session {
    vault: UnlockedVault,
    account_id: String,
    last_used: Instant,
}

struct Host {
    db_path: PathBuf,
    session: Option<Session>,
}

impl Host {
    fn new(db_path: PathBuf) -> Self {
        Self {
            db_path,
            session: None,
        }
    }

    /// Drop an expired session before every request.
    fn expire_stale_session(&mut self) {
        if self
            .session
            .as_ref()
            .map(|session| session.last_used.elapsed() > IDLE_LOCK)
            .unwrap_or(false)
        {
            self.session = None;
        }
    }

    fn unlocked(&mut self) -> Result<&mut Session, String> {
        self.expire_stale_session();
        let session = self
            .session
            .as_mut()
            .ok_or_else(|| "The vault is locked. Enter your master password first.".to_string())?;
        session.last_used = Instant::now();
        Ok(session)
    }

    fn accounts(&self) -> Result<Value, String> {
        let auth = self.auth()?;
        let accounts = auth
            .accounts()
            .map_err(|_| "Could not read the local accounts.".to_string())?;
        Ok(json!({
            "accounts": accounts
                .into_iter()
                .map(|account| json!({
                    "id": account.vault_id,
                    "username": account.username,
                    "vaultName": account.vault_name,
                }))
                .collect::<Vec<_>>(),
        }))
    }

    fn auth(&self) -> Result<AuthService, String> {
        let db = Database::open(&self.db_path)
            .map_err(|_| "Could not open the Acuye Pass database.".to_string())?;
        Ok(AuthService::with_default_kdf(db))
    }

    fn unlock(&mut self, account_id: &str, password: &str) -> Result<Value, String> {
        let auth = self.auth()?;
        let vault = auth
            .unlock_vault(account_id, password)
            .map_err(|_| "That master password did not unlock the account.".to_string())?;
        let data = json!({
            "accountId": vault.vault.id,
            "username": vault.username,
            "vaultName": vault.vault.name,
        });
        self.session = Some(Session {
            vault,
            account_id: account_id.to_string(),
            last_used: Instant::now(),
        });
        Ok(data)
    }

    fn status(&mut self) -> Value {
        self.expire_stale_session();
        match self.session.as_ref() {
            Some(session) => json!({
                "locked": false,
                "accountId": session.account_id,
                "username": session.vault.username,
                "vaultName": session.vault.vault.name,
            }),
            None => json!({ "locked": true }),
        }
    }

    fn list(&mut self, query: &str) -> Result<Value, String> {
        let needle = query.trim().to_lowercase();
        let session = self.unlocked()?;
        let items = session
            .vault
            .vault
            .items
            .iter()
            .filter_map(|item| match &item.fields {
                ItemFields::Login {
                    username,
                    url,
                    totp,
                    ..
                } => Some(json!({
                    "id": item.id,
                    "title": item.title,
                    "username": username,
                    "url": url,
                    "host": host_of(url),
                    "hasTotp": !totp.trim().is_empty(),
                })),
                _ => None,
            })
            .filter(|item| {
                if needle.is_empty() {
                    return true;
                }
                let title = item["title"].as_str().unwrap_or_default().to_lowercase();
                let username = item["username"].as_str().unwrap_or_default().to_lowercase();
                let host = item["host"].as_str().unwrap_or_default().to_lowercase();
                title.contains(&needle) || username.contains(&needle) || host.contains(&needle)
            })
            .take(50)
            .collect::<Vec<_>>();
        Ok(json!({ "items": items }))
    }

    /// Logins whose stored URL matches the page host. Used by the content
    /// script; returns metadata only, never a password.
    fn match_host(&mut self, host: &str) -> Result<Value, String> {
        let wanted = normalize_host(host);
        if wanted.is_empty() {
            return Ok(json!({ "items": [] }));
        }
        let session = self.unlocked()?;
        let items = session
            .vault
            .vault
            .items
            .iter()
            .filter_map(|item| match &item.fields {
                ItemFields::Login { username, url, .. } => Some((item, username, url)),
                _ => None,
            })
            .filter(|(_, _, url)| host_of(url) == wanted)
            .map(|(item, username, url)| {
                json!({
                    "id": item.id,
                    "title": item.title,
                    "username": username,
                    "host": host_of(url),
                })
            })
            .take(20)
            .collect::<Vec<_>>();
        Ok(json!({ "items": items }))
    }

    /// Current one-time code for an authenticator item or for a login that has a
    /// TOTP secret attached.
    fn totp(&mut self, item_id: &str) -> Result<Value, String> {
        let session = self.unlocked()?;
        let item = session
            .vault
            .vault
            .get(item_id)
            .ok_or_else(|| "That item no longer exists.".to_string())?;
        let config = totp_config(item)?;
        let at = acuye_core::time::now() as u64;
        let code = config
            .code_at(at)
            .map_err(|_| "Could not generate a code for that entry.".to_string())?;
        Ok(json!({
            "code": code,
            "remaining": config.remaining_secs(at),
            "period": config.period,
        }))
    }

    fn fill(&mut self, item_id: &str) -> Result<Value, String> {
        let session = self.unlocked()?;
        let item = session
            .vault
            .vault
            .get(item_id)
            .ok_or_else(|| "That item no longer exists.".to_string())?;
        match &item.fields {
            ItemFields::Login {
                username,
                password,
                url,
                ..
            } => Ok(json!({
                "title": item.title,
                "username": username,
                "password": password,
                "url": url,
            })),
            _ => Err("That item is not a login.".to_string()),
        }
    }

    fn lock(&mut self) {
        self.session = None;
    }
}

impl Drop for Host {
    fn drop(&mut self) {
        self.session = None;
    }
}

/// Normalize a page hostname for comparisons.
fn normalize_host(host: &str) -> String {
    host.trim().trim_start_matches("www.").to_lowercase()
}

/// TOTP configuration for an authenticator item or a login with `totp` set.
/// Accepts a full `otpauth://` URI or a bare base32 secret.
fn totp_config(item: &Item) -> Result<TotpConfig, String> {
    match &item.fields {
        ItemFields::Totp {
            secret,
            issuer,
            account,
            algorithm,
            digits,
            period,
            otp_type,
            counter,
        } => Ok(TotpConfig {
            secret: secret.clone(),
            issuer: issuer.clone(),
            account: account.clone(),
            algorithm: TotpAlgorithm::parse(algorithm)
                .map_err(|_| "Unsupported TOTP algorithm.".to_string())?,
            digits: *digits,
            period: *period,
            otp_type: OtpType::parse(otp_type).map_err(|_| "Unsupported OTP type.".to_string())?,
            counter: *counter,
        }),
        ItemFields::Login { totp, .. } => {
            let value = totp.trim();
            if value.is_empty() {
                return Err("That login has no authenticator secret.".to_string());
            }
            if value.starts_with("otpauth://") {
                return OtpConfig::parse_uri(value)
                    .map_err(|_| "That authenticator URI is invalid.".to_string());
            }
            let secret = value.replace(' ', "").to_uppercase();
            OtpConfig::parse_uri(&format!("otpauth://totp/Acuye?secret={secret}"))
                .map_err(|_| "That authenticator secret is invalid.".to_string())
        }
        _ => Err("That item has no authenticator entry.".to_string()),
    }
}

/// Hostname of a login URL, for display and matching in the popup.
fn host_of(url: &str) -> String {
    let value = url.trim();
    if value.is_empty() {
        return String::new();
    }
    let with_scheme = if value.contains("://") {
        value.to_string()
    } else {
        format!("https://{value}")
    };
    let without_scheme = with_scheme
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(with_scheme.as_str());
    without_scheme
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default()
        .trim_start_matches("www.")
        .to_lowercase()
}

/// Tauri's per-app data directory for `com.fluxenite.acuyepass`, matching what
/// the desktop app uses. `ACUYE_PASS_DATA_DIR` overrides it for tests and for
/// portable installs.
fn database_path() -> PathBuf {
    if let Ok(dir) = std::env::var("ACUYE_PASS_DATA_DIR") {
        if !dir.trim().is_empty() {
            return PathBuf::from(dir).join("acuye.db");
        }
    }
    #[cfg(windows)]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            return PathBuf::from(appdata)
                .join("com.fluxenite.acuyepass")
                .join("acuye.db");
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home)
                .join("Library/Application Support/com.fluxenite.acuyepass")
                .join("acuye.db");
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
            if !xdg.trim().is_empty() {
                return PathBuf::from(xdg)
                    .join("com.fluxenite.acuyepass")
                    .join("acuye.db");
            }
        }
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home)
                .join(".local/share/com.fluxenite.acuyepass")
                .join("acuye.db");
        }
    }
    std::env::temp_dir()
        .join("com.fluxenite.acuyepass")
        .join("acuye.db")
}

fn read_message(input: &mut impl Read) -> std::io::Result<Option<Value>> {
    let mut length = [0u8; 4];
    match input.read_exact(&mut length) {
        Ok(()) => {}
        Err(err) if err.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(err) => return Err(err),
    }
    let size = u32::from_le_bytes(length) as usize;
    if size == 0 || size > MAX_MESSAGE_BYTES {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "invalid native message length",
        ));
    }
    let mut body = vec![0u8; size];
    input.read_exact(&mut body)?;
    serde_json::from_slice(&body)
        .map(Some)
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidData, "invalid JSON"))
}

fn write_message(output: &mut impl Write, value: &Value) -> std::io::Result<()> {
    let body = serde_json::to_vec(value)
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidData, "invalid JSON"))?;
    if body.len() > MAX_MESSAGE_BYTES {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "response too large",
        ));
    }
    output.write_all(&(body.len() as u32).to_le_bytes())?;
    output.write_all(&body)?;
    output.flush()
}

fn handle(host: &mut Host, request: Request) -> Response<Value> {
    let id = request.id.clone();
    let result = match request.command.as_str() {
        "ping" => Ok(json!({
            "version": env!("CARGO_PKG_VERSION"),
            "database": host.db_path.to_string_lossy(),
        })),
        "accounts" => host.accounts(),
        "unlock" => match (request.account_id, request.password) {
            (Some(account_id), Some(password)) => host.unlock(&account_id, &password),
            _ => Err("An account id and master password are required.".to_string()),
        },
        "status" => Ok(host.status()),
        "list" => host.list(request.query.as_deref().unwrap_or("")),
        "match" => host.match_host(request.host.as_deref().unwrap_or("")),
        "totp" => match request.item_id {
            Some(item_id) => host.totp(&item_id),
            None => Err("An item id is required.".to_string()),
        },
        "fill" => match request.item_id {
            Some(item_id) => host.fill(&item_id),
            None => Err("An item id is required.".to_string()),
        },
        "lock" => {
            host.lock();
            Ok(json!({ "locked": true }))
        }
        other => Err(format!("Unknown command: {other}")),
    };

    match result {
        Ok(data) => Response::ok(id, data),
        Err(error) => Response::error(id, error),
    }
}

fn main() {
    let mut host = Host::new(database_path());
    let stdin = std::io::stdin();
    let mut input = stdin.lock();
    let stdout = std::io::stdout();
    let mut output = stdout.lock();

    loop {
        let message = match read_message(&mut input) {
            Ok(Some(value)) => value,
            Ok(None) => break,
            Err(_) => break,
        };
        let response_id = message.get("id").cloned().unwrap_or(Value::Null);
        let request: Request = match serde_json::from_value(message) {
            Ok(request) => request,
            Err(_) => {
                let _ = write_message(
                    &mut output,
                    &serde_json::to_value(Response::<Value>::error(
                        response_id,
                        "Malformed request.",
                    ))
                    .unwrap_or(Value::Null),
                );
                continue;
            }
        };
        let response = handle(&mut host, request);
        if write_message(
            &mut output,
            &serde_json::to_value(response).unwrap_or(Value::Null),
        )
        .is_err()
        {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hostname_is_extracted_from_common_urls() {
        assert_eq!(host_of("https://www.github.com/login?x=1"), "github.com");
        assert_eq!(host_of("example.com"), "example.com");
        assert_eq!(host_of("  "), "");
    }

    #[test]
    fn frames_round_trip() {
        let mut buffer = Vec::new();
        write_message(&mut buffer, &json!({ "id": 1, "ok": true })).unwrap();
        let mut cursor = std::io::Cursor::new(buffer);
        let decoded = read_message(&mut cursor).unwrap().unwrap();
        assert_eq!(decoded["id"], 1);
        assert!(read_message(&mut cursor).unwrap().is_none());
    }

    #[test]
    fn oversized_frames_are_rejected() {
        let mut buffer = ((MAX_MESSAGE_BYTES + 1) as u32).to_le_bytes().to_vec();
        buffer.extend_from_slice(b"{}");
        let mut cursor = std::io::Cursor::new(buffer);
        assert!(read_message(&mut cursor).is_err());
    }

    fn request(id: u64, command: &str) -> Request {
        Request {
            id: json!(id),
            command: command.into(),
            account_id: None,
            password: None,
            query: None,
            item_id: None,
            host: None,
        }
    }

    #[test]
    fn unlock_list_and_fill_against_a_real_database() {
        let dir = std::env::temp_dir().join(format!("acuye-host-e2e-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("acuye.db");
        let password = "correct-horse-battery-staple-42";

        {
            let db = Database::open(&path).unwrap();
            let auth = AuthService::new(
                db,
                acuye_crypto::KdfParams {
                    memory_kib: 19_456,
                    iterations: 2,
                    parallelism: 1,
                },
            );
            let mut unlocked = auth.create_account("ada", password).unwrap();
            let item = unlocked
                .vault
                .add(acuye_core::Item::new(
                    ItemFields::Login {
                        username: "ada@example.com".into(),
                        password: "server-secret-123".into(),
                        url: "https://www.example.com/login".into(),
                        totp: "JBSWY3DPEHPK3PXP".into(),
                        password_changed_at: None,
                    },
                    "Example",
                ))
                .unwrap();
            let stored = unlocked.encrypt_item(&item).unwrap();
            auth.db().upsert_item(&stored).unwrap();
        }

        let mut host = Host::new(path.clone());

        let accounts = handle(&mut host, request(1, "accounts"));
        assert!(accounts.ok);
        let account_id = accounts.data.as_ref().unwrap()["accounts"][0]["id"]
            .as_str()
            .unwrap()
            .to_string();

        let mut unlock = request(2, "unlock");
        unlock.account_id = Some(account_id);
        unlock.password = Some(password.into());
        assert!(handle(&mut host, unlock).ok);

        let list = handle(&mut host, request(3, "list"));
        assert!(list.ok);
        let items = &list.data.as_ref().unwrap()["items"];
        assert_eq!(items.as_array().unwrap().len(), 1);
        assert_eq!(items[0]["host"], "example.com");
        let item_id = items[0]["id"].as_str().unwrap().to_string();

        let mut search = request(4, "list");
        search.query = Some("nothing-matches".into());
        let filtered = handle(&mut host, search);
        assert_eq!(
            filtered.data.as_ref().unwrap()["items"]
                .as_array()
                .unwrap()
                .len(),
            0
        );

        let mut fill = request(5, "fill");
        fill.item_id = Some(item_id.clone());
        let filled = handle(&mut host, fill);
        assert!(filled.ok);
        assert_eq!(filled.data.as_ref().unwrap()["username"], "ada@example.com");
        assert_eq!(
            filled.data.as_ref().unwrap()["password"],
            "server-secret-123"
        );

        let mut match_request = request(8, "match");
        match_request.host = Some("www.example.com".into());
        let matched = handle(&mut host, match_request);
        assert!(matched.ok);
        assert_eq!(
            matched.data.as_ref().unwrap()["items"]
                .as_array()
                .unwrap()
                .len(),
            1
        );

        let mut totp_request = request(9, "totp");
        totp_request.item_id = Some(item_id.clone());
        let totp = handle(&mut host, totp_request);
        assert!(totp.ok, "totp failed: {:?}", totp.error);
        let code = totp.data.as_ref().unwrap()["code"].as_str().unwrap();
        assert_eq!(code.len(), 6);
        assert!(code.chars().all(|c| c.is_ascii_digit()));

        assert!(handle(&mut host, request(6, "lock")).ok);
        assert!(!handle(&mut host, request(7, "list")).ok);

        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn requests_require_an_unlocked_vault() {
        let mut host = Host::new(std::env::temp_dir().join("acuye-host-missing.db"));
        let response = handle(
            &mut host,
            Request {
                id: json!(1),
                command: "list".into(),
                account_id: None,
                password: None,
                query: None,
                item_id: None,
                host: None,
            },
        );
        assert!(!response.ok);
        assert!(response.error.unwrap().contains("locked"));
    }
}
