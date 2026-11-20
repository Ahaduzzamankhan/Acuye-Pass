//! Hostless LAN pairing and mutual authentication.
//!
//! Two PCs on the same network trust each other directly — there is no server,
//! no account and no discovery service, and everything works offline.
//!
//! Trust model:
//! * a device identity is **derived from the vault key** with HKDF, so it is
//!   stable for a vault, unique per vault, and never stored on its own;
//! * pairing is a signed, short-lived offer carried in a QR code that contains
//!   the device's public keys, its LAN address and a one-time token;
//! * an approved peer is remembered locally (id, keys, address) and can be
//!   revoked at any time;
//! * sessions use Noise `XX_25519_ChaChaPoly_BLAKE2s`, which authenticates both
//!   static keys, and the resulting handshake hash is shown as a six-digit code
//!   the two users compare out of band.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::Duration;

use base64::Engine;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use hkdf::Hkdf;
use hmac::Mac;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use snow::params::NoiseParams;
use zeroize::Zeroize;

use acuye_core::{AcuyeError, Result};

/// QR payload scheme.
pub const PAIRING_SCHEME: &str = "acuye-lan://pair/";
/// Pairing payload format version.
pub const PAIRING_VERSION: u8 = 1;
/// A pairing offer is valid for five minutes.
pub const PAIRING_TTL_SECS: i64 = 300;
/// Largest accepted frame on an established session (1 MiB).
pub const MAX_FRAME_BYTES: usize = 1024 * 1024;
/// Noise protocol used for every peer session.
pub const NOISE_PARAMS: &str = "Noise_XX_25519_ChaChaPoly_BLAKE2s";
/// Binding used when deriving the device identity from the vault key.
const IDENTITY_INFO: &[u8] = b"acuye-lan-identity-v1";

fn b64(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn unb64(text: &str) -> Result<Vec<u8>> {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(text.trim())
        .map_err(|_| AcuyeError::Format)
}

/// The identity this device presents to peers.
///
/// Both keys are derived deterministically from the vault key: nothing extra is
/// written to disk, and unlocking the vault is what makes the device present.
pub struct DeviceIdentity {
    signing: SigningKey,
    exchange_secret: [u8; 32],
    device_id: String,
}

impl DeviceIdentity {
    /// Derive the per-vault device identity.
    pub fn from_vault_key(vault_key: &[u8]) -> Result<Self> {
        if vault_key.len() < 16 {
            return Err(AcuyeError::Validation(
                "The vault key is not available".into(),
            ));
        }
        let hkdf = Hkdf::<Sha256>::new(Some(IDENTITY_INFO), vault_key);
        let mut okm = [0u8; 64];
        hkdf.expand(b"acuye-lan-device-keys", &mut okm)
            .map_err(|_| AcuyeError::Internal)?;
        let mut seed = [0u8; 32];
        seed.copy_from_slice(&okm[..32]);
        let signing = SigningKey::from_bytes(&seed);
        let mut exchange_secret = [0u8; 32];
        exchange_secret.copy_from_slice(&okm[32..]);
        seed.zeroize();
        okm.zeroize();
        let device_id = short_id(signing.verifying_key().as_bytes());
        Ok(Self {
            signing,
            exchange_secret,
            device_id,
        })
    }

    pub fn device_id(&self) -> &str {
        &self.device_id
    }

    pub fn signing_public(&self) -> [u8; 32] {
        self.signing.verifying_key().to_bytes()
    }

    pub fn exchange_public(&self) -> [u8; 32] {
        let secret = x25519_dalek::StaticSecret::from(self.exchange_secret);
        x25519_dalek::PublicKey::from(&secret).to_bytes()
    }

    fn noise_builder(&self, initiator: bool) -> Result<snow::HandshakeState> {
        let params: NoiseParams = NOISE_PARAMS.parse().map_err(|_| AcuyeError::Internal)?;
        let builder = snow::Builder::new(params).local_private_key(&self.exchange_secret);
        let state = if initiator {
            builder.build_initiator()
        } else {
            builder.build_responder()
        };
        state.map_err(|_| AcuyeError::Validation("The secure channel could not be started".into()))
    }
}

/// Stable, non-secret identifier: the first 8 bytes of SHA-256 over a public key.
fn short_id(public_key: &[u8]) -> String {
    let digest = Sha256::digest(public_key);
    digest[..8].iter().map(|b| format!("{b:02x}")).collect()
}

/// What a QR code carries when one device pairs with another.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PairingOffer {
    pub version: u8,
    pub device_id: String,
    pub name: String,
    pub platform: String,
    pub signing_key: String,
    pub exchange_key: String,
    pub address: String,
    pub token: String,
    pub expires_at: i64,
}

impl PairingOffer {
    /// Validate shape, freshness and key lengths.
    pub fn validate(&self, now: i64) -> Result<()> {
        if self.version != PAIRING_VERSION {
            return Err(AcuyeError::Validation(
                "This pairing code comes from a different version".into(),
            ));
        }
        if self.expires_at <= now {
            return Err(AcuyeError::Validation(
                "This pairing code has expired — show a new one".into(),
            ));
        }
        if self.name.trim().is_empty() || self.name.chars().count() > 64 {
            return Err(AcuyeError::Validation("Invalid device name".into()));
        }
        if self.platform.chars().count() > 32 {
            return Err(AcuyeError::Validation("Invalid platform".into()));
        }
        if unb64(&self.signing_key)?.len() != 32 || unb64(&self.exchange_key)?.len() != 32 {
            return Err(AcuyeError::Validation("Invalid device key material".into()));
        }
        if unb64(&self.token)?.len() < 16 {
            return Err(AcuyeError::Validation("Invalid pairing token".into()));
        }
        validate_address(&self.address)
    }
}

/// Accept `host:port` or `[v6]:port` with a usable port.
pub fn validate_address(address: &str) -> Result<()> {
    let trimmed = address.trim();
    if trimmed.is_empty() || trimmed.len() > 255 {
        return Err(AcuyeError::Validation("Invalid LAN address".into()));
    }
    let (host, port) = trimmed
        .rsplit_once(':')
        .ok_or_else(|| AcuyeError::Validation("Invalid LAN address".into()))?;
    if host.trim_matches(['[', ']']).is_empty() {
        return Err(AcuyeError::Validation("Invalid LAN address".into()));
    }
    let port: u16 = port
        .parse()
        .map_err(|_| AcuyeError::Validation("Invalid LAN port".into()))?;
    if port == 0 {
        return Err(AcuyeError::Validation("Invalid LAN port".into()));
    }
    Ok(())
}

/// Build a signed pairing URI (the text to render as a QR code).
pub fn build_pairing_uri(
    identity: &DeviceIdentity,
    name: &str,
    platform: &str,
    address: &str,
    now: i64,
) -> Result<String> {
    let offer = PairingOffer {
        version: PAIRING_VERSION,
        device_id: identity.device_id().to_string(),
        name: name.trim().to_string(),
        platform: platform.trim().to_string(),
        signing_key: b64(&identity.signing_public()),
        exchange_key: b64(&identity.exchange_public()),
        address: address.trim().to_string(),
        token: b64(&acuye_crypto::random_bytes(32)),
        expires_at: now + PAIRING_TTL_SECS,
    };
    offer.validate(now)?;
    let payload = serde_json::to_vec(&offer)?;
    let signature = identity.signing.sign(&payload);
    Ok(format!(
        "{PAIRING_SCHEME}{}.{}",
        b64(&payload),
        b64(&signature.to_bytes())
    ))
}

/// Parse and verify a scanned pairing URI.
pub fn parse_pairing_uri(uri: &str, now: i64) -> Result<PairingOffer> {
    let trimmed = uri.trim();
    let rest = trimmed
        .strip_prefix(PAIRING_SCHEME)
        .ok_or_else(|| AcuyeError::Validation("That is not an Acuye pairing code".into()))?;
    let (payload_b64, signature_b64) = rest
        .split_once('.')
        .ok_or_else(|| AcuyeError::Validation("The pairing code is malformed".into()))?;
    let payload = unb64(payload_b64)?;
    let signature_bytes = unb64(signature_b64)?;
    let signature_bytes: [u8; 64] = signature_bytes
        .try_into()
        .map_err(|_| AcuyeError::Validation("The pairing code is malformed".into()))?;
    let offer: PairingOffer = serde_json::from_slice(&payload).map_err(|_| AcuyeError::Format)?;
    offer.validate(now)?;
    let key_bytes: [u8; 32] = unb64(&offer.signing_key)?
        .try_into()
        .map_err(|_| AcuyeError::Validation("Invalid device key material".into()))?;
    let key = VerifyingKey::from_bytes(&key_bytes)
        .map_err(|_| AcuyeError::Validation("Invalid device key material".into()))?;
    key.verify(&payload, &Signature::from_bytes(&signature_bytes))
        .map_err(|_| AcuyeError::Validation("The pairing code signature is not valid".into()))?;
    if offer.device_id != short_id(&key_bytes) {
        return Err(AcuyeError::Validation(
            "The pairing code does not match its device id".into(),
        ));
    }
    Ok(offer)
}

/// Proof that a device holds the same vault key, bound to one handshake.
///
/// Two devices can only produce the same value when they share the vault key,
/// which in practice means the same vault (and therefore the same master
/// password at the time the vault was created or restored). Mixing in the
/// handshake hash stops a proof captured from one session being replayed in
/// another.
pub fn vault_proof(vault_key: &[u8], handshake_hash: &[u8]) -> Result<String> {
    if vault_key.len() != 32 {
        return Err(AcuyeError::Validation(
            "The vault key is not available".into(),
        ));
    }
    let hkdf = Hkdf::<Sha256>::new(Some(b"acuye-lan-sync-auth-v1"), vault_key);
    let mut key = [0u8; 32];
    hkdf.expand(b"acuye-lan-sync-proof", &mut key)
        .map_err(|_| AcuyeError::Internal)?;
    let mut mac = hmac::Hmac::<Sha256>::new_from_slice(&key).map_err(|_| AcuyeError::Internal)?;
    key.zeroize();
    mac.update(b"acuye-lan-sync-v1");
    mac.update(handshake_hash);
    let digest = mac.finalize().into_bytes();
    Ok(digest[..16].iter().map(|b| format!("{b:02x}")).collect())
}

/// Constant-time comparison of two proofs.
pub fn proofs_match(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.as_bytes().iter().zip(b.as_bytes()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Account names match when they normalise to the same value.
pub fn usernames_match(a: &str, b: &str) -> bool {
    a.trim().to_lowercase() == b.trim().to_lowercase() && !a.trim().is_empty()
}

/// What a device tells its peer before any vault data is exchanged.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VaultIdentity {
    pub username: String,
    pub vault_id: String,
    pub proof: String,
}

impl VaultIdentity {
    /// Check that the peer is the same account on the same vault.
    pub fn verify_against(&self, username: &str, vault_id: &str, proof: &str) -> Result<()> {
        if !usernames_match(&self.username, username) {
            return Err(AcuyeError::Validation(
                "The other device is signed into a different account".into(),
            ));
        }
        if self.vault_id != vault_id {
            return Err(AcuyeError::Validation(
                "The other device holds a different vault — sync needs the same vault".into(),
            ));
        }
        if !proofs_match(&self.proof, proof) {
            return Err(AcuyeError::Validation(
                "The other device failed the vault password check".into(),
            ));
        }
        Ok(())
    }
}

/// One item travelling between two devices. Nonce and ciphertext are exactly
/// what the database holds, so only ciphertext ever crosses the wire.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncItem {
    pub id: String,
    pub updated_at: i64,
    pub nonce: String,
    pub ciphertext: String,
}

/// Everything one device offers its peer in a single sync round.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncBundle {
    pub items: Vec<SyncItem>,
}

/// Seal a sync bundle with the vault key, so even inside the Noise tunnel the
/// payload is ciphertext that only a device with the same vault can open.
pub fn seal_bundle(vault_key: &[u8], vault_id: &str, bundle: &SyncBundle) -> Result<Vec<u8>> {
    let key = vault_key_array(vault_key)?;
    let plaintext = serde_json::to_vec(bundle)?;
    let sealed = acuye_crypto::seal(&key, &bundle_aad(vault_id), &plaintext)?;
    let mut out = sealed.nonce;
    out.extend_from_slice(&sealed.ciphertext);
    Ok(out)
}

/// Open a sealed bundle. Fails closed on a different vault or tampering.
pub fn open_bundle(vault_key: &[u8], vault_id: &str, payload: &[u8]) -> Result<SyncBundle> {
    if payload.len() <= acuye_crypto::NONCE_LEN {
        return Err(AcuyeError::Format);
    }
    let key = vault_key_array(vault_key)?;
    let sealed = acuye_crypto::Sealed {
        nonce: payload[..acuye_crypto::NONCE_LEN].to_vec(),
        ciphertext: payload[acuye_crypto::NONCE_LEN..].to_vec(),
    };
    let plaintext = acuye_crypto::open(&key, &bundle_aad(vault_id), &sealed)?;
    serde_json::from_slice(&plaintext).map_err(|_| AcuyeError::Format)
}

fn vault_key_array(vault_key: &[u8]) -> Result<acuye_crypto::SecretKey> {
    let bytes: [u8; 32] = vault_key
        .try_into()
        .map_err(|_| AcuyeError::Validation("The vault key is not available".into()))?;
    Ok(acuye_crypto::SecretKey::from_bytes(bytes))
}

fn bundle_aad(vault_id: &str) -> Vec<u8> {
    format!("acuye-lan-sync-v1|{vault_id}").into_bytes()
}

/// A peer this device has approved.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PeerRecord {
    pub id: String,
    pub name: String,
    pub platform: String,
    pub signing_key: String,
    pub exchange_key: String,
    pub address: String,
    pub paired_at: i64,
    pub last_seen_at: i64,
    pub revoked: bool,
}

impl PeerRecord {
    pub fn from_offer(offer: &PairingOffer, now: i64) -> Self {
        Self {
            id: offer.device_id.clone(),
            name: offer.name.clone(),
            platform: offer.platform.clone(),
            signing_key: offer.signing_key.clone(),
            exchange_key: offer.exchange_key.clone(),
            address: offer.address.clone(),
            paired_at: now,
            last_seen_at: now,
            revoked: false,
        }
    }

    pub fn validate(&self) -> Result<()> {
        if self.id.is_empty() || self.name.is_empty() {
            return Err(AcuyeError::Validation("Invalid peer record".into()));
        }
        if unb64(&self.signing_key)?.len() != 32 || unb64(&self.exchange_key)?.len() != 32 {
            return Err(AcuyeError::Validation("Invalid peer key material".into()));
        }
        validate_address(&self.address)
    }
}

/// The set of approved peers.
#[derive(Debug, Clone, Default)]
pub struct TrustStore {
    peers: Vec<PeerRecord>,
}

impl TrustStore {
    pub fn new(peers: Vec<PeerRecord>) -> Self {
        Self { peers }
    }

    pub fn list(&self) -> &[PeerRecord] {
        &self.peers
    }

    pub fn get(&self, id: &str) -> Option<&PeerRecord> {
        self.peers.iter().find(|peer| peer.id == id)
    }

    /// Approve a scanned offer. Re-approving an existing peer refreshes its
    /// address and keys, and clears a previous revocation.
    pub fn approve(&mut self, offer: &PairingOffer, now: i64) -> Result<PeerRecord> {
        offer.validate(now)?;
        let record = PeerRecord::from_offer(offer, now);
        record.validate()?;
        match self.peers.iter_mut().find(|peer| peer.id == record.id) {
            Some(existing) => *existing = record.clone(),
            None => self.peers.push(record.clone()),
        }
        self.peers.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(record)
    }

    /// Revoke a peer: its static key is no longer accepted and its sessions fail.
    pub fn revoke(&mut self, id: &str, now: i64) -> Result<PeerRecord> {
        let peer = self
            .peers
            .iter_mut()
            .find(|peer| peer.id == id)
            .ok_or_else(|| AcuyeError::NotFound("device".into()))?;
        peer.revoked = true;
        peer.last_seen_at = peer.last_seen_at.max(now);
        Ok(peer.clone())
    }

    /// Remove a peer entirely.
    pub fn forget(&mut self, id: &str) -> Result<()> {
        let before = self.peers.len();
        self.peers.retain(|peer| peer.id != id);
        if before == self.peers.len() {
            return Err(AcuyeError::NotFound("device".into()));
        }
        Ok(())
    }

    pub fn touch(&mut self, id: &str, now: i64) {
        if let Some(peer) = self.peers.iter_mut().find(|peer| peer.id == id) {
            peer.last_seen_at = now;
        }
    }

    /// The approved peer whose exchange key matches the one presented in a
    /// handshake, ignoring revoked entries.
    pub fn approved_for_key(&self, exchange_key: &[u8]) -> Option<&PeerRecord> {
        self.peers.iter().find(|peer| {
            !peer.revoked && unb64(&peer.exchange_key).ok().as_deref() == Some(exchange_key)
        })
    }
}

/// Blocking message channel; the real implementation wraps a TCP stream and
/// tests use an in-memory pair.
pub trait Channel {
    fn send(&mut self, message: &[u8]) -> Result<()>;
    fn receive(&mut self) -> Result<Vec<u8>>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Initiator,
    Responder,
}

/// An established, encrypted session with a peer.
pub struct Session {
    transport: snow::TransportState,
    remote_static: Vec<u8>,
    handshake_hash: Vec<u8>,
}

impl Session {
    /// The peer's static X25519 key, to be checked against the trust store.
    pub fn remote_static(&self) -> &[u8] {
        &self.remote_static
    }

    /// Transcript hash, used to bind a vault proof to this one session.
    pub fn handshake_hash(&self) -> &[u8] {
        &self.handshake_hash
    }

    /// Six-digit code both devices display; equal codes mean no MITM.
    pub fn sas_code(&self) -> String {
        // Only the handshake hash is mixed in: it is identical on both sides
        // and already covers both static keys and the full transcript.
        let mut hasher = Sha256::new();
        hasher.update(b"acuye-lan-sas-v1");
        hasher.update(&self.handshake_hash);
        let digest = hasher.finalize();
        let value = u32::from_be_bytes([digest[0], digest[1], digest[2], digest[3]]) % 1_000_000;
        format!("{value:06}")
    }

    pub fn encrypt(&mut self, plaintext: &[u8]) -> Result<Vec<u8>> {
        let mut buffer = vec![0u8; plaintext.len() + 64];
        let len = self
            .transport
            .write_message(plaintext, &mut buffer)
            .map_err(|_| AcuyeError::Crypto)?;
        buffer.truncate(len);
        Ok(buffer)
    }

    pub fn decrypt(&mut self, ciphertext: &[u8]) -> Result<Vec<u8>> {
        let mut buffer = vec![0u8; ciphertext.len()];
        let len = self
            .transport
            .read_message(ciphertext, &mut buffer)
            .map_err(|_| AcuyeError::Crypto)?;
        buffer.truncate(len);
        Ok(buffer)
    }
}

/// Run the Noise XX handshake. Both sides learn the other's static key and the
/// same handshake hash; nothing is trusted until the caller checks the key
/// against its trust store.
pub fn handshake(
    identity: &DeviceIdentity,
    role: Role,
    channel: &mut dyn Channel,
) -> Result<Session> {
    let initiator = matches!(role, Role::Initiator);
    let mut state = identity.noise_builder(initiator)?;
    let mut buffer = vec![0u8; 65_535];
    if initiator {
        let len = state
            .write_message(&[], &mut buffer)
            .map_err(|_| AcuyeError::Crypto)?;
        channel.send(&buffer[..len])?;
        let message = channel.receive()?;
        state
            .read_message(&message, &mut buffer)
            .map_err(|_| AcuyeError::Crypto)?;
        let len = state
            .write_message(&[], &mut buffer)
            .map_err(|_| AcuyeError::Crypto)?;
        channel.send(&buffer[..len])?;
    } else {
        let message = channel.receive()?;
        state
            .read_message(&message, &mut buffer)
            .map_err(|_| AcuyeError::Crypto)?;
        let len = state
            .write_message(&[], &mut buffer)
            .map_err(|_| AcuyeError::Crypto)?;
        channel.send(&buffer[..len])?;
        let message = channel.receive()?;
        state
            .read_message(&message, &mut buffer)
            .map_err(|_| AcuyeError::Crypto)?;
    }
    let remote_static = state
        .get_remote_static()
        .ok_or(AcuyeError::Crypto)?
        .to_vec();
    let handshake_hash = state.get_handshake_hash().to_vec();
    let transport = state
        .into_transport_mode()
        .map_err(|_| AcuyeError::Crypto)?;
    Ok(Session {
        transport,
        remote_static,
        handshake_hash,
    })
}

/// A blocking TCP channel with length-prefixed frames.
pub struct TcpChannel {
    stream: TcpStream,
}

impl TcpChannel {
    pub fn connect(address: &str, timeout: Duration) -> Result<Self> {
        validate_address(address)?;
        let stream = TcpStream::connect(address)
            .map_err(|_| AcuyeError::Network("Could not reach that device".into()))?;
        stream
            .set_read_timeout(Some(timeout))
            .map_err(|_| AcuyeError::Network("Could not configure the connection".into()))?;
        stream
            .set_write_timeout(Some(timeout))
            .map_err(|_| AcuyeError::Network("Could not configure the connection".into()))?;
        stream
            .set_nodelay(true)
            .map_err(|_| AcuyeError::Network("Could not configure the connection".into()))?;
        Ok(Self { stream })
    }

    pub fn from_stream(stream: TcpStream, timeout: Duration) -> Result<Self> {
        stream
            .set_read_timeout(Some(timeout))
            .map_err(|_| AcuyeError::Network("Could not configure the connection".into()))?;
        stream
            .set_write_timeout(Some(timeout))
            .map_err(|_| AcuyeError::Network("Could not configure the connection".into()))?;
        Ok(Self { stream })
    }

    pub fn peer_address(&self) -> Option<std::net::SocketAddr> {
        self.stream.peer_addr().ok()
    }
}

impl Channel for TcpChannel {
    fn send(&mut self, message: &[u8]) -> Result<()> {
        if message.len() > MAX_FRAME_BYTES {
            return Err(AcuyeError::Validation("Message is too large".into()));
        }
        let len = (message.len() as u32).to_be_bytes();
        self.stream
            .write_all(&len)
            .and_then(|_| self.stream.write_all(message))
            .map_err(|_| AcuyeError::Network("The connection was lost".into()))
    }

    fn receive(&mut self) -> Result<Vec<u8>> {
        let mut len = [0u8; 4];
        self.stream
            .read_exact(&mut len)
            .map_err(|_| AcuyeError::Network("The connection was lost".into()))?;
        let len = u32::from_be_bytes(len) as usize;
        if len > MAX_FRAME_BYTES {
            return Err(AcuyeError::Validation("Message is too large".into()));
        }
        let mut message = vec![0u8; len];
        self.stream
            .read_exact(&mut message)
            .map_err(|_| AcuyeError::Network("The connection was lost".into()))?;
        Ok(message)
    }
}

/// The listening side of the LAN transport. It accepts connections only; it
/// speaks to nobody until a session authenticates.
pub struct LanListener {
    listener: TcpListener,
}

impl LanListener {
    pub fn bind(port: u16) -> Result<Self> {
        let listener = TcpListener::bind(("0.0.0.0", port))
            .map_err(|_| AcuyeError::Network("Could not listen on the LAN".into()))?;
        Ok(Self { listener })
    }

    pub fn local_port(&self) -> Result<u16> {
        self.listener
            .local_addr()
            .map(|addr| addr.port())
            .map_err(|_| AcuyeError::Network("Could not read the listening port".into()))
    }

    pub fn accept(&self, timeout: Duration) -> Result<TcpChannel> {
        let (stream, _) = self
            .listener
            .accept()
            .map_err(|_| AcuyeError::Network("No device connected".into()))?;
        TcpChannel::from_stream(stream, timeout)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::{channel as mpsc_channel, Receiver, Sender};

    fn identity(seed: u8) -> DeviceIdentity {
        DeviceIdentity::from_vault_key(&[seed; 32]).unwrap()
    }

    #[test]
    fn identity_is_deterministic_and_vault_specific() {
        let a = identity(1);
        let b = identity(1);
        let c = identity(2);
        assert_eq!(a.device_id(), b.device_id());
        assert_eq!(a.signing_public(), b.signing_public());
        assert_eq!(a.exchange_public(), b.exchange_public());
        assert_ne!(a.device_id(), c.device_id());
        assert_eq!(a.device_id().len(), 16);
        assert!(DeviceIdentity::from_vault_key(b"short").is_err());
    }

    #[test]
    fn pairing_uri_roundtrip_verifies_signature() {
        let alice = identity(3);
        let now = 1_700_000_000;
        let uri =
            build_pairing_uri(&alice, "Alices PC", "windows", "192.168.1.20:47821", now).unwrap();
        assert!(uri.starts_with(PAIRING_SCHEME));
        let offer = parse_pairing_uri(&uri, now + 10).unwrap();
        assert_eq!(offer.device_id, alice.device_id());
        assert_eq!(offer.name, "Alices PC");
        assert_eq!(offer.address, "192.168.1.20:47821");
        assert_eq!(offer.exchange_key, b64(&alice.exchange_public()));
    }

    #[test]
    fn tampered_or_expired_pairing_codes_are_rejected() {
        let alice = identity(4);
        let now = 1_700_000_000;
        let uri = build_pairing_uri(&alice, "Alice", "windows", "10.0.0.5:47821", now).unwrap();

        assert!(parse_pairing_uri(&uri, now + PAIRING_TTL_SECS + 1).is_err());

        // Flip a character inside the signed payload.
        let rest = uri.strip_prefix(PAIRING_SCHEME).unwrap();
        let (payload, signature) = rest.split_once('.').unwrap();
        let mut bytes = unb64(payload).unwrap();
        let last = bytes.len() - 2;
        bytes[last] = if bytes[last] == b'a' { b'b' } else { b'a' };
        let tampered = format!("{PAIRING_SCHEME}{}.{signature}", b64(&bytes));
        assert!(parse_pairing_uri(&tampered, now + 1).is_err());

        assert!(parse_pairing_uri("https://example.com", now).is_err());
        assert!(parse_pairing_uri("acuye-lan://pair/not-a-code", now).is_err());
    }

    #[test]
    fn vault_proof_requires_the_same_vault_key_and_session() {
        let key = [7u8; 32];
        let other = [8u8; 32];
        let hash = [1u8; 32];
        let a = vault_proof(&key, &hash).unwrap();
        assert_eq!(a, vault_proof(&key, &hash).unwrap());
        assert_ne!(a, vault_proof(&other, &hash).unwrap());
        assert_ne!(a, vault_proof(&key, &[2u8; 32]).unwrap());
        assert!(proofs_match(&a, &vault_proof(&key, &hash).unwrap()));
        assert!(!proofs_match(&a, &vault_proof(&other, &hash).unwrap()));
        assert!(vault_proof(b"short", &hash).is_err());
    }

    #[test]
    fn identity_verification_rejects_other_accounts_vaults_and_proofs() {
        let key = [3u8; 32];
        let hash = [4u8; 32];
        let proof = vault_proof(&key, &hash).unwrap();
        let identity = VaultIdentity {
            username: "Ada".into(),
            vault_id: "vault-1".into(),
            proof: proof.clone(),
        };
        assert!(identity.verify_against("ada", "vault-1", &proof).is_ok());
        assert!(identity.verify_against("bob", "vault-1", &proof).is_err());
        assert!(identity.verify_against("ada", "vault-2", &proof).is_err());
        let wrong = vault_proof(&[9u8; 32], &hash).unwrap();
        assert!(identity.verify_against("ada", "vault-1", &wrong).is_err());
    }

    #[test]
    fn sync_bundles_are_sealed_with_the_vault_key() {
        let key = [5u8; 32];
        let bundle = SyncBundle {
            items: vec![SyncItem {
                id: "item-1".into(),
                updated_at: 42,
                nonce: b64(&[1u8; 24]),
                ciphertext: b64(b"ciphertext"),
            }],
        };
        let sealed = seal_bundle(&key, "vault-1", &bundle).unwrap();
        assert!(!sealed.windows(10).any(|w| w == b"ciphertext"));
        assert_eq!(open_bundle(&key, "vault-1", &sealed).unwrap(), bundle);
        // A different vault, key or tampered payload cannot open it.
        assert!(open_bundle(&[6u8; 32], "vault-1", &sealed).is_err());
        assert!(open_bundle(&key, "vault-2", &sealed).is_err());
        let mut tampered = sealed.clone();
        let last = tampered.len() - 1;
        tampered[last] ^= 0xff;
        assert!(open_bundle(&key, "vault-1", &tampered).is_err());
    }

    #[test]
    fn address_validation_accepts_lan_and_rejects_garbage() {
        assert!(validate_address("192.168.1.4:47821").is_ok());
        assert!(validate_address("[fe80::1]:47821").is_ok());
        assert!(validate_address("dev-pc.local:47821").is_ok());
        assert!(validate_address("192.168.1.4").is_err());
        assert!(validate_address("192.168.1.4:0").is_err());
        assert!(validate_address(":47821").is_err());
    }

    #[test]
    fn approving_revoking_and_forgetting_peers() {
        let alice = identity(5);
        let bob = identity(6);
        let now = 1_700_000_000;
        let offer = parse_pairing_uri(
            &build_pairing_uri(&bob, "Bobs laptop", "windows", "192.168.1.30:47821", now).unwrap(),
            now,
        )
        .unwrap();

        let mut store = TrustStore::default();
        let record = store.approve(&offer, now).unwrap();
        assert_eq!(store.list().len(), 1);
        assert_eq!(record.id, bob.device_id());
        assert!(store.approved_for_key(&bob.exchange_public()).is_some());
        assert!(store.approved_for_key(&alice.exchange_public()).is_none());

        store.revoke(&record.id, now + 5).unwrap();
        assert!(store.approved_for_key(&bob.exchange_public()).is_none());
        assert!(store.get(&record.id).unwrap().revoked);

        // Re-approving clears the revocation.
        store.approve(&offer, now + 10).unwrap();
        assert!(store.approved_for_key(&bob.exchange_public()).is_some());

        store.forget(&record.id).unwrap();
        assert!(store.list().is_empty());
        assert!(store.forget(&record.id).is_err());
    }

    /// In-memory duplex channel backed by two mpsc queues.
    struct MemoryChannel {
        tx: Sender<Vec<u8>>,
        rx: Receiver<Vec<u8>>,
    }

    fn memory_pair() -> (MemoryChannel, MemoryChannel) {
        let (a_tx, a_rx) = mpsc_channel();
        let (b_tx, b_rx) = mpsc_channel();
        (
            MemoryChannel { tx: a_tx, rx: b_rx },
            MemoryChannel { tx: b_tx, rx: a_rx },
        )
    }

    impl Channel for MemoryChannel {
        fn send(&mut self, message: &[u8]) -> Result<()> {
            self.tx
                .send(message.to_vec())
                .map_err(|_| AcuyeError::Network("channel closed".into()))
        }

        fn receive(&mut self) -> Result<Vec<u8>> {
            self.rx
                .recv()
                .map_err(|_| AcuyeError::Network("channel closed".into()))
        }
    }

    #[test]
    fn noise_xx_handshake_authenticates_both_static_keys() {
        let alice = std::sync::Arc::new(identity(7));
        let bob = std::sync::Arc::new(identity(8));
        let (mut initiator_channel, mut responder_channel) = memory_pair();
        let alice_keys = (alice.signing_public(), alice.exchange_public());
        let bob_keys = (bob.signing_public(), bob.exchange_public());

        let alice_thread = {
            let alice = alice.clone();
            std::thread::spawn(move || {
                let mut session =
                    handshake(&alice, Role::Initiator, &mut initiator_channel).unwrap();
                let sas = session.sas_code();
                let cipher = session.encrypt(b"ping").unwrap();
                initiator_channel.send(&cipher).unwrap();
                let reply = initiator_channel.receive().unwrap();
                let plain = session.decrypt(&reply).unwrap();
                (sas, session.remote_static().to_vec(), plain)
            })
        };

        let mut session = handshake(&bob, Role::Responder, &mut responder_channel).unwrap();
        let bob_sas = session.sas_code();
        let cipher = responder_channel.receive().unwrap();
        assert_eq!(session.decrypt(&cipher).unwrap(), b"ping");
        let reply = session.encrypt(b"pong").unwrap();
        responder_channel.send(&reply).unwrap();

        let (alice_sas, alice_remote, plain) = alice_thread.join().unwrap();
        assert_eq!(plain, b"pong");
        assert_eq!(alice_sas, bob_sas, "both sides must show the same SAS");
        assert_eq!(alice_remote, bob_keys.1.to_vec());
        assert_eq!(session.remote_static(), alice_keys.1.as_slice());

        let store = TrustStore::new(vec![PeerRecord {
            id: alice.device_id().to_string(),
            name: "Alice".into(),
            platform: "windows".into(),
            signing_key: b64(&alice_keys.0),
            exchange_key: b64(&alice_keys.1),
            address: "192.168.1.10:47821".into(),
            paired_at: 0,
            last_seen_at: 0,
            revoked: false,
        }]);
        assert!(store.approved_for_key(session.remote_static()).is_some());
    }

    #[test]
    fn tampered_transport_messages_fail_to_decrypt() {
        let alice = identity(9);
        let bob = identity(10);
        let (mut a_channel, mut b_channel) = memory_pair();
        let handle = std::thread::spawn(move || {
            handshake(&alice, Role::Initiator, &mut a_channel).unwrap();
        });
        let mut session = handshake(&bob, Role::Responder, &mut b_channel).unwrap();
        handle.join().unwrap();
        let mut cipher = session.encrypt(b"secret-message").unwrap();
        let last = cipher.len() - 1;
        cipher[last] ^= 0xff;
        assert!(session.decrypt(&cipher).is_err());
    }
}
