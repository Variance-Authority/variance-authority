//! This project's digest, taken natively.
//!
//! `v1:` and the first thirty-two hex characters of a SHA-256, which is what
//! `@variance-authority/core/format` hands out and what every stored digest in
//! an index already is. The prefix and the truncation are that package's to
//! decide and are reproduced here rather than reinvented: a second place
//! choosing either is a digest domain that splits without anybody noticing.

use sha2::{Digest, Sha256};

const PREFIX: &str = "v1";
const HEX_LENGTH: usize = 32;

/// A string's digest, in the shape every other digest in the system has.
pub fn of_string(input: &str) -> String {
    of_sha256(Sha256::digest(input.as_bytes()).as_slice())
}

/// A SHA-256 some other pass already computed, given this project's identity.
pub fn of_sha256(hashed: &[u8]) -> String {
    let mut out = String::with_capacity(PREFIX.len() + 1 + HEX_LENGTH);
    out.push_str(PREFIX);
    out.push(':');
    for byte in &hashed[..HEX_LENGTH / 2] {
        out.push_str(HEX[(byte >> 4) as usize]);
        out.push_str(HEX[(byte & 0x0f) as usize]);
    }

    out
}

const HEX: [&str; 16] = [
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d", "e", "f",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_the_shape_the_index_stores() {
        // sha256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
        assert_eq!(of_string(""), "v1:e3b0c44298fc1c149afbf4c8996fb924");
    }
}
