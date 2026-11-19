use acuye_core::AcuyeError;
use serde::Serialize;

/// Serializable error surfaced to the frontend.
///
/// Messages are deliberately generic and never contain key material, passwords
/// or decrypted vault contents.
#[derive(Debug, Clone, Serialize)]
pub struct ApiError {
    pub code: String,
    pub message: String,
}

impl ApiError {
    pub fn internal() -> Self {
        Self {
            code: "internal".into(),
            message: "Something went wrong".into(),
        }
    }

    pub fn validation(message: impl Into<String>) -> Self {
        Self {
            code: "validation".into(),
            message: message.into(),
        }
    }
}

impl From<AcuyeError> for ApiError {
    fn from(error: AcuyeError) -> Self {
        Self {
            code: error.code().into(),
            message: error.to_string(),
        }
    }
}

impl From<std::io::Error> for ApiError {
    fn from(_: std::io::Error) -> Self {
        Self {
            code: "io".into(),
            message: "The operation could not be completed".into(),
        }
    }
}

pub type ApiResult<T> = std::result::Result<T, ApiError>;
