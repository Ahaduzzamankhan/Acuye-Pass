# Sync

Acuye Pass has two distinct sync stories, and it is important not to confuse
them:

| | **LAN sync** | **`acuye-sync/1` (BYOB)** |
| --- | --- | --- |
| Status | Implemented, usable today | Specification and transport trait only |
| Transport | Direct connection to a paired peer on your LAN | Your own HTTPS endpoint |
| Server | None | Yours (Worker, VPS, R2, database) |
| Trust | Noise XX handshake + vault-key proof | Device authentication at your server |
| Use case | Moving a vault between two PCs you own | Multi-device sync you control |

---

## LAN sync

### Trust model

- A device identity is derived from the vault key with HKDF (`acuye-lan`), so it
  is stable per vault, unique per vault, and never stored as a standalone secret.
- Each device has a signing key pair and an exchange key pair derived from that
  identity.
- Pairing is a signed, short-lived offer (TTL 300 seconds) carried in a QR code:

```
acuye-lan://pair/<base64url payload>
```

The payload contains the device id, public keys, the LAN address and a one-time
token. Parsing validates the scheme, version, expiry and address before anything
is dialled.

### Handshake

1. The approving device scans the offer and validates it.
2. Both sides run `Noise_XX_25519_ChaChaPoly_BLAKE2s`, exchanging static keys.
3. Each side proves knowledge of the vault key over the handshake hash
   (`vault_proof`), and the other verifies it in constant time. Pairing fails if
   either side cannot prove vault possession.
4. The peer is recorded in the local trust store: id, keys, address, approval
   time. It can be revoked or forgotten at any time.

Address validation rejects loopback, link-local, private-by-mistake and
malformed hosts so the pairing path cannot be used to reach arbitrary services.
Frames are capped at `MAX_FRAME_BYTES` (1 MiB).

### Bundle format

A sync bundle is a versioned payload of item records sealed with a key derived
from the vault key and bound to the vault id (`seal_bundle` / `open_bundle`).
The receiving side verifies the AEAD tag before touching any item.

Operations carried per item:

- `upsert` — encrypted item blob (nonce + ciphertext + updated_at + id)
- `delete` — item id + tombstone timestamp

Conflict handling is per item: the newest `updated_at` wins, and deletes are
tombstones so an offline device cannot resurrect a deleted item.

### UI

Settings → Devices, and the `DevicesPage`:

- show this device's identity and pairing QR
- await a pairing request and approve or reject it
- list approved peers with last-seen time
- test connectivity, sync now, revoke or forget a peer

Revoked devices cannot sync. There is no automatic background sync; you trigger
it.

---

## `acuye-sync/1` (bring your own backend)

Status: **specification and transport abstraction only.** No provider is
implemented or enabled in this release. The app works fully offline; the
settings screen accepts an endpoint and explains that the engine is not enabled.

### Principles

- The server is untrusted storage. Only ciphertext and metadata leave the device.
- The vault key never leaves the device.
- Conflicts resolve per item, never by discarding a whole vault.
- The protocol is versioned; unknown versions fail closed.

### Envelope

```
{
  "protocol": "acuye-sync/1",
  "vault_id": "<uuid>",
  "device_id": "<uuid>",
  "operations": [ ... ]
}
```

Limits: at most 500 operations per push (`MAX_OPERATIONS_PER_PUSH`). Requests
larger than the limit are rejected rather than truncated.

### Operations

- `upsert_item` — encrypted item blob (nonce + ciphertext + updated_at + id)
- `delete_item` — item id + tombstone timestamp
- `vault_meta` — encrypted name/settings blob
- `device_register` / `device_revoke`

Operations carry a monotonically increasing `revision`. A client includes the
last revision it has seen; the server returns everything after it.

### Transport

`acuye-sync` exposes a `Transport` trait with `push` and `pull`. A provider
implementation must:

- authenticate the device (not the master password),
- store opaque blobs without decrypting them,
- enforce per-vault authorization,
- reject oversized payloads,
- never log request bodies.

The settings UI stores the endpoint and device name only; nothing is transmitted
until a transport exists and the user enables sync.

### Conflict handling

Items are compared by `updated_at` and revision. The newest revision wins; both
versions of a conflict are retained in a conflict log for user review. Deletes
are tombstones so an offline device cannot resurrect deleted items.

### Security notes

- Metadata leakage (item counts, sizes, timestamps) is inherent to encrypted
  sync; providers should minimize retention.
- A compromised server can delete or withhold data. Keep local backups.
- The protocol does not yet define key sharing between users.
- Implementing a transport is a security-relevant change: it needs tests for
  authentication, oversized payload rejection and conflict retention, and it
  must not log request bodies.
