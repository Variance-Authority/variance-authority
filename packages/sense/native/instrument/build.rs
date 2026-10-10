//! The digest of the sources this build of the crate was compiled from.
//!
//! [`recipe`](src/lib.rs) carries it, so a pipeline built against another
//! release of the crate is told apart from this one even where the walk moved
//! and the instrumentation id did not. The manifest is read too: it pins the
//! parser, and the parser decides the regions as much as the walk does. Line
//! endings are dropped, so a checkout that rewrote them is the same source.

use sha2::{Digest, Sha256};
use std::{env, fs, path::Path};

fn main() {
    let root = env::var("CARGO_MANIFEST_DIR").expect("cargo sets the manifest directory");
    let root = Path::new(&root);
    let mut files: Vec<String> = fs::read_dir(root.join("src"))
        .expect("the crate has its sources")
        .map(|entry| format!("src/{}", entry.expect("a readable entry").file_name().to_string_lossy()))
        .filter(|name| name.ends_with(".rs"))
        .collect();
    files.push("Cargo.toml".to_string());
    files.sort();

    let mut hasher = Sha256::new();
    for name in &files {
        let text = fs::read_to_string(root.join(name)).expect("a source is text");
        hasher.update(name.as_bytes());
        hasher.update([0]);
        hasher.update(text.replace('\r', "").as_bytes());
        hasher.update([0]);
    }
    let hex: String = hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect();
    println!("cargo:rustc-env=SENSE_INSTRUMENT_SOURCES={hex}");
    println!("cargo:rerun-if-changed=src");
    println!("cargo:rerun-if-changed=Cargo.toml");
}
