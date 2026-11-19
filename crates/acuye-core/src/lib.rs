//! Shared domain models for Acuye Pass.
//!
//! This crate intentionally contains no cryptography and no persistence. It
//! defines the vocabulary (`Item`, `Session`, `AppSettings`, errors) that every
//! other crate speaks. Keeping it dependency-light lets the future mobile
//! bindings reuse it unchanged. Vault operations live in `acuye-vault`.

pub mod account;
pub mod error;
pub mod item;
pub mod session;
pub mod settings;
pub mod time;

pub use account::{AccountRecord, AccountSummary};
pub use error::{AcuyeError, Result};
pub use item::{CustomField, Item, ItemFields, ItemSummary, ItemType};
pub use session::Session;
pub use settings::{AppSettings, AppearanceMode, SyncProviderConfig, ThemeColor};
pub use time::Timestamp;
