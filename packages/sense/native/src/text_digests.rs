//! The digest of each file's text, read off the disk in parallel.
//!
//! A record names a test file and every precondition it ran under by the digest
//! of its text: the bytes read as UTF-8, an invalid sequence read as U+FFFD,
//! as `readFile(path, 'utf8')` reads it. A run hands the whole set at once, so
//! a precondition every test file shares is read once.

use napi::{Error, Result};
use napi_derive::napi;
use rayon::prelude::*;
use sha2::{Digest, Sha256};
use variance_sense_instrument::digest;

/// Each path's text digest, in the order given; the first file that cannot be read fails the call.
#[napi(catch_unwind)]
pub fn text_digests(paths: Vec<String>) -> Result<Vec<String>> {
    paths
        .par_iter()
        .map(|path| match std::fs::read(path) {
            Ok(bytes) => Ok(of_text(&bytes)),
            Err(error) => Err(Error::from_reason(format!("{path} could not be read: {error}"))),
        })
        .collect()
}

fn of_text(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(_) => digest::of_sha256(Sha256::digest(bytes).as_slice()),
        Err(_) => digest::of_string(&String::from_utf8_lossy(bytes)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_text_and_its_lossy_reading_digest_as_strings() {
        assert_eq!(of_text("é\n".as_bytes()), digest::of_string("é\n"));
        assert_eq!(of_text(&[0x61, 0x80, 0x62]), digest::of_string("a\u{fffd}b"));
    }
}
