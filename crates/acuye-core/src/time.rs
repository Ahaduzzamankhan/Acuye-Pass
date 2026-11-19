/// Unix timestamp in seconds.
pub type Timestamp = i64;

/// Current unix timestamp in seconds.
pub fn now() -> Timestamp {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    #[test]
    fn now_is_reasonable() {
        assert!(super::now() > 1_700_000_000);
    }
}
