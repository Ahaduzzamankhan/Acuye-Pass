//! Encrypted local persistence for Acuye Pass.
//!
//! SQLite is used as an *encrypted blob store*: account secrets are wrapped
//! keys/verifiers and every vault item is ciphertext produced by
//! `acuye-vault`. Nothing in this database is plaintext vault content, so a
//! stolen database file (or a missing WAL sidecar) does not reveal items.
//!
//! Migrations are append-only and tracked with `PRAGMA user_version`. They
//! never drop or truncate existing tables.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use acuye_core::{AccountRecord, AcuyeError, Result};
use rusqlite::{params, Connection, OptionalExtension};

const SCHEMA_VERSION: i32 = 4;
/// XChaCha20-Poly1305 nonce length. Rows must match exactly; a longer nonce can
/// never be opened and would only surface as a failed unlock.
pub const NONCE_LEN: usize = 24;
/// How many access-history rows are kept per secret item.
const MAX_SECRET_ACCESS_ROWS: i64 = 200;

fn storage_err(_err: rusqlite::Error) -> AcuyeError {
    // Do not forward driver messages: they may include SQL fragments.
    AcuyeError::Storage("the local database operation failed".into())
}

/// Append-only migrations. Index + 1 == resulting user_version.
const MIGRATIONS: &[&str] = &[
    // v1: initial schema
    r#"
    CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        username TEXT NOT NULL UNIQUE,
        kdf_algorithm TEXT NOT NULL,
        kdf_memory_kib INTEGER NOT NULL,
        kdf_iterations INTEGER NOT NULL,
        kdf_parallelism INTEGER NOT NULL,
        salt BLOB NOT NULL,
        verifier BLOB NOT NULL,
        wrapped_vault_key BLOB NOT NULL,
        vault_key_nonce BLOB NOT NULL,
        vault_id TEXT NOT NULL,
        vault_name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY NOT NULL,
        vault_id TEXT NOT NULL,
        nonce BLOB NOT NULL,
        ciphertext BLOB NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_items_vault ON items(vault_id);

    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        platform TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        revoked INTEGER NOT NULL DEFAULT 0,
        sync_registered INTEGER NOT NULL DEFAULT 0
    );
    "#,
    // v2: sync bookkeeping for the future BYOB engine (no network behaviour).
    r#"
    CREATE TABLE IF NOT EXISTS sync_state (
        vault_id TEXT PRIMARY KEY NOT NULL,
        local_revision INTEGER NOT NULL DEFAULT 0,
        remote_revision INTEGER NOT NULL DEFAULT 0,
        last_synced_at INTEGER,
        provider_endpoint TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_outbox (
        revision INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        queued_at INTEGER NOT NULL
    );
    "#,
    // v3: LAN peer trust list and secret access history. Neither table holds
    // secret material: peers store public keys only, the history stores actions
    // and timestamps only.
    r#"
    CREATE TABLE IF NOT EXISTS lan_peers (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        platform TEXT NOT NULL,
        signing_key TEXT NOT NULL,
        exchange_key TEXT NOT NULL,
        address TEXT NOT NULL,
        paired_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        revoked INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS secret_access (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id TEXT NOT NULL,
        action TEXT NOT NULL,
        at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_secret_access_item ON secret_access(item_id);
    "#,
    // v4: multiple local accounts. `accounts` used to be a singleton row
    // (`id = 1`); each row is now keyed by its vault id so several vaults can
    // live side by side in one database. Items already carry a vault id, so no
    // item or setting row is touched.
    r#"
    CREATE TABLE accounts_v4 (
        id TEXT PRIMARY KEY NOT NULL,
        username TEXT NOT NULL,
        kdf_algorithm TEXT NOT NULL,
        kdf_memory_kib INTEGER NOT NULL,
        kdf_iterations INTEGER NOT NULL,
        kdf_parallelism INTEGER NOT NULL,
        salt BLOB NOT NULL,
        verifier BLOB NOT NULL,
        wrapped_vault_key BLOB NOT NULL,
        vault_key_nonce BLOB NOT NULL,
        vault_id TEXT NOT NULL UNIQUE,
        vault_name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );

    INSERT INTO accounts_v4 (id, username, kdf_algorithm, kdf_memory_kib,
        kdf_iterations, kdf_parallelism, salt, verifier, wrapped_vault_key,
        vault_key_nonce, vault_id, vault_name, created_at, updated_at)
    SELECT vault_id, username, kdf_algorithm, kdf_memory_kib, kdf_iterations,
        kdf_parallelism, salt, verifier, wrapped_vault_key, vault_key_nonce,
        vault_id, vault_name, created_at, updated_at
    FROM accounts;

    DROP TABLE accounts;
    ALTER TABLE accounts_v4 RENAME TO accounts;
    "#,
];

/// One approved LAN peer. Public keys and an address only.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct LanPeerRow {
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

/// One entry of the secret access history: what happened, when, and to which
/// item — never the value that was copied or revealed.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct SecretAccessRow {
    pub item_id: String,
    pub action: String,
    pub at: i64,
}

/// One encrypted item row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredItem {
    pub id: String,
    pub vault_id: String,
    pub nonce: Vec<u8>,
    pub ciphertext: Vec<u8>,
    pub updated_at: i64,
}

/// A known device (local or previously synced).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct DeviceRecord {
    pub id: String,
    pub name: String,
    pub platform: String,
    pub created_at: i64,
    pub last_seen_at: i64,
    pub revoked: bool,
    pub sync_registered: bool,
}

/// One `sync_state` row: vault id, local revision, remote revision, last sync
/// timestamp and the configured provider endpoint.
pub type SyncStateRow = (String, i64, i64, Option<i64>, Option<String>);

/// One `sync_outbox` row: revision, item id, operation and queue timestamp.
pub type SyncOutboxRow = (i64, String, String, i64);

/// Handle to the local encrypted database.
pub struct Database {
    conn: Connection,
    path: Option<PathBuf>,
}

impl Database {
    /// Open (or create) the database at `path`, applying migrations.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(&path).map_err(storage_err)?;
        conn.busy_timeout(Duration::from_secs(5))
            .map_err(storage_err)?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = FULL;
             PRAGMA foreign_keys = ON;
             PRAGMA secure_delete = ON;
             PRAGMA trusted_schema = OFF;",
        )
        .map_err(storage_err)?;
        let mut db = Self {
            conn,
            path: Some(path),
        };
        db.migrate()?;
        Ok(db)
    }

    /// In-memory database, for tests only.
    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory().map_err(storage_err)?;
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA trusted_schema = OFF;",
        )
        .map_err(storage_err)?;
        let mut db = Self { conn, path: None };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&mut self) -> Result<()> {
        let current: i32 = self
            .conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(storage_err)?;
        if current > SCHEMA_VERSION {
            // The file was written by a newer build. Refuse to run instead of
            // risking data loss.
            return Err(AcuyeError::Unsupported(
                "this vault was created by a newer version of Acuye Pass".into(),
            ));
        }
        for (index, sql) in MIGRATIONS.iter().enumerate() {
            let version = index as i32 + 1;
            if current >= version {
                continue;
            }
            let tx = self.conn.transaction().map_err(storage_err)?;
            tx.execute_batch(sql).map_err(storage_err)?;
            tx.pragma_update(None, "user_version", version)
                .map_err(storage_err)?;
            tx.commit().map_err(storage_err)?;
        }
        Ok(())
    }

    pub fn schema_version(&self) -> Result<i32> {
        self.conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(storage_err)
    }

    pub fn path(&self) -> Option<&Path> {
        self.path.as_deref()
    }

    // ----- account ---------------------------------------------------------

    /// Every local account, oldest first. One row per vault.
    pub fn load_accounts(&self) -> Result<Vec<AccountRecord>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT username, kdf_algorithm, kdf_memory_kib, kdf_iterations,
                        kdf_parallelism, salt, verifier, wrapped_vault_key,
                        vault_key_nonce, vault_id, vault_name, created_at, updated_at
                 FROM accounts ORDER BY created_at ASC, username ASC",
            )
            .map_err(storage_err)?;
        let rows = stmt
            .query_map([], |row| {
                Ok(AccountRecord {
                    username: row.get(0)?,
                    kdf_algorithm: row.get(1)?,
                    kdf_memory_kib: row.get(2)?,
                    kdf_iterations: row.get(3)?,
                    kdf_parallelism: row.get(4)?,
                    salt: row.get(5)?,
                    verifier: row.get(6)?,
                    wrapped_vault_key: row.get(7)?,
                    vault_key_nonce: row.get(8)?,
                    vault_id: row.get(9)?,
                    vault_name: row.get(10)?,
                    created_at: row.get(11)?,
                    updated_at: row.get(12)?,
                })
            })
            .map_err(storage_err)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(storage_err)
    }

    /// The first local account. Kept for callers that only need "the" account
    /// (diagnostics, the browser host); use [`Self::load_accounts`] to list all.
    pub fn load_account(&self) -> Result<Option<AccountRecord>> {
        Ok(self.load_accounts()?.into_iter().next())
    }

    /// Look one account up by vault id.
    pub fn load_account_by_vault(&self, vault_id: &str) -> Result<Option<AccountRecord>> {
        Ok(self
            .load_accounts()?
            .into_iter()
            .find(|account| account.vault_id == vault_id))
    }

    /// Store one account. Several accounts may coexist; the vault id is the
    /// account id, so the same vault can never be inserted twice.
    pub fn insert_account(&self, account: &AccountRecord) -> Result<()> {
        if self.load_account_by_vault(&account.vault_id)?.is_some() {
            return Err(AcuyeError::Conflict("that vault already exists".into()));
        }
        self.conn
            .execute(
                "INSERT INTO accounts (id, username, kdf_algorithm, kdf_memory_kib,
                    kdf_iterations, kdf_parallelism, salt, verifier,
                    wrapped_vault_key, vault_key_nonce, vault_id, vault_name,
                    created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                params![
                    account.vault_id,
                    account.username,
                    account.kdf_algorithm,
                    account.kdf_memory_kib,
                    account.kdf_iterations,
                    account.kdf_parallelism,
                    account.salt,
                    account.verifier,
                    account.wrapped_vault_key,
                    account.vault_key_nonce,
                    account.vault_id,
                    account.vault_name,
                    account.created_at,
                    account.updated_at,
                ],
            )
            .map_err(storage_err)?;
        Ok(())
    }

    /// Replace account key material during password rotation.
    pub fn update_account(&self, account: &AccountRecord) -> Result<()> {
        let updated = self
            .conn
            .execute(
                "UPDATE accounts SET username = ?1, kdf_algorithm = ?2,
                    kdf_memory_kib = ?3, kdf_iterations = ?4, kdf_parallelism = ?5,
                    salt = ?6, verifier = ?7, wrapped_vault_key = ?8,
                    vault_key_nonce = ?9, vault_name = ?10, updated_at = ?11
                 WHERE vault_id = ?12",
                params![
                    account.username,
                    account.kdf_algorithm,
                    account.kdf_memory_kib,
                    account.kdf_iterations,
                    account.kdf_parallelism,
                    account.salt,
                    account.verifier,
                    account.wrapped_vault_key,
                    account.vault_key_nonce,
                    account.vault_name,
                    account.updated_at,
                    account.vault_id,
                ],
            )
            .map_err(storage_err)?;
        if updated != 1 {
            return Err(AcuyeError::NotFound("account".into()));
        }
        Ok(())
    }

    // ----- items -----------------------------------------------------------

    pub fn load_items(&self, vault_id: &str) -> Result<Vec<StoredItem>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, vault_id, nonce, ciphertext, updated_at
                 FROM items WHERE vault_id = ?1 ORDER BY updated_at ASC",
            )
            .map_err(storage_err)?;
        let rows = stmt
            .query_map(params![vault_id], |row| {
                Ok(StoredItem {
                    id: row.get(0)?,
                    vault_id: row.get(1)?,
                    nonce: row.get(2)?,
                    ciphertext: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            })
            .map_err(storage_err)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(storage_err)?);
        }
        Ok(out)
    }

    pub fn upsert_item(&self, item: &StoredItem) -> Result<()> {
        if item.nonce.len() != NONCE_LEN || item.ciphertext.is_empty() {
            return Err(AcuyeError::Validation("invalid encrypted item".into()));
        }
        self.conn
            .execute(
                "INSERT INTO items (id, vault_id, nonce, ciphertext, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(id) DO UPDATE SET
                    vault_id = excluded.vault_id,
                    nonce = excluded.nonce,
                    ciphertext = excluded.ciphertext,
                    updated_at = excluded.updated_at",
                params![
                    item.id,
                    item.vault_id,
                    item.nonce,
                    item.ciphertext,
                    item.updated_at
                ],
            )
            .map_err(storage_err)?;
        Ok(())
    }

    /// Persist a batch of items in one transaction. Used by bulk import so a
    /// failure cannot leave half the batch on disk.
    pub fn upsert_items(&mut self, items: &[StoredItem]) -> Result<()> {
        let tx = self.conn.transaction().map_err(storage_err)?;
        {
            let mut stmt = tx
                .prepare(
                    "INSERT INTO items (id, vault_id, nonce, ciphertext, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)
                     ON CONFLICT(id) DO UPDATE SET
                        vault_id = excluded.vault_id,
                        nonce = excluded.nonce,
                        ciphertext = excluded.ciphertext,
                        updated_at = excluded.updated_at",
                )
                .map_err(storage_err)?;
            for item in items {
                if item.nonce.len() != NONCE_LEN || item.ciphertext.is_empty() {
                    return Err(AcuyeError::Validation("invalid encrypted item".into()));
                }
                stmt.execute(params![
                    item.id,
                    item.vault_id,
                    item.nonce,
                    item.ciphertext,
                    item.updated_at
                ])
                .map_err(storage_err)?;
            }
        }
        tx.commit().map_err(storage_err)?;
        Ok(())
    }

    /// Atomically replace the whole encrypted item set together with the
    /// account key material. Used for master-password/key rotation so a crash
    /// can never leave half the vault under the old key.
    pub fn replace_vault_items(
        &mut self,
        account: &AccountRecord,
        items: &[StoredItem],
    ) -> Result<()> {
        let tx = self.conn.transaction().map_err(storage_err)?;
        // Only this vault's items are rewritten: other accounts share the table.
        tx.execute(
            "DELETE FROM items WHERE vault_id = ?1",
            params![account.vault_id],
        )
        .map_err(storage_err)?;
        {
            let mut stmt = tx
                .prepare(
                    "INSERT INTO items (id, vault_id, nonce, ciphertext, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                )
                .map_err(storage_err)?;
            for item in items {
                stmt.execute(params![
                    item.id,
                    item.vault_id,
                    item.nonce,
                    item.ciphertext,
                    item.updated_at
                ])
                .map_err(storage_err)?;
            }
        }
        tx.execute(
            "UPDATE accounts SET kdf_algorithm = ?1, kdf_memory_kib = ?2,
                kdf_iterations = ?3, kdf_parallelism = ?4, salt = ?5,
                verifier = ?6, wrapped_vault_key = ?7, vault_key_nonce = ?8,
                updated_at = ?9 WHERE vault_id = ?10",
            params![
                account.kdf_algorithm,
                account.kdf_memory_kib,
                account.kdf_iterations,
                account.kdf_parallelism,
                account.salt,
                account.verifier,
                account.wrapped_vault_key,
                account.vault_key_nonce,
                account.updated_at,
                account.vault_id,
            ],
        )
        .map_err(storage_err)?;
        tx.commit().map_err(storage_err)?;
        Ok(())
    }

    pub fn delete_item(&self, id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM items WHERE id = ?1", params![id])
            .map_err(storage_err)?;
        Ok(())
    }

    pub fn item_count(&self) -> Result<usize> {
        let count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM items", [], |row| row.get(0))
            .map_err(storage_err)?;
        Ok(count as usize)
    }

    // ----- settings --------------------------------------------------------

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        self.conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![key],
                |row| row.get(0),
            )
            .optional()
            .map_err(storage_err)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        self.conn
            .execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, value],
            )
            .map_err(storage_err)?;
        Ok(())
    }

    pub fn settings_map(&self) -> Result<Vec<(String, String)>> {
        let mut stmt = self
            .conn
            .prepare("SELECT key, value FROM settings ORDER BY key")
            .map_err(storage_err)?;
        let rows = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(storage_err)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(storage_err)?);
        }
        Ok(out)
    }

    // ----- devices ---------------------------------------------------------

    pub fn upsert_device(&self, device: &DeviceRecord) -> Result<()> {
        self.conn
            .execute(
                "INSERT INTO devices (id, name, platform, created_at, last_seen_at, revoked, sync_registered)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    platform = excluded.platform,
                    last_seen_at = excluded.last_seen_at,
                    revoked = excluded.revoked,
                    sync_registered = excluded.sync_registered",
                params![
                    device.id,
                    device.name,
                    device.platform,
                    device.created_at,
                    device.last_seen_at,
                    device.revoked as i32,
                    device.sync_registered as i32,
                ],
            )
            .map_err(storage_err)?;
        Ok(())
    }

    pub fn list_devices(&self) -> Result<Vec<DeviceRecord>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, name, platform, created_at, last_seen_at, revoked, sync_registered
                 FROM devices ORDER BY created_at ASC",
            )
            .map_err(storage_err)?;
        let rows = stmt
            .query_map([], |row| {
                Ok(DeviceRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    platform: row.get(2)?,
                    created_at: row.get(3)?,
                    last_seen_at: row.get(4)?,
                    revoked: row.get::<_, i32>(5)? != 0,
                    sync_registered: row.get::<_, i32>(6)? != 0,
                })
            })
            .map_err(storage_err)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(storage_err)?);
        }
        Ok(out)
    }

    // ----- sync bookkeeping ------------------------------------------------

    /// Raw `sync_state` rows, used when restoring a backup.
    pub fn sync_state_rows(&self) -> Result<Vec<SyncStateRow>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT vault_id, local_revision, remote_revision, last_synced_at,
                        provider_endpoint
                 FROM sync_state ORDER BY vault_id",
            )
            .map_err(storage_err)?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            })
            .map_err(storage_err)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(storage_err)?);
        }
        Ok(out)
    }

    /// Raw `sync_outbox` rows, used when restoring a backup.
    pub fn sync_outbox_rows(&self) -> Result<Vec<SyncOutboxRow>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT revision, item_id, operation, queued_at
                 FROM sync_outbox ORDER BY revision",
            )
            .map_err(storage_err)?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .map_err(storage_err)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(storage_err)?);
        }
        Ok(out)
    }

    // ----- LAN peers -------------------------------------------------------

    /// Approved LAN peers, ordered by name.
    pub fn lan_peers(&self) -> Result<Vec<LanPeerRow>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, name, platform, signing_key, exchange_key, address,
                        paired_at, last_seen_at, revoked
                 FROM lan_peers ORDER BY name",
            )
            .map_err(storage_err)?;
        let rows = stmt
            .query_map([], |row| {
                Ok(LanPeerRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    platform: row.get(2)?,
                    signing_key: row.get(3)?,
                    exchange_key: row.get(4)?,
                    address: row.get(5)?,
                    paired_at: row.get(6)?,
                    last_seen_at: row.get(7)?,
                    revoked: row.get::<_, i64>(8)? != 0,
                })
            })
            .map_err(storage_err)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(storage_err)?);
        }
        Ok(out)
    }

    /// Insert or refresh a peer (re-pairing clears a previous revocation).
    pub fn upsert_lan_peer(&mut self, peer: &LanPeerRow) -> Result<()> {
        if peer.id.is_empty() || peer.name.is_empty() || peer.exchange_key.is_empty() {
            return Err(AcuyeError::Validation("invalid device record".into()));
        }
        self.conn
            .execute(
                "INSERT INTO lan_peers (id, name, platform, signing_key, exchange_key,
                    address, paired_at, last_seen_at, revoked)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    platform = excluded.platform,
                    signing_key = excluded.signing_key,
                    exchange_key = excluded.exchange_key,
                    address = excluded.address,
                    paired_at = excluded.paired_at,
                    last_seen_at = excluded.last_seen_at,
                    revoked = excluded.revoked",
                params![
                    peer.id,
                    peer.name,
                    peer.platform,
                    peer.signing_key,
                    peer.exchange_key,
                    peer.address,
                    peer.paired_at,
                    peer.last_seen_at,
                    peer.revoked as i32,
                ],
            )
            .map_err(storage_err)?;
        Ok(())
    }

    /// Mark a peer as revoked (or restore it) and remember when.
    pub fn set_lan_peer_revoked(&mut self, id: &str, revoked: bool, at: i64) -> Result<()> {
        let changed = self
            .conn
            .execute(
                "UPDATE lan_peers SET revoked = ?2, last_seen_at = MAX(last_seen_at, ?3)
                 WHERE id = ?1",
                params![id, revoked as i32, at],
            )
            .map_err(storage_err)?;
        if changed == 0 {
            return Err(AcuyeError::NotFound("device".into()));
        }
        Ok(())
    }

    /// Record that a peer was seen.
    pub fn touch_lan_peer(&mut self, id: &str, at: i64) -> Result<()> {
        self.conn
            .execute(
                "UPDATE lan_peers SET last_seen_at = ?2 WHERE id = ?1",
                params![id, at],
            )
            .map_err(storage_err)?;
        Ok(())
    }

    /// Forget a peer entirely.
    pub fn delete_lan_peer(&mut self, id: &str) -> Result<()> {
        let changed = self
            .conn
            .execute("DELETE FROM lan_peers WHERE id = ?1", params![id])
            .map_err(storage_err)?;
        if changed == 0 {
            return Err(AcuyeError::NotFound("device".into()));
        }
        Ok(())
    }

    // ----- secret access history ------------------------------------------

    /// Record an access to a secret item. Only the action name is stored — never
    /// a field label, value, or anything derived from the value.
    pub fn record_secret_access(&mut self, item_id: &str, action: &str, at: i64) -> Result<()> {
        let action = action.trim();
        if action.is_empty() || action.len() > 32 {
            return Err(AcuyeError::Validation("invalid access action".into()));
        }
        self.conn
            .execute(
                "INSERT INTO secret_access (item_id, action, at) VALUES (?1, ?2, ?3)",
                params![item_id, action, at],
            )
            .map_err(storage_err)?;
        // Keep the history bounded per item so it cannot grow without limit.
        self.conn
            .execute(
                "DELETE FROM secret_access
                 WHERE item_id = ?1 AND id NOT IN (
                    SELECT id FROM secret_access WHERE item_id = ?1
                    ORDER BY at DESC, id DESC LIMIT ?2
                 )",
                params![item_id, MAX_SECRET_ACCESS_ROWS],
            )
            .map_err(storage_err)?;
        Ok(())
    }

    /// Access history for one item, newest first.
    pub fn secret_access(&self, item_id: &str) -> Result<Vec<SecretAccessRow>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT item_id, action, at FROM secret_access
                 WHERE item_id = ?1 ORDER BY at DESC, id DESC LIMIT 50",
            )
            .map_err(storage_err)?;
        let rows = stmt
            .query_map(params![item_id], |row| {
                Ok(SecretAccessRow {
                    item_id: row.get(0)?,
                    action: row.get(1)?,
                    at: row.get(2)?,
                })
            })
            .map_err(storage_err)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(storage_err)?);
        }
        Ok(out)
    }

    /// Whole access history, used when restoring a backup.
    pub fn secret_access_all(&self) -> Result<Vec<SecretAccessRow>> {
        let mut stmt = self
            .conn
            .prepare("SELECT item_id, action, at FROM secret_access ORDER BY at")
            .map_err(storage_err)?;
        let rows = stmt
            .query_map([], |row| {
                Ok(SecretAccessRow {
                    item_id: row.get(0)?,
                    action: row.get(1)?,
                    at: row.get(2)?,
                })
            })
            .map_err(storage_err)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(storage_err)?);
        }
        Ok(out)
    }

    /// Delete the history of one item.
    pub fn clear_secret_access(&mut self, item_id: &str) -> Result<()> {
        self.conn
            .execute(
                "DELETE FROM secret_access WHERE item_id = ?1",
                params![item_id],
            )
            .map_err(storage_err)?;
        Ok(())
    }

    pub fn revoke_device(&self, id: &str) -> Result<()> {
        let changed = self
            .conn
            .execute("UPDATE devices SET revoked = 1 WHERE id = ?1", params![id])
            .map_err(storage_err)?;
        if changed == 0 {
            return Err(AcuyeError::NotFound("device".into()));
        }
        Ok(())
    }

    /// Replace the current contents with a pre-verified encrypted backup.
    ///
    /// The backup is opened read-only and validated before a single transaction
    /// swaps account, item and settings rows. Vault contents remain ciphertext
    /// throughout, so this never needs the master password.
    pub fn replace_with_backup(&mut self, backup: &Path) -> Result<()> {
        if !backup.exists() {
            return Err(AcuyeError::NotFound("backup".into()));
        }
        let source =
            Connection::open_with_flags(backup, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(storage_err)?;
        let version: i32 = source
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(storage_err)?;
        if version == 0 || version > SCHEMA_VERSION {
            return Err(AcuyeError::Unsupported(
                "that backup was created by an unsupported version".into(),
            ));
        }
        let check: String = source
            .query_row("PRAGMA quick_check", [], |row| row.get(0))
            .map_err(storage_err)?;
        if check != "ok" {
            return Err(AcuyeError::Storage("backup verification failed".into()));
        }

        let source_db = Database {
            conn: source,
            path: None,
        };
        let accounts = source_db.load_accounts()?;
        if accounts.is_empty() {
            return Err(AcuyeError::Storage("backup has no account".into()));
        }
        let mut items = Vec::new();
        for account in &accounts {
            items.extend(source_db.load_items(&account.vault_id)?);
        }
        let settings = source_db.settings_map()?;
        // The device list and sync bookkeeping describe this vault too, so the
        // restore would otherwise mix a stale device registry (including
        // revoked entries) with the restored account.
        let devices = source_db.list_devices()?;
        let sync_state = source_db.sync_state_rows()?;
        let sync_outbox = source_db.sync_outbox_rows()?;
        let lan_peers = source_db.lan_peers()?;
        let secret_access = source_db.secret_access_all()?;

        let tx = self.conn.transaction().map_err(storage_err)?;
        tx.execute("DELETE FROM items", []).map_err(storage_err)?;
        tx.execute("DELETE FROM accounts", [])
            .map_err(storage_err)?;
        tx.execute("DELETE FROM settings", [])
            .map_err(storage_err)?;
        tx.execute("DELETE FROM devices", []).map_err(storage_err)?;
        tx.execute("DELETE FROM sync_state", [])
            .map_err(storage_err)?;
        tx.execute("DELETE FROM sync_outbox", [])
            .map_err(storage_err)?;
        tx.execute("DELETE FROM lan_peers", [])
            .map_err(storage_err)?;
        tx.execute("DELETE FROM secret_access", [])
            .map_err(storage_err)?;
        {
            let mut stmt = tx
                .prepare(
                    "INSERT INTO accounts (id, username, kdf_algorithm, kdf_memory_kib,
                        kdf_iterations, kdf_parallelism, salt, verifier,
                        wrapped_vault_key, vault_key_nonce, vault_id, vault_name,
                        created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                )
                .map_err(storage_err)?;
            for account in &accounts {
                stmt.execute(params![
                    account.vault_id,
                    account.username,
                    account.kdf_algorithm,
                    account.kdf_memory_kib,
                    account.kdf_iterations,
                    account.kdf_parallelism,
                    account.salt,
                    account.verifier,
                    account.wrapped_vault_key,
                    account.vault_key_nonce,
                    account.vault_id,
                    account.vault_name,
                    account.created_at,
                    account.updated_at,
                ])
                .map_err(storage_err)?;
            }
        }
        {
            let mut stmt = tx
                .prepare(
                    "INSERT INTO items (id, vault_id, nonce, ciphertext, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                )
                .map_err(storage_err)?;
            for item in &items {
                stmt.execute(params![
                    item.id,
                    item.vault_id,
                    item.nonce,
                    item.ciphertext,
                    item.updated_at
                ])
                .map_err(storage_err)?;
            }
        }
        {
            let mut stmt = tx
                .prepare("INSERT INTO settings (key, value) VALUES (?1, ?2)")
                .map_err(storage_err)?;
            for (key, value) in &settings {
                stmt.execute(params![key, value]).map_err(storage_err)?;
            }
        }
        {
            let mut stmt = tx
                .prepare(
                    "INSERT INTO devices (id, name, platform, created_at, last_seen_at,
                        revoked, sync_registered)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                )
                .map_err(storage_err)?;
            for device in &devices {
                stmt.execute(params![
                    device.id,
                    device.name,
                    device.platform,
                    device.created_at,
                    device.last_seen_at,
                    device.revoked as i32,
                    device.sync_registered as i32,
                ])
                .map_err(storage_err)?;
            }
        }
        {
            let mut stmt = tx
                .prepare(
                    "INSERT INTO sync_state (vault_id, local_revision, remote_revision,
                        last_synced_at, provider_endpoint)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                )
                .map_err(storage_err)?;
            for (vault_id, local, remote, last, endpoint) in &sync_state {
                stmt.execute(params![vault_id, local, remote, last, endpoint])
                    .map_err(storage_err)?;
            }
        }
        {
            let mut stmt = tx
                .prepare(
                    "INSERT INTO sync_outbox (revision, item_id, operation, queued_at)
                     VALUES (?1, ?2, ?3, ?4)",
                )
                .map_err(storage_err)?;
            for (revision, item_id, operation, queued_at) in &sync_outbox {
                stmt.execute(params![revision, item_id, operation, queued_at])
                    .map_err(storage_err)?;
            }
        }
        {
            let mut stmt = tx
                .prepare(
                    "INSERT INTO lan_peers (id, name, platform, signing_key, exchange_key,
                        address, paired_at, last_seen_at, revoked)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                )
                .map_err(storage_err)?;
            for peer in &lan_peers {
                stmt.execute(params![
                    peer.id,
                    peer.name,
                    peer.platform,
                    peer.signing_key,
                    peer.exchange_key,
                    peer.address,
                    peer.paired_at,
                    peer.last_seen_at,
                    peer.revoked as i32,
                ])
                .map_err(storage_err)?;
            }
        }
        {
            let mut stmt = tx
                .prepare("INSERT INTO secret_access (item_id, action, at) VALUES (?1, ?2, ?3)")
                .map_err(storage_err)?;
            for row in &secret_access {
                stmt.execute(params![row.item_id, row.action, row.at])
                    .map_err(storage_err)?;
            }
        }
        tx.commit().map_err(storage_err)?;
        Ok(())
    }

    // ----- diagnostics & backups -------------------------------------------

    pub fn integrity_ok(&self) -> bool {
        self.conn
            .query_row("PRAGMA quick_check", [], |row| row.get::<_, String>(0))
            .map(|s| s == "ok")
            .unwrap_or(false)
    }

    pub fn db_size_bytes(&self) -> u64 {
        self.path
            .as_ref()
            .and_then(|p| fs::metadata(p).ok())
            .map(|m| m.len())
            .unwrap_or(0)
    }

    /// Create a consistent copy of the encrypted database (SQLite `VACUUM
    /// INTO`), then verify the copy before reporting success.
    pub fn backup_to(&self, destination: &Path) -> Result<()> {
        if destination.exists() {
            return Err(AcuyeError::Conflict("backup file already exists".into()));
        }
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)?;
        }
        // Fold the WAL into the main database first so the copy is complete.
        self.conn
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .map_err(storage_err)?;
        let path_str = destination
            .to_str()
            .ok_or_else(|| AcuyeError::Validation("invalid backup path".into()))?;
        if self
            .conn
            .execute("VACUUM INTO ?1", params![path_str])
            .is_err()
        {
            let _ = fs::remove_file(destination);
            return Err(AcuyeError::Storage(
                "the backup could not be written".into(),
            ));
        }

        // A copy that fails verification must not stay on disk: its name would
        // collide with the next attempt and "already exists" would hide the
        // real problem forever.
        let verified = (|| -> Result<()> {
            let check = Connection::open(destination).map_err(storage_err)?;
            let ok: String = check
                .query_row("PRAGMA quick_check", [], |row| row.get(0))
                .map_err(storage_err)?;
            if ok != "ok" {
                return Err(AcuyeError::Storage("backup verification failed".into()));
            }
            Ok(())
        })();
        if verified.is_err() {
            let _ = fs::remove_file(destination);
        }
        verified
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use acuye_core::time::now;
    use std::sync::atomic::{AtomicU64, Ordering};

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_dir() -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "acuye-storage-test-{}-{}-{}",
            std::process::id(),
            now(),
            n
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn account() -> AccountRecord {
        AccountRecord {
            username: "ada".into(),
            kdf_algorithm: "argon2id".into(),
            kdf_memory_kib: 65_536,
            kdf_iterations: 3,
            kdf_parallelism: 1,
            salt: vec![1u8; 16],
            verifier: vec![2u8; 32],
            wrapped_vault_key: vec![3u8; 40],
            vault_key_nonce: vec![4u8; 24],
            vault_id: "vault-1".into(),
            vault_name: "Personal".into(),
            created_at: 100,
            updated_at: 100,
        }
    }

    fn stored(id: &str) -> StoredItem {
        StoredItem {
            id: id.into(),
            vault_id: "vault-1".into(),
            nonce: vec![9u8; 24],
            ciphertext: vec![7u8; 48],
            updated_at: 500,
        }
    }

    #[test]
    fn migrations_create_schema_and_report_version() {
        let db = Database::open_in_memory().unwrap();
        assert_eq!(db.schema_version().unwrap(), SCHEMA_VERSION);
        assert!(db.load_account().unwrap().is_none());
        assert!(db.integrity_ok());
        assert_eq!(db.item_count().unwrap(), 0);
    }

    #[test]
    fn migration_is_idempotent_when_reopening() {
        let dir = temp_dir();
        let path = dir.join("acuye.db");
        {
            let db = Database::open(&path).unwrap();
            db.insert_account(&account()).unwrap();
        }
        let db = Database::open(&path).unwrap();
        assert_eq!(db.schema_version().unwrap(), SCHEMA_VERSION);
        assert_eq!(db.load_account().unwrap().unwrap().username, "ada");
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn account_cannot_be_silently_overwritten() {
        let db = Database::open_in_memory().unwrap();
        db.insert_account(&account()).unwrap();
        assert!(matches!(
            db.insert_account(&account()),
            Err(AcuyeError::Conflict(_))
        ));
        let mut updated = account();
        updated.updated_at = 200;
        db.update_account(&updated).unwrap();
        assert_eq!(db.load_account().unwrap().unwrap().updated_at, 200);
    }

    #[test]
    fn several_accounts_share_the_table_by_vault_id() {
        let mut db = Database::open_in_memory().unwrap();
        db.insert_account(&account()).unwrap();
        let mut other = account();
        other.username = "grace".into();
        other.vault_id = "vault-2".into();
        db.insert_account(&other).unwrap();

        let accounts = db.load_accounts().unwrap();
        assert_eq!(accounts.len(), 2);
        assert_eq!(accounts[1].vault_id, "vault-2");
        assert_eq!(
            db.load_account_by_vault("vault-2")
                .unwrap()
                .unwrap()
                .username,
            "grace"
        );

        // Rotation touches only the vault it belongs to.
        let mut rotated = other.clone();
        rotated.updated_at = 200;
        db.replace_vault_items(&rotated, &[]).unwrap();
        assert_eq!(
            db.load_account_by_vault("vault-1")
                .unwrap()
                .unwrap()
                .updated_at,
            100
        );
        assert_eq!(
            db.load_account_by_vault("vault-2")
                .unwrap()
                .unwrap()
                .updated_at,
            200
        );
    }

    #[test]
    fn v3_single_account_migrates_to_a_vault_keyed_row() {
        let dir = temp_dir();
        let path = dir.join("acuye.db");
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE accounts (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    username TEXT NOT NULL UNIQUE,
                    kdf_algorithm TEXT NOT NULL,
                    kdf_memory_kib INTEGER NOT NULL,
                    kdf_iterations INTEGER NOT NULL,
                    kdf_parallelism INTEGER NOT NULL,
                    salt BLOB NOT NULL,
                    verifier BLOB NOT NULL,
                    wrapped_vault_key BLOB NOT NULL,
                    vault_key_nonce BLOB NOT NULL,
                    vault_id TEXT NOT NULL,
                    vault_name TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                INSERT INTO accounts VALUES (1, 'ada', 'argon2id', 65536, 3, 1,
                    x'01', x'02', x'03', x'04', 'vault-1', 'Personal', 100, 100);
                PRAGMA user_version = 3;",
            )
            .unwrap();
        }
        let db = Database::open(&path).unwrap();
        assert_eq!(db.schema_version().unwrap(), SCHEMA_VERSION);
        let migrated = db.load_account().unwrap().unwrap();
        assert_eq!(migrated.username, "ada");
        assert_eq!(migrated.vault_id, "vault-1");
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn items_persist_encrypted_blobs_and_delete() {
        let dir = temp_dir();
        let path = dir.join("acuye.db");
        {
            let db = Database::open(&path).unwrap();
            db.upsert_item(&stored("a")).unwrap();
            db.upsert_item(&stored("b")).unwrap();
            assert_eq!(db.item_count().unwrap(), 2);
            db.delete_item("a").unwrap();
        }
        let db = Database::open(&path).unwrap();
        let items = db.load_items("vault-1").unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "b");
        assert!(db.load_items("other-vault").unwrap().is_empty());
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn invalid_ciphertext_rows_are_rejected() {
        let db = Database::open_in_memory().unwrap();
        let mut bad = stored("a");
        bad.nonce = vec![0u8; 4];
        assert!(db.upsert_item(&bad).is_err());
        let mut bad = stored("b");
        bad.ciphertext.clear();
        assert!(db.upsert_item(&bad).is_err());
    }

    #[test]
    fn settings_roundtrip_and_upsert() {
        let db = Database::open_in_memory().unwrap();
        assert!(db.get_setting("theme").unwrap().is_none());
        db.set_setting("theme", "blue").unwrap();
        db.set_setting("theme", "red").unwrap();
        assert_eq!(db.get_setting("theme").unwrap().unwrap(), "red");
        assert_eq!(db.settings_map().unwrap().len(), 1);
    }

    #[test]
    fn devices_can_be_revoked() {
        let db = Database::open_in_memory().unwrap();
        db.upsert_device(&DeviceRecord {
            id: "dev-1".into(),
            name: "Laptop".into(),
            platform: "windows".into(),
            created_at: 1,
            last_seen_at: 2,
            revoked: false,
            sync_registered: false,
        })
        .unwrap();
        assert_eq!(db.list_devices().unwrap().len(), 1);
        db.revoke_device("dev-1").unwrap();
        assert!(db.list_devices().unwrap()[0].revoked);
        assert!(db.revoke_device("missing").is_err());
    }

    #[test]
    fn backup_creates_verified_copy() {
        let dir = temp_dir();
        let db = Database::open(dir.join("acuye.db")).unwrap();
        db.insert_account(&account()).unwrap();
        db.upsert_item(&stored("a")).unwrap();
        let backup = dir.join("backups").join("vault-backup.db");
        db.backup_to(&backup).unwrap();
        assert!(backup.exists());
        let restored = Database::open(&backup).unwrap();
        assert_eq!(restored.load_account().unwrap().unwrap().username, "ada");
        assert_eq!(restored.item_count().unwrap(), 1);
        assert!(db.backup_to(&backup).is_err());
        fs::remove_dir_all(dir).ok();
    }
}
