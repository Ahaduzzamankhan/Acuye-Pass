# Sync protocol (`acuye-sync/1`)

Status: **specification and transport abstraction only.** No sync provider is
implemented or enabled in this release. The app works fully offline; the
settings screen explains that sync is not configured.

## Principles

- The server is untrusted storage. Only ciphertext and metadata leave the
  device.
- The vault key never leaves the device.
- Conflicts resolve per item, never by discarding a whole vault.
- The protocol is versioned; unknown versions fail closed.

## Envelope

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

## Operations

- `upsert_item` — encrypted item blob (nonce + ciphertext + updated_at + id)
- `delete_item` — item id + tombstone timestamp
- `vault_meta` — encrypted name/settings blob
- `device_register` / `device_revoke`

Operations carry a monotonically increasing `revision`. A client includes the
last revision it has seen; the server returns everything after it.

## Transport

`acuye-sync` exposes a `Transport` trait with `push` and `pull`. A provider
implementation must:

- authenticate the device (not the master password),
- store opaque blobs without decrypting them,
- enforce per-vault authorization,
- reject oversized payloads,
- never log request bodies.

## Conflict handling

Items are compared by `updated_at` and revision. The newest revision wins; both
versions of a conflict are retained in a conflict log for user review. Deletes
are tombstones so an offline device cannot resurrect deleted items.

## Security notes

- Metadata leakage (item counts, sizes, timestamps) is inherent to encrypted
  sync; providers should minimize retention.
- A compromised server can delete or withhold data. Keep local backups.
- The protocol does not yet define key sharing between users.
