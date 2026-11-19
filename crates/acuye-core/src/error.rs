use thiserror::Error;

/// Application error type.
///
/// Variants are deliberately coarse: error strings are surfaced in the UI and
/// may end up in support reports, so they must never contain secrets,
/// plaintext vault contents or key material.
#[derive(Debug, Error)]
pub enum AcuyeError {
    #[error("invalid input: {0}")]
    Validation(String),
    #[error("authentication failed")]
    AuthenticationFailed,
    #[error("the vault is locked")]
    Locked,
    #[error("not found: {0}")]
    NotFound(String),
    #[error("conflict: {0}")]
    Conflict(String),
    #[error("the encrypted data could not be verified")]
    Crypto,
    #[error("storage error: {0}")]
    Storage(String),
    #[error("network error: {0}")]
    Network(String),
    #[error("update rejected: {0}")]
    Update(String),
    #[error("unsupported: {0}")]
    Unsupported(String),
    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid data format")]
    Format,
    #[error("internal error")]
    Internal,
}

impl AcuyeError {
    /// Stable machine readable code for the frontend.
    pub fn code(&self) -> &'static str {
        match self {
            Self::Validation(_) => "validation",
            Self::AuthenticationFailed => "authentication_failed",
            Self::Locked => "locked",
            Self::NotFound(_) => "not_found",
            Self::Conflict(_) => "conflict",
            Self::Crypto => "crypto",
            Self::Storage(_) => "storage",
            Self::Network(_) => "network",
            Self::Update(_) => "update",
            Self::Unsupported(_) => "unsupported",
            Self::Io(_) => "io",
            Self::Format => "format",
            Self::Internal => "internal",
        }
    }
}

impl From<serde_json::Error> for AcuyeError {
    fn from(_: serde_json::Error) -> Self {
        // Never forward serde messages: they can contain a fragment of the
        // value being parsed.
        Self::Format
    }
}

pub type Result<T> = std::result::Result<T, AcuyeError>;
