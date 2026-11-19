//! Password and passphrase generation.
//!
//! All randomness comes from the operating system CSPRNG through
//! `acuye_crypto::random_below`; no `rand::thread_rng`/`Math.random` style
//! generators are used for secrets.

use std::sync::LazyLock;

use acuye_core::{AcuyeError, Result};
use acuye_crypto::random_below;
use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

pub mod strength;

const UPPERCASE: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWERCASE: &str = "abcdefghijklmnopqrstuvwxyz";
const NUMBERS: &str = "0123456789";
const SYMBOLS: &str = "!@#$%^&*()-_=+[]{};:,.?/";

pub const MIN_LENGTH: usize = 8;
pub const MAX_LENGTH: usize = 128;

/// EFF short wordlist (1296 words), CC BY 3.0 US, https://www.eff.org/dice
/// Bundled verbatim so passphrase generation needs no network access.
const WORDLIST_RAW: &str = include_str!("../data/eff_short_wordlist_1.txt");

static WORDS: LazyLock<Vec<&'static str>> = LazyLock::new(|| {
    let mut words: Vec<&'static str> = WORDLIST_RAW
        .lines()
        .filter_map(|line| line.split_once('\t').map(|(_, w)| w.trim()))
        .filter(|w| !w.is_empty())
        .collect();
    words.sort_unstable();
    words.dedup();
    words
});

/// Number of words in the bundled list. Used by the UI to show entropy.
pub fn wordlist_len() -> usize {
    WORDS.len()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct PasswordOptions {
    pub length: usize,
    pub uppercase: bool,
    pub lowercase: bool,
    pub numbers: bool,
    pub symbols: bool,
    pub exclude_chars: String,
}

impl Default for PasswordOptions {
    fn default() -> Self {
        Self {
            length: 20,
            uppercase: true,
            lowercase: true,
            numbers: true,
            symbols: true,
            exclude_chars: String::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct PassphraseOptions {
    pub words: usize,
    pub separator: String,
    pub capitalize: bool,
    pub include_number: bool,
}

impl Default for PassphraseOptions {
    fn default() -> Self {
        Self {
            words: 6,
            separator: "-".into(),
            capitalize: true,
            include_number: true,
        }
    }
}

fn filtered_class(class: &str, exclude: &[char]) -> Vec<char> {
    class.chars().filter(|c| !exclude.contains(c)).collect()
}

/// Generate a random password satisfying the requested options.
pub fn generate_password(options: &PasswordOptions) -> Result<String> {
    if !(MIN_LENGTH..=MAX_LENGTH).contains(&options.length) {
        return Err(AcuyeError::Validation(format!(
            "Password length must be between {MIN_LENGTH} and {MAX_LENGTH}"
        )));
    }
    if !(options.uppercase || options.lowercase || options.numbers || options.symbols) {
        return Err(AcuyeError::Validation(
            "Select at least one character set".into(),
        ));
    }
    let exclude: Vec<char> = options.exclude_chars.chars().collect();
    let mut classes: Vec<Vec<char>> = Vec::new();
    if options.uppercase {
        classes.push(filtered_class(UPPERCASE, &exclude));
    }
    if options.lowercase {
        classes.push(filtered_class(LOWERCASE, &exclude));
    }
    if options.numbers {
        classes.push(filtered_class(NUMBERS, &exclude));
    }
    if options.symbols {
        classes.push(filtered_class(SYMBOLS, &exclude));
    }
    if classes.iter().any(|c| c.is_empty()) {
        return Err(AcuyeError::Validation(
            "Excluded characters removed an entire character set".into(),
        ));
    }
    if options.length < classes.len() {
        return Err(AcuyeError::Validation(
            "Password is too short for the selected character sets".into(),
        ));
    }

    let pool: Vec<char> = classes.iter().flatten().copied().collect();
    let mut chars: Vec<char> = Vec::with_capacity(options.length);
    // Guarantee one character from every enabled class.
    for class in &classes {
        chars.push(class[random_below(class.len() as u32) as usize]);
    }
    while chars.len() < options.length {
        chars.push(pool[random_below(pool.len() as u32) as usize]);
    }
    // Fisher-Yates with CSPRNG indices so the guaranteed characters are not
    // always at the start.
    for i in (1..chars.len()).rev() {
        let j = random_below((i + 1) as u32) as usize;
        chars.swap(i, j);
    }
    let mut password: String = chars.into_iter().collect();
    // Defensive: ensure every class still present after shuffle (it is).
    if !password.chars().all(|c| pool.contains(&c)) {
        password.zeroize();
        return Err(AcuyeError::Internal);
    }
    Ok(password)
}

/// Generate a diceware-style passphrase from the bundled EFF short wordlist.
pub fn generate_passphrase(options: &PassphraseOptions) -> Result<String> {
    if !(3..=12).contains(&options.words) {
        return Err(AcuyeError::Validation(
            "Passphrase must contain between 3 and 12 words".into(),
        ));
    }
    if options.separator.chars().count() > 3 {
        return Err(AcuyeError::Validation(
            "Passphrase separator is too long".into(),
        ));
    }
    if WORDS.is_empty() {
        return Err(AcuyeError::Internal);
    }
    let mut parts: Vec<String> = Vec::with_capacity(options.words);
    for _ in 0..options.words {
        let word = WORDS[random_below(WORDS.len() as u32) as usize];
        if options.capitalize {
            let mut chars = word.chars();
            let mut out = String::new();
            if let Some(first) = chars.next() {
                out.push(first.to_ascii_uppercase());
                out.extend(chars);
            }
            parts.push(out);
        } else {
            parts.push(word.to_string());
        }
    }
    let mut phrase = parts.join(&options.separator);
    if options.include_number {
        phrase.push_str(&format!("{}", random_below(100)));
    }
    Ok(phrase)
}

/// Entropy estimate for a generated passphrase, for display only.
pub fn passphrase_bits(words: usize) -> f64 {
    if WORDS.is_empty() {
        0.0
    } else {
        words as f64 * (WORDS.len() as f64).log2()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wordlist_is_bundled_and_large() {
        assert_eq!(wordlist_len(), 1296);
    }

    #[test]
    fn password_has_requested_length_and_classes() {
        for _ in 0..50 {
            let pw = generate_password(&PasswordOptions::default()).unwrap();
            assert_eq!(pw.chars().count(), 20);
            assert!(pw.chars().any(|c| c.is_ascii_uppercase()));
            assert!(pw.chars().any(|c| c.is_ascii_lowercase()));
            assert!(pw.chars().any(|c| c.is_ascii_digit()));
            assert!(pw.chars().any(|c| SYMBOLS.contains(c)));
        }
    }

    #[test]
    fn passwords_are_not_repeated() {
        let a = generate_password(&PasswordOptions::default()).unwrap();
        let b = generate_password(&PasswordOptions::default()).unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn excluded_characters_never_appear() {
        let opts = PasswordOptions {
            length: 32,
            exclude_chars: "O0lI1|".into(),
            ..Default::default()
        };
        for _ in 0..30 {
            let pw = generate_password(&opts).unwrap();
            for c in "O0lI1|".chars() {
                assert!(!pw.contains(c), "excluded {c} present in {pw}");
            }
        }
    }

    #[test]
    fn only_selected_classes_are_used() {
        let opts = PasswordOptions {
            length: 24,
            uppercase: false,
            numbers: false,
            symbols: false,
            ..Default::default()
        };
        let pw = generate_password(&opts).unwrap();
        assert!(pw.chars().all(|c| c.is_ascii_lowercase()));
    }

    #[test]
    fn invalid_options_are_rejected() {
        assert!(generate_password(&PasswordOptions {
            length: 4,
            ..Default::default()
        })
        .is_err());
        assert!(generate_password(&PasswordOptions {
            length: 200,
            ..Default::default()
        })
        .is_err());
        assert!(generate_password(&PasswordOptions {
            uppercase: false,
            lowercase: false,
            numbers: false,
            symbols: false,
            ..Default::default()
        })
        .is_err());
        assert!(generate_password(&PasswordOptions {
            length: 8,
            symbols: false,
            exclude_chars: "abcdefghijklmnopqrstuvwxyz".into(),
            ..Default::default()
        })
        .is_err());
    }

    #[test]
    fn passphrase_uses_wordlist_and_options() {
        let opts = PassphraseOptions::default();
        let phrase = generate_passphrase(&opts).unwrap();
        let bits = phrase.trim_end_matches(|c: char| c.is_ascii_digit());
        let parts: Vec<&str> = bits.split('-').collect();
        assert_eq!(parts.len(), 6);
        for part in parts {
            let lower = part.to_lowercase();
            assert!(WORDS.contains(&lower.as_str()), "{part} not in wordlist");
        }
        assert!(passphrase_bits(6) > 60.0);
    }

    #[test]
    fn passphrase_validation() {
        assert!(generate_passphrase(&PassphraseOptions {
            words: 2,
            ..Default::default()
        })
        .is_err());
        assert!(generate_passphrase(&PassphraseOptions {
            words: 4,
            separator: "----".into(),
            ..Default::default()
        })
        .is_err());
    }
}
