//! Advanced security features: authenticator, secret manager helpers, breach
//! monitoring and hostless LAN pairing.
//!
//! Every sensitive operation stays here in Rust: TOTP codes are computed from
//! encrypted vault items, passwords are hashed locally before a k-anonymity
//! lookup, and peer sessions are authenticated with Noise before a single
//! message is exchanged.

use std::time::Duration;

use acuye_core::{AcuyeError, Item, ItemFields, Timestamp};
use acuye_lan::{
    build_pairing_uri, handshake, open_bundle, parse_pairing_uri, seal_bundle, vault_proof,
    Channel, DeviceIdentity, LanListener, PairingOffer, PeerRecord, Role, SyncBundle, SyncItem,
    TcpChannel, TrustStore, VaultIdentity,
};
use acuye_storage::LanPeerRow;
use acuye_totp::{OtpConfig, OtpType, TotpAlgorithm, TotpConfig};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use zeroize::Zeroize;

use crate::commands::lock_core;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

/// Port the pairing listener uses. Chosen once so a QR code can carry it.
pub const LAN_PORT: u16 = 47_821;
const LAN_TIMEOUT: Duration = Duration::from_secs(20);

fn now() -> Timestamp {
    acuye_core::time::now()
}

fn totp_config(item: &Item) -> ApiResult<TotpConfig> {
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
            algorithm: TotpAlgorithm::parse(algorithm)?,
            digits: *digits,
            period: *period,
            otp_type: OtpType::parse(otp_type)?,
            counter: *counter,
        }),
        _ => Err(ApiError::validation(
            "That item is not an authenticator entry",
        )),
    }
}

// ---------------------------------------------------------------------------
// Authenticator
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TotpEntryView {
    pub id: String,
    pub title: String,
    pub issuer: String,
    pub account: String,
    pub code: String,
    pub digits: u32,
    pub period: u32,
    pub remaining: u32,
    pub algorithm: String,
    pub otp_type: String,
    pub counter: u64,
    pub progress: f32,
    pub error: Option<String>,
}

#[tauri::command]
pub fn authenticator_entries(state: State<'_, AppState>) -> ApiResult<Vec<TotpEntryView>> {
    let mut core = lock_core(&state)?;
    let live = core.unlocked()?;
    let at = now() as u64;
    let mut out = Vec::new();
    for item in &live.unlocked.vault.items {
        if !matches!(item.fields, ItemFields::Totp { .. }) {
            continue;
        }
        let mut view = TotpEntryView {
            id: item.id.clone(),
            title: item.title.clone(),
            issuer: String::new(),
            account: String::new(),
            code: String::new(),
            digits: 6,
            period: 30,
            remaining: 0,
            algorithm: "sha1".into(),
            otp_type: "totp".into(),
            counter: 0,
            progress: 0.0,
            error: None,
        };
        match totp_config(item) {
            Ok(config) => {
                view.issuer = config.issuer.clone();
                view.account = config.account.clone();
                view.digits = config.digits;
                view.period = config.period;
                view.algorithm = config.algorithm.as_str().to_ascii_lowercase();
                view.otp_type = config.otp_type.as_str().to_string();
                view.counter = config.counter;
                view.remaining = config.remaining_secs(at);
                view.progress = config.progress(at);
                match config.code_at(at) {
                    Ok(code) => view.code = code,
                    Err(err) => view.error = Some(err.to_string()),
                }
            }
            Err(err) => view.error = Some(err.message),
        }
        out.push(view);
    }
    out.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    Ok(out)
}

/// Title for a new entry: the user's name, else issuer, else account.
fn entry_title(name: &str, config: &OtpConfig) -> String {
    let name = name.trim();
    if !name.is_empty() {
        name.to_string()
    } else if !config.issuer.is_empty() {
        config.issuer.clone()
    } else if !config.account.is_empty() {
        config.account.clone()
    } else {
        "Authenticator".to_string()
    }
}

fn store_entry(core: &mut crate::state::Core, config: OtpConfig, title: String) -> ApiResult<Item> {
    let item = Item::new(
        ItemFields::Totp {
            secret: config.secret,
            issuer: config.issuer,
            account: config.account,
            algorithm: config.algorithm.as_str().to_ascii_lowercase(),
            digits: config.digits,
            period: config.period,
            otp_type: config.otp_type.as_str().to_string(),
            counter: config.counter,
        },
        title,
    );
    let item = core.unlocked()?.unlocked.vault.add(item)?;
    let stored = core.unlocked()?.unlocked.encrypt_item(&item)?;
    core.auth.db().upsert_item(&stored)?;
    Ok(item)
}

/// Fields the add form accepts. Every value is validated in the engine.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewAuthenticatorEntry {
    pub name: String,
    pub secret: String,
    #[serde(default)]
    pub issuer: String,
    #[serde(default)]
    pub account: String,
    #[serde(default)]
    pub otp_type: String,
    #[serde(default)]
    pub algorithm: String,
    #[serde(default)]
    pub digits: Option<u32>,
    #[serde(default)]
    pub period: Option<u32>,
    #[serde(default)]
    pub counter: Option<u64>,
}

/// Add an entry from explicit fields (name, secret, issuer, digits, interval,
/// algorithm, type) — the manual path used by the authenticator form.
#[tauri::command]
pub fn authenticator_add_entry(
    state: State<'_, AppState>,
    entry: NewAuthenticatorEntry,
) -> ApiResult<Item> {
    let config = OtpConfig::from_parts(
        &entry.secret,
        &entry.issuer,
        &entry.account,
        &entry.algorithm,
        entry.digits.unwrap_or(acuye_totp::DEFAULT_DIGITS),
        entry.period.unwrap_or(acuye_totp::DEFAULT_PERIOD),
        &entry.otp_type,
        entry.counter.unwrap_or(0),
    )?;
    let title = entry_title(&entry.name, &config);
    let mut core = lock_core(&state)?;
    if core.unlocked()?.unlocked.vault.items.iter().any(|existing| {
        matches!(&existing.fields, ItemFields::Totp { secret, .. } if secret == &config.secret)
    }) {
        return Err(ApiError::validation(
            "That authenticator secret is already in your vault",
        ));
    }
    store_entry(&mut core, config, title)
}

/// Add an authenticator entry from an `otpauth://` setup URI (paste or transfer).
#[tauri::command]
pub fn authenticator_add(state: State<'_, AppState>, uri: String) -> ApiResult<Item> {
    let config = TotpConfig::parse_uri(&uri)?;
    let title = entry_title("", &config);
    let mut core = lock_core(&state)?;
    store_entry(&mut core, config, title)
}

/// Move a counter-based (HOTP) entry to its next code.
#[tauri::command]
pub fn authenticator_advance_counter(state: State<'_, AppState>, id: String) -> ApiResult<u64> {
    let mut core = lock_core(&state)?;
    let (item, counter) = {
        let live = core.unlocked()?;
        let item = live
            .unlocked
            .vault
            .get(&id)
            .ok_or_else(|| ApiError::from(AcuyeError::NotFound("item".into())))?
            .clone();
        let config = totp_config(&item)?;
        if !config.is_counter_based() {
            return Err(ApiError::validation(
                "That entry uses time based codes, not a counter",
            ));
        }
        (item, config.counter.saturating_add(1))
    };
    let mut updated = item;
    if let ItemFields::Totp {
        counter: stored, ..
    } = &mut updated.fields
    {
        *stored = counter;
    }
    let updated = core.unlocked()?.unlocked.vault.update(updated)?;
    let sealed = core.unlocked()?.unlocked.encrypt_item(&updated)?;
    core.auth.db().upsert_item(&sealed)?;
    Ok(counter)
}

/// The `otpauth://` URI for an entry, for re-export to another authenticator.
#[tauri::command]
pub fn authenticator_export(state: State<'_, AppState>, id: String) -> ApiResult<String> {
    let mut core = lock_core(&state)?;
    let live = core.unlocked()?;
    let item = live
        .unlocked
        .vault
        .get(&id)
        .ok_or_else(|| ApiError::from(AcuyeError::NotFound("item".into())))?;
    Ok(totp_config(item)?.to_uri())
}

// ---------------------------------------------------------------------------
// Secret manager
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretAccessView {
    pub action: String,
    pub at: Timestamp,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretAlertView {
    pub id: String,
    pub title: String,
    /// `expired`, `expiring`, `rotation_due` or `rotation_soon`.
    pub kind: String,
    pub due_at: Timestamp,
}

fn secret_fields(item: &Item) -> ApiResult<&Vec<acuye_core::CustomField>> {
    match &item.fields {
        ItemFields::Secret { fields, .. } => Ok(fields),
        _ => Err(ApiError::validation("That item is not a secret")),
    }
}

/// Copy one field of a secret item, auto-clearing the clipboard and recording
/// the access (never the value).
#[tauri::command]
pub fn secret_copy(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    index: usize,
) -> ApiResult<()> {
    let (value, clear_after) = {
        let mut core = lock_core(&state)?;
        let clear_after = core.settings.clipboard_clear_secs;
        let live = core.unlocked()?;
        let item = live
            .unlocked
            .vault
            .get(&id)
            .ok_or_else(|| ApiError::from(AcuyeError::NotFound("item".into())))?;
        let fields = secret_fields(item)?;
        let field = fields
            .get(index)
            .ok_or_else(|| ApiError::validation("That secret field no longer exists"))?;
        if field.value.is_empty() {
            return Err(ApiError::validation("That secret field is empty"));
        }
        let value = field.value.clone();
        core.auth
            .db_mut()
            .record_secret_access(&id, "copy", now())?;
        (value, clear_after)
    };

    app.clipboard()
        .write_text(value.clone())
        .map_err(|_| ApiError::validation("Could not access the clipboard"))?;

    if clear_after > 0 {
        let handle = app.clone();
        let secret = value;
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(clear_after));
            let still_ours = handle
                .clipboard()
                .read_text()
                .map(|current| current == secret)
                .unwrap_or(false);
            if still_ours {
                let _ = handle.clipboard().write_text(String::new());
            }
        });
    }
    Ok(())
}

/// Reveal one field for on-screen inspection; the access is recorded without
/// the value.
#[tauri::command]
pub fn secret_reveal(state: State<'_, AppState>, id: String, index: usize) -> ApiResult<String> {
    let mut core = lock_core(&state)?;
    let live = core.unlocked()?;
    let item = live
        .unlocked
        .vault
        .get(&id)
        .ok_or_else(|| ApiError::from(AcuyeError::NotFound("item".into())))?;
    let value = secret_fields(item)?
        .get(index)
        .map(|field| field.value.clone())
        .ok_or_else(|| ApiError::validation("That secret field no longer exists"))?;
    core.auth
        .db_mut()
        .record_secret_access(&id, "reveal", now())?;
    Ok(value)
}

#[tauri::command]
pub fn secret_access_log(
    state: State<'_, AppState>,
    id: String,
) -> ApiResult<Vec<SecretAccessView>> {
    let core = lock_core(&state)?;
    Ok(core
        .auth
        .db()
        .secret_access(&id)?
        .into_iter()
        .map(|row| SecretAccessView {
            action: row.action,
            at: row.at,
        })
        .collect())
}

#[tauri::command]
pub fn secret_clear_history(state: State<'_, AppState>, id: String) -> ApiResult<()> {
    let mut core = lock_core(&state)?;
    core.auth.db_mut().clear_secret_access(&id)?;
    Ok(())
}

/// Expiry and rotation reminders across every secret item.
#[tauri::command]
pub fn secret_alerts(state: State<'_, AppState>) -> ApiResult<Vec<SecretAlertView>> {
    let mut core = lock_core(&state)?;
    let live = core.unlocked()?;
    let at = now();
    const DAY: Timestamp = 86_400;
    let mut out = Vec::new();
    for item in &live.unlocked.vault.items {
        if let ItemFields::Secret {
            expires_at,
            rotate_every_days,
            last_rotated_at,
            ..
        } = &item.fields
        {
            if let Some(expires_at) = expires_at {
                if *expires_at <= at {
                    out.push(SecretAlertView {
                        id: item.id.clone(),
                        title: item.title.clone(),
                        kind: "expired".into(),
                        due_at: *expires_at,
                    });
                } else if *expires_at - at <= 14 * DAY {
                    out.push(SecretAlertView {
                        id: item.id.clone(),
                        title: item.title.clone(),
                        kind: "expiring".into(),
                        due_at: *expires_at,
                    });
                }
            }
            if let Some(days) = rotate_every_days {
                let anchor = last_rotated_at.unwrap_or(item.updated_at);
                let due = anchor + i64::from(*days) * DAY;
                if due <= at {
                    out.push(SecretAlertView {
                        id: item.id.clone(),
                        title: item.title.clone(),
                        kind: "rotation_due".into(),
                        due_at: due,
                    });
                } else if due - at <= 7 * DAY {
                    out.push(SecretAlertView {
                        id: item.id.clone(),
                        title: item.title.clone(),
                        kind: "rotation_soon".into(),
                        due_at: due,
                    });
                }
            }
        }
    }
    out.sort_by_key(|alert| alert.due_at);
    Ok(out)
}

// ---------------------------------------------------------------------------
// Breach monitoring
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BreachItemView {
    pub id: String,
    pub title: String,
    /// `clean`, `breached` or `unavailable`.
    pub status: String,
    pub count: u64,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BreachScanView {
    pub checked: usize,
    pub breached: usize,
    pub clean: usize,
    pub unavailable: usize,
    pub results: Vec<BreachItemView>,
    pub scanned_at: Timestamp,
}

fn breach_view(id: String, title: String, password: &str) -> BreachItemView {
    let status = acuye_breach::check_password_online(password);
    match status {
        acuye_breach::BreachStatus::Clean => BreachItemView {
            id,
            title,
            status: "clean".into(),
            count: 0,
            detail: "Not found in any known breach".into(),
        },
        acuye_breach::BreachStatus::Breached { count } => BreachItemView {
            id,
            title,
            status: "breached".into(),
            count,
            detail: format!(
                "Seen {count} time{} in known breaches — change this password",
                if count == 1 { "" } else { "s" }
            ),
        },
        acuye_breach::BreachStatus::Unavailable { reason } => BreachItemView {
            id,
            title,
            status: "unavailable".into(),
            count: 0,
            detail: format!("Could not check: {reason}"),
        },
    }
}

/// Check one login item. The password never leaves the process; only five
/// characters of its SHA-1 leave, and nothing is logged.
#[tauri::command(async)]
pub fn breach_check_item(state: State<'_, AppState>, id: String) -> ApiResult<BreachItemView> {
    let (title, mut password) = {
        let mut core = lock_core(&state)?;
        let live = core.unlocked()?;
        let item = live
            .unlocked
            .vault
            .get(&id)
            .ok_or_else(|| ApiError::from(AcuyeError::NotFound("item".into())))?;
        let password = item
            .fields
            .password()
            .ok_or_else(|| ApiError::validation("That item has no password"))?
            .to_string();
        (item.title.clone(), password)
    };
    if password.is_empty() {
        return Err(ApiError::validation("That item has no password"));
    }
    let view = breach_view(id, title, &password);
    password.zeroize();
    Ok(view)
}

/// Check every login in the vault. Runs outside the vault lock so the UI stays
/// responsive while the range lookups happen.
#[tauri::command(async)]
pub fn breach_scan_vault(state: State<'_, AppState>) -> ApiResult<BreachScanView> {
    let mut candidates: Vec<(String, String, String)> = Vec::new();
    {
        let mut core = lock_core(&state)?;
        let live = core.unlocked()?;
        for item in &live.unlocked.vault.items {
            if let Some(password) = item.fields.password() {
                if !password.is_empty() {
                    candidates.push((item.id.clone(), item.title.clone(), password.to_string()));
                }
            }
        }
    }

    let mut results = Vec::with_capacity(candidates.len());
    for (id, title, mut password) in candidates {
        results.push(breach_view(id, title, &password));
        password.zeroize();
    }
    let breached = results.iter().filter(|r| r.status == "breached").count();
    let clean = results.iter().filter(|r| r.status == "clean").count();
    let unavailable = results.iter().filter(|r| r.status == "unavailable").count();
    Ok(BreachScanView {
        checked: results.len(),
        breached,
        clean,
        unavailable,
        results,
        scanned_at: now(),
    })
}

// ---------------------------------------------------------------------------
// LAN pairing
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanIdentityView {
    pub device_id: String,
    pub address: String,
    pub port: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanOfferView {
    pub device_id: String,
    pub address: String,
    pub uri: String,
    pub expires_at: Timestamp,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanPeerView {
    pub id: String,
    pub name: String,
    pub platform: String,
    pub address: String,
    pub paired_at: Timestamp,
    pub last_seen_at: Timestamp,
    pub revoked: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanPairView {
    pub peer: LanPeerView,
    pub sas: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct PairClaim {
    token: String,
    offer: PairingOffer,
}

#[derive(Debug, Serialize, Deserialize)]
struct PairReply {
    accepted: bool,
    sas: String,
    device_id: String,
}

fn peer_view(record: &LanPeerRow) -> LanPeerView {
    LanPeerView {
        id: record.id.clone(),
        name: record.name.clone(),
        platform: record.platform.clone(),
        address: record.address.clone(),
        paired_at: record.paired_at,
        last_seen_at: record.last_seen_at,
        revoked: record.revoked,
    }
}

fn peer_row(record: &PeerRecord) -> LanPeerRow {
    LanPeerRow {
        id: record.id.clone(),
        name: record.name.clone(),
        platform: record.platform.clone(),
        signing_key: record.signing_key.clone(),
        exchange_key: record.exchange_key.clone(),
        address: record.address.clone(),
        paired_at: record.paired_at,
        last_seen_at: record.last_seen_at,
        revoked: record.revoked,
    }
}

fn local_ipv4() -> String {
    std::net::UdpSocket::bind("0.0.0.0:0")
        .and_then(|socket| {
            // Connecting a UDP socket sends no packets; it just selects a route.
            socket.connect("192.168.1.1:9")?;
            socket.local_addr()
        })
        .map(|addr| addr.ip().to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string())
}

fn identity_from_core(core: &mut crate::state::Core) -> ApiResult<DeviceIdentity> {
    let live = core.unlocked()?;
    Ok(DeviceIdentity::from_vault_key(
        live.unlocked.vault_key.as_bytes(),
    )?)
}

fn device_label() -> (String, String) {
    (
        crate::state::device_hostname(),
        acuye_platform::platform_name().to_string(),
    )
}

#[tauri::command]
pub fn lan_identity(state: State<'_, AppState>) -> ApiResult<LanIdentityView> {
    let mut core = lock_core(&state)?;
    let identity = identity_from_core(&mut core)?;
    Ok(LanIdentityView {
        device_id: identity.device_id().to_string(),
        address: format!("{}:{LAN_PORT}", local_ipv4()),
        port: LAN_PORT,
    })
}

/// Create a fresh, signed pairing offer and remember it so the listener only
/// accepts that one code.
#[tauri::command]
pub fn lan_pairing_offer(state: State<'_, AppState>) -> ApiResult<LanOfferView> {
    let (identity, name, platform) = {
        let mut core = lock_core(&state)?;
        let identity = identity_from_core(&mut core)?;
        let (name, platform) = device_label();
        (identity, name, platform)
    };
    let address = format!("{}:{LAN_PORT}", local_ipv4());
    let at = now();
    let uri = build_pairing_uri(&identity, &name, &platform, &address, at)?;
    let offer = parse_pairing_uri(&uri, at)?;
    let view = LanOfferView {
        device_id: identity.device_id().to_string(),
        address,
        uri,
        expires_at: offer.expires_at,
    };
    let mut pending = state.lan_pending.lock().map_err(|_| ApiError::internal())?;
    *pending = Some(offer);
    Ok(view)
}

/// Wait for the other device to connect with the code just shown, and approve it.
#[tauri::command(async)]
pub fn lan_await_pairing(state: State<'_, AppState>, timeout_secs: u64) -> ApiResult<LanPairView> {
    let (identity, offer) = {
        let mut core = lock_core(&state)?;
        let identity = identity_from_core(&mut core)?;
        let pending = state
            .lan_pending
            .lock()
            .map_err(|_| ApiError::internal())?
            .clone()
            .ok_or_else(|| ApiError::validation("Show a pairing code first"))?;
        (identity, pending)
    };
    let timeout = Duration::from_secs(timeout_secs.clamp(5, 600));
    let listener = LanListener::bind(LAN_PORT)?;
    let mut channel = listener.accept(timeout)?;
    let mut session = handshake(&identity, Role::Responder, &mut channel)?;
    let claim_bytes = session.decrypt(&channel.receive()?)?;
    let claim: PairClaim = serde_json::from_slice(&claim_bytes)
        .map_err(|_| ApiError::validation("Invalid pairing message"))?;
    if claim.token != offer.token {
        return Err(ApiError::validation(
            "That pairing code is not the one displayed here",
        ));
    }
    let at = now();
    let remote = claim.offer;
    remote.validate(at)?;
    let pairing = acuye_storage::LanPeerRow {
        id: remote.device_id.clone(),
        name: remote.name.clone(),
        platform: remote.platform.clone(),
        signing_key: remote.signing_key.clone(),
        exchange_key: remote.exchange_key.clone(),
        address: remote.address.clone(),
        paired_at: at,
        last_seen_at: at,
        revoked: false,
    };
    {
        let mut core = lock_core(&state)?;
        core.auth.db_mut().upsert_lan_peer(&pairing)?;
    }
    let reply = PairReply {
        accepted: true,
        sas: session.sas_code(),
        device_id: identity.device_id().to_string(),
    };
    let payload = serde_json::to_vec(&reply).map_err(|_| ApiError::internal())?;
    channel.send(&session.encrypt(&payload)?)?;
    Ok(LanPairView {
        peer: peer_view(&pairing),
        sas: session.sas_code(),
    })
}

/// Pair with the device whose QR code was scanned.
#[tauri::command(async)]
pub fn lan_pair(state: State<'_, AppState>, uri: String) -> ApiResult<LanPairView> {
    let at = now();
    let remote = parse_pairing_uri(&uri, at)?;
    let (identity, name, platform) = {
        let mut core = lock_core(&state)?;
        let identity = identity_from_core(&mut core)?;
        let (name, platform) = device_label();
        (identity, name, platform)
    };
    let own_address = format!("{}:{LAN_PORT}", local_ipv4());
    let own_uri = build_pairing_uri(&identity, &name, &platform, &own_address, at)?;
    let own_offer = parse_pairing_uri(&own_uri, at)?;

    let mut channel = TcpChannel::connect(&remote.address, LAN_TIMEOUT)?;
    let mut session = handshake(&identity, Role::Initiator, &mut channel)?;
    let claim = PairClaim {
        token: remote.token.clone(),
        offer: own_offer,
    };
    let payload = serde_json::to_vec(&claim).map_err(|_| ApiError::internal())?;
    channel.send(&session.encrypt(&payload)?)?;
    let reply_bytes = session.decrypt(&channel.receive()?)?;
    let reply: PairReply = serde_json::from_slice(&reply_bytes)
        .map_err(|_| ApiError::validation("Invalid pairing reply"))?;
    if !reply.accepted {
        return Err(ApiError::validation("The other device refused the pairing"));
    }
    if session.sas_code() != reply.sas {
        return Err(ApiError::validation(
            "The pairing codes do not match — the connection may be intercepted",
        ));
    }
    let record = PeerRecord {
        id: remote.device_id.clone(),
        name: remote.name.clone(),
        platform: remote.platform.clone(),
        signing_key: remote.signing_key.clone(),
        exchange_key: remote.exchange_key.clone(),
        address: remote.address.clone(),
        paired_at: at,
        last_seen_at: at,
        revoked: false,
    };
    let row = peer_row(&record);
    {
        let mut core = lock_core(&state)?;
        core.auth.db_mut().upsert_lan_peer(&row)?;
    }
    Ok(LanPairView {
        peer: peer_view(&row),
        sas: session.sas_code(),
    })
}

#[tauri::command]
pub fn lan_peers(state: State<'_, AppState>) -> ApiResult<Vec<LanPeerView>> {
    let core = lock_core(&state)?;
    Ok(core.auth.db().lan_peers()?.iter().map(peer_view).collect())
}

#[tauri::command]
pub fn lan_revoke_peer(state: State<'_, AppState>, id: String, revoke: bool) -> ApiResult<()> {
    let mut core = lock_core(&state)?;
    core.auth
        .db_mut()
        .set_lan_peer_revoked(&id, revoke, now())?;
    Ok(())
}

#[tauri::command]
pub fn lan_forget_peer(state: State<'_, AppState>, id: String) -> ApiResult<()> {
    let mut core = lock_core(&state)?;
    core.auth.db_mut().delete_lan_peer(&id)?;
    Ok(())
}

/// Open an authenticated session to a paired device. The peer must still be
/// approved, and both sides must derive the same six-digit code.
#[tauri::command(async)]
pub fn lan_test_peer(state: State<'_, AppState>, id: String) -> ApiResult<LanPairView> {
    let (identity, peer_row_data, store) = {
        let mut core = lock_core(&state)?;
        let identity = identity_from_core(&mut core)?;
        let rows = core.auth.db().lan_peers()?;
        let peer = rows
            .iter()
            .find(|row| row.id == id)
            .ok_or_else(|| ApiError::from(AcuyeError::NotFound("device".into())))?
            .clone();
        let store = TrustStore::new(
            rows.iter()
                .map(|row| PeerRecord {
                    id: row.id.clone(),
                    name: row.name.clone(),
                    platform: row.platform.clone(),
                    signing_key: row.signing_key.clone(),
                    exchange_key: row.exchange_key.clone(),
                    address: row.address.clone(),
                    paired_at: row.paired_at,
                    last_seen_at: row.last_seen_at,
                    revoked: row.revoked,
                })
                .collect(),
        );
        (identity, peer, store)
    };

    let mut channel = TcpChannel::connect(&peer_row_data.address, LAN_TIMEOUT)?;
    let mut session = handshake(&identity, Role::Initiator, &mut channel)?;
    if store.approved_for_key(session.remote_static()).is_none() {
        return Err(ApiError::validation(
            "The device that answered is not the approved one",
        ));
    }
    let sas = session.sas_code();
    channel.send(&session.encrypt(b"acuye-lan-ping")?)?;
    let reply = session.decrypt(&channel.receive()?)?;
    if reply != b"acuye-lan-pong" {
        return Err(ApiError::validation(
            "The other device did not answer the handshake",
        ));
    }
    {
        let mut core = lock_core(&state)?;
        core.auth.db_mut().touch_lan_peer(&id, now())?;
    }
    Ok(LanPairView {
        peer: peer_view(&peer_row_data),
        sas,
    })
}

// ---------------------------------------------------------------------------
// LAN sync
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanSyncView {
    pub peer_name: String,
    /// Items the peer offered.
    pub received: usize,
    /// Items this device offered.
    pub sent: usize,
    /// Items merged into this vault (new or newer).
    pub merged: usize,
    pub sas: String,
}

/// Everything one side needs to run a sync round, read while the vault is
/// unlocked and then used without holding the lock during network I/O.
struct SyncContext {
    identity_proof: String,
    username: String,
    vault_id: String,
    vault_key: Vec<u8>,
    bundle: SyncBundle,
}

fn sync_context(core: &mut crate::state::Core, handshake_hash: &[u8]) -> ApiResult<SyncContext> {
    let (username, vault_id, vault_key) = {
        let live = core.unlocked()?;
        (
            live.unlocked.username.clone(),
            live.unlocked.vault.id.clone(),
            live.unlocked.vault_key.to_vec(),
        )
    };
    let proof = vault_proof(&vault_key, handshake_hash)?;
    let stored = core.auth.db().load_items(&vault_id)?;
    let bundle = SyncBundle {
        items: stored
            .into_iter()
            .map(|item| SyncItem {
                id: item.id,
                updated_at: item.updated_at,
                nonce: acuye_crypto::b64_encode(&item.nonce),
                ciphertext: acuye_crypto::b64_encode(&item.ciphertext),
            })
            .collect(),
    };
    Ok(SyncContext {
        identity_proof: proof,
        username,
        vault_id,
        vault_key,
        bundle,
    })
}

/// Merge a peer bundle: newer items win, nothing is deleted, and the result is
/// re-encrypted locally before it reaches the database.
fn merge_bundle(
    core: &mut crate::state::Core,
    vault_id: &str,
    bundle: SyncBundle,
) -> ApiResult<usize> {
    use std::collections::HashMap;

    let key = core.unlocked()?.unlocked.vault_key.clone();
    let mut local: HashMap<String, i64> = core
        .auth
        .db()
        .load_items(vault_id)?
        .into_iter()
        .map(|item| (item.id, item.updated_at))
        .collect();

    let mut merged = 0usize;
    for item in bundle.items {
        if let Some(existing) = local.get(&item.id) {
            if *existing >= item.updated_at {
                continue;
            }
        }
        let nonce = acuye_crypto::b64_decode(&item.nonce)?;
        let ciphertext = acuye_crypto::b64_decode(&item.ciphertext)?;
        if nonce.len() != acuye_storage::NONCE_LEN || ciphertext.is_empty() {
            continue;
        }
        // Decrypt with the shared vault key before storing, so a payload that
        // does not belong to this vault is dropped instead of persisted.
        let sealed = acuye_crypto::Sealed {
            nonce: nonce.clone(),
            ciphertext: ciphertext.clone(),
        };
        let decrypted = match acuye_vault::codec::decrypt_item(&key, vault_id, &item.id, &sealed) {
            Ok(decrypted) => decrypted,
            Err(_) => continue,
        };
        core.auth.db().upsert_item(&acuye_storage::StoredItem {
            id: item.id.clone(),
            vault_id: vault_id.to_string(),
            nonce,
            ciphertext,
            updated_at: item.updated_at,
        })?;
        let live = core.unlocked()?;
        if live.unlocked.vault.get(&item.id).is_some() {
            live.unlocked.vault.update(decrypted)?;
        } else {
            live.unlocked.vault.add(decrypted)?;
        }
        local.insert(item.id, item.updated_at);
        merged += 1;
    }
    Ok(merged)
}

/// Exchange vaults with a paired device. The peer must be approved, signed into
/// the same account, and able to prove it holds the same vault key — otherwise
/// nothing is exchanged.
#[tauri::command(async)]
pub fn lan_sync_peer(state: State<'_, AppState>, id: String) -> ApiResult<LanSyncView> {
    let peer = {
        let core = lock_core(&state)?;
        core.auth
            .db()
            .lan_peers()?
            .into_iter()
            .find(|row| row.id == id)
            .ok_or_else(|| ApiError::from(AcuyeError::NotFound("device".into())))?
    };
    if peer.revoked {
        return Err(ApiError::validation("That device is revoked"));
    }

    let identity = {
        let mut core = lock_core(&state)?;
        let live = core.unlocked()?;
        DeviceIdentity::from_vault_key(live.unlocked.vault_key.as_bytes())?
    };
    let mut channel = TcpChannel::connect(&peer.address, LAN_TIMEOUT)?;
    let mut session = handshake(&identity, Role::Initiator, &mut channel)?;
    let trusted = {
        let core = lock_core(&state)?;
        let store = trust_store(&core.auth.db().lan_peers()?);
        store.approved_for_key(session.remote_static()).is_some()
    };
    if !trusted {
        return Err(ApiError::validation(
            "The device that answered is not the approved one",
        ));
    }
    let sas = session.sas_code();

    let (username, vault_id, vault_key, proof, bundle) = {
        let mut core = lock_core(&state)?;
        let context = sync_context(&mut core, session.handshake_hash())?;
        (
            context.username,
            context.vault_id,
            context.vault_key,
            context.identity_proof,
            context.bundle,
        )
    };
    let sent = bundle.items.len();

    let local_identity = VaultIdentity {
        username: username.clone(),
        vault_id: vault_id.clone(),
        proof: proof.clone(),
    };
    let identity_payload = serde_json::to_vec(&local_identity).map_err(|_| ApiError::internal())?;
    channel.send(&session.encrypt(&identity_payload)?)?;
    let peer_identity: VaultIdentity =
        serde_json::from_slice(&session.decrypt(&channel.receive()?)?)
            .map_err(|_| ApiError::validation("Invalid sync greeting"))?;
    peer_identity.verify_against(&username, &vault_id, &proof)?;

    channel.send(&session.encrypt(&seal_bundle(&vault_key, &vault_id, &bundle)?)?)?;
    let remote_payload = session.decrypt(&channel.receive()?)?;
    let remote_bundle = open_bundle(&vault_key, &vault_id, &remote_payload)?;
    let received = remote_bundle.items.len();
    let merged = {
        let mut core = lock_core(&state)?;
        merge_bundle(&mut core, &vault_id, remote_bundle)?
    };
    let mut vault_key = vault_key;
    vault_key.zeroize();

    Ok(LanSyncView {
        peer_name: peer.name,
        received,
        sent,
        merged,
        sas,
    })
}

/// Accept one incoming sync from an approved device.
#[tauri::command(async)]
pub fn lan_accept_sync(state: State<'_, AppState>, timeout_secs: u64) -> ApiResult<LanSyncView> {
    let identity = {
        let mut core = lock_core(&state)?;
        let live = core.unlocked()?;
        DeviceIdentity::from_vault_key(live.unlocked.vault_key.as_bytes())?
    };
    let timeout = Duration::from_secs(timeout_secs.clamp(5, 600));
    let listener = LanListener::bind(LAN_PORT)?;
    let mut channel = listener.accept(timeout)?;
    let mut session = handshake(&identity, Role::Responder, &mut channel)?;
    let trusted = {
        let core = lock_core(&state)?;
        let rows = core.auth.db().lan_peers()?;
        let store = trust_store(&rows);
        store
            .approved_for_key(session.remote_static())
            .map(|peer| peer.name.clone())
    };
    let Some(peer_name) = trusted else {
        return Err(ApiError::validation(
            "That device is not paired with this vault",
        ));
    };
    let sas = session.sas_code();

    let (username, vault_id, vault_key, proof, bundle) = {
        let mut core = lock_core(&state)?;
        let context = sync_context(&mut core, session.handshake_hash())?;
        (
            context.username,
            context.vault_id,
            context.vault_key,
            context.identity_proof,
            context.bundle,
        )
    };
    let sent = bundle.items.len();

    let peer_identity: VaultIdentity =
        serde_json::from_slice(&session.decrypt(&channel.receive()?)?)
            .map_err(|_| ApiError::validation("Invalid sync greeting"))?;
    peer_identity.verify_against(&username, &vault_id, &proof)?;
    let local_identity = VaultIdentity {
        username: username.clone(),
        vault_id: vault_id.clone(),
        proof,
    };
    let identity_payload = serde_json::to_vec(&local_identity).map_err(|_| ApiError::internal())?;
    channel.send(&session.encrypt(&identity_payload)?)?;

    let remote_payload = session.decrypt(&channel.receive()?)?;
    let remote_bundle = open_bundle(&vault_key, &vault_id, &remote_payload)?;
    let received = remote_bundle.items.len();
    let merged = {
        let mut core = lock_core(&state)?;
        merge_bundle(&mut core, &vault_id, remote_bundle)?
    };
    channel.send(&session.encrypt(&seal_bundle(&vault_key, &vault_id, &bundle)?)?)?;
    let mut vault_key = vault_key;
    vault_key.zeroize();

    Ok(LanSyncView {
        peer_name,
        received,
        sent,
        merged,
        sas,
    })
}

fn trust_store(rows: &[LanPeerRow]) -> TrustStore {
    TrustStore::new(
        rows.iter()
            .map(|row| PeerRecord {
                id: row.id.clone(),
                name: row.name.clone(),
                platform: row.platform.clone(),
                signing_key: row.signing_key.clone(),
                exchange_key: row.exchange_key.clone(),
                address: row.address.clone(),
                paired_at: row.paired_at,
                last_seen_at: row.last_seen_at,
                revoked: row.revoked,
            })
            .collect(),
    )
}

/// Answer an authenticated LAN ping. Used by the receiving device while
/// testing a connection; runs one handshake and returns.
#[tauri::command(async)]
pub fn lan_answer_ping(state: State<'_, AppState>, timeout_secs: u64) -> ApiResult<()> {
    let identity = {
        let mut core = lock_core(&state)?;
        identity_from_core(&mut core)?
    };
    let timeout = Duration::from_secs(timeout_secs.clamp(5, 300));
    let listener = LanListener::bind(LAN_PORT)?;
    let mut channel = listener.accept(timeout)?;
    let mut session = handshake(&identity, Role::Responder, &mut channel)?;
    let message = session.decrypt(&channel.receive()?)?;
    if message == b"acuye-lan-ping" {
        channel.send(&session.encrypt(b"acuye-lan-pong")?)?;
    }
    Ok(())
}
