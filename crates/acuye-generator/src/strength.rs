//! Password strength estimation used for user feedback and the local Security
//! Center. This is a heuristic, not a password audit: it estimates the entropy
//! of the character pool actually used and penalties for obvious patterns.
//! Passwords are never transmitted anywhere.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PasswordStrength {
    /// Estimated entropy in bits.
    pub bits: f64,
    /// 0 (very weak) .. 4 (strong).
    pub score: u8,
    pub label: String,
    pub feedback: Vec<String>,
}

/// Entropy estimate in bits for an arbitrary password.
pub fn entropy_bits(password: &str) -> f64 {
    if password.is_empty() {
        return 0.0;
    }
    let mut has_lower = false;
    let mut has_upper = false;
    let mut has_digit = false;
    let mut has_symbol = false;
    let mut has_other = false;
    for c in password.chars() {
        if c.is_ascii_lowercase() {
            has_lower = true;
        } else if c.is_ascii_uppercase() {
            has_upper = true;
        } else if c.is_ascii_digit() {
            has_digit = true;
        } else if c.is_ascii_punctuation() || c == ' ' {
            has_symbol = true;
        } else {
            has_other = true;
        }
    }
    let mut pool: f64 = 0.0;
    if has_lower {
        pool += 26.0;
    }
    if has_upper {
        pool += 26.0;
    }
    if has_digit {
        pool += 10.0;
    }
    if has_symbol {
        pool += 33.0;
    }
    if has_other {
        pool += 100.0;
    }
    let len = password.chars().count() as f64;
    let raw = len * pool.max(1.0).log2();

    // Penalise low character diversity (e.g. "aaaaaaaaaaaa").
    let unique = password
        .chars()
        .collect::<std::collections::BTreeSet<_>>()
        .len() as f64;
    let diversity = (unique / len).min(1.0);
    let diversity_factor = 0.6 + 0.4 * diversity;

    // Penalise runs and immediate repetitions.
    let mut repeats = 0usize;
    let chars: Vec<char> = password.chars().collect();
    for w in chars.windows(2) {
        if w[0] == w[1] {
            repeats += 1;
        }
    }
    let repeat_factor = 1.0 - (repeats as f64 / len.max(1.0)) * 0.5;

    let sequential = chars
        .windows(3)
        .filter(|w| {
            let a = w[0] as i32;
            let b = w[1] as i32;
            let c = w[2] as i32;
            (a - b == 1 && b - c == 1) || (b - a == 1 && c - b == 1)
        })
        .count();
    let sequence_factor = 1.0 - (sequential as f64 * 4.0).min(40.0) / 100.0;

    (raw * diversity_factor * repeat_factor * sequence_factor).max(0.0)
}

/// Obvious common/patterned passwords that should never protect a vault.
/// This is a small local blocklist, not a breach lookup service.
pub fn looks_common(password: &str) -> bool {
    const BLOCKLIST: &[&str] = &[
        "password",
        "passw0rd",
        "letmein",
        "qwerty",
        "azerty",
        "123456",
        "12345678",
        "123456789",
        "1234567890",
        "iloveyou",
        "admin",
        "welcome",
        "monkey",
        "dragon",
        "sunshine",
        "master",
        "login",
        "abc123",
        "changeme",
        "secret",
        "acuye",
    ];
    let lower = password.to_lowercase();
    if lower.len() < 4 {
        return true;
    }
    if BLOCKLIST.iter().any(|word| lower.contains(word)) {
        return true;
    }
    // All the same character.
    let unique = lower
        .chars()
        .collect::<std::collections::BTreeSet<_>>()
        .len();
    if unique == 1 {
        return true;
    }
    // A short pattern repeated to fill the password ("abcabcabcabc").
    let chars: Vec<char> = lower.chars().collect();
    for unit in 1..=chars.len() / 2 {
        if chars.len() % unit == 0 && chars.chunks(unit).all(|chunk| chunk == &chars[..unit]) {
            return true;
        }
    }
    false
}

/// At least three of the four character classes (lower, upper, digit, symbol).
pub fn character_class_count(password: &str) -> usize {
    let mut lower = false;
    let mut upper = false;
    let mut digit = false;
    let mut symbol = false;
    for c in password.chars() {
        if c.is_ascii_lowercase() {
            lower = true;
        } else if c.is_ascii_uppercase() {
            upper = true;
        } else if c.is_ascii_digit() {
            digit = true;
        } else {
            symbol = true;
        }
    }
    [lower, upper, digit, symbol].iter().filter(|v| **v).count()
}

/// Full strength evaluation with human readable feedback.
pub fn evaluate(password: &str) -> PasswordStrength {
    let bits = entropy_bits(password);
    let score = match bits {
        b if b < 28.0 => 0,
        b if b < 36.0 => 1,
        b if b < 60.0 => 2,
        b if b < 80.0 => 3,
        _ => 4,
    };
    let label = match score {
        0 => "Very weak",
        1 => "Weak",
        2 => "Fair",
        3 => "Strong",
        _ => "Very strong",
    };
    let mut feedback = Vec::new();
    if password.chars().count() < 12 {
        feedback.push("Use at least 12 characters.".into());
    }
    if bits < 60.0 {
        feedback.push("Mix upper case, lower case, numbers and symbols.".into());
    }
    let mut counts = [0usize; 4];
    for c in password.chars() {
        if c.is_ascii_lowercase() {
            counts[0] += 1;
        } else if c.is_ascii_uppercase() {
            counts[1] += 1;
        } else if c.is_ascii_digit() {
            counts[2] += 1;
        } else {
            counts[3] += 1;
        }
    }
    if counts.iter().filter(|&&c| c > 0).count() < 3 {
        feedback.push("Use a wider variety of character types.".into());
    }
    if password
        .chars()
        .collect::<std::collections::BTreeSet<_>>()
        .len()
        < password.chars().count().max(1) / 2
    {
        feedback.push("Avoid repeating the same characters.".into());
    }
    PasswordStrength {
        bits,
        score,
        label: label.into(),
        feedback,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_and_short_passwords_are_weak() {
        assert_eq!(entropy_bits(""), 0.0);
        assert!(entropy_bits("abc") < 28.0);
        assert!(evaluate("abc").score <= 1);
    }

    #[test]
    fn long_mixed_passwords_are_strong() {
        let pw = "ZX9!vQ2#tR7$kL4&mN8*";
        assert!(entropy_bits(pw) > 80.0);
        assert_eq!(evaluate(pw).score, 4);
    }

    #[test]
    fn repetition_is_penalised() {
        let repeated = entropy_bits("aaaaaaaaaaaaaaaaaaaa");
        let varied = entropy_bits("aB3!kL9@qW2#zX7$");
        assert!(repeated < varied);
    }

    #[test]
    fn sequential_runs_are_penalised() {
        assert!(entropy_bits("abcdefghijkl") < entropy_bits("kqzmwrtbvxnp"));
    }

    #[test]
    fn common_and_repeated_patterns_are_flagged() {
        assert!(looks_common("passwordpassword"));
        assert!(looks_common("Password123!"));
        assert!(looks_common("abcabcabcabc"));
        assert!(looks_common("aaaaaaaa"));
        assert!(!looks_common("ZX9!vQ2#tR7$kL4&mN8*"));
        assert_eq!(character_class_count("Aa1!"), 4);
        assert_eq!(character_class_count("aaaa"), 1);
    }

    #[test]
    fn passphrase_style_password_is_strong() {
        let strength = evaluate("correct-horse-battery-staple-42");
        assert!(strength.score >= 3, "{strength:?}");
        assert!(strength.bits > 90.0);
    }
}
