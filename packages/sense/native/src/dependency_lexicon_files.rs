//! One refresh's file readings: bytes, their digest, and context-free syntax.
//! Export traversal stays with each entrypoint, where its package and cycles are known.

// compass: variance-authority.reach.source-scan

use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::{fs, io};

use dashmap::DashMap;
use oxc_allocator::Allocator;
use sha2::{Digest, Sha256};

use crate::dependency_namespace::{exported_import, exported_namespace, NamespaceSymbol};
use crate::read::{read_module_and_tree, Read};

pub(super) struct Module {
    pub parsed: Read,
    pub utf16: Vec<u16>,
    pub namespace: Vec<NamespaceSymbol>,
    pub forwarded: Vec<String>,
}

pub(super) struct File {
    bytes: Vec<u8>,
    digest: OnceLock<String>,
    manifest: OnceLock<Option<Arc<serde_json::Value>>>,
    module: OnceLock<Option<Arc<Module>>>,
}

impl File {
    pub fn text(&self) -> io::Result<&str> {
        std::str::from_utf8(&self.bytes).map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "stream did not contain valid UTF-8"))
    }

    fn digest(&self) -> String {
        self.digest.get_or_init(|| crate::journeys::hex(&Sha256::digest(&self.bytes))).clone()
    }

    fn module(&self, path: &Path) -> Option<Arc<Module>> {
        self.module.get_or_init(|| {
            let source = self.text().ok()?;
            let allocator = Allocator::default();
            let (parsed, program) = read_module_and_tree(&path.to_string_lossy(), source, &allocator, true);
            let namespace = exported_namespace(&path.to_string_lossy(), source, &program, &parsed.symbols);
            let forwarded = exported_import(&program);
            Some(Arc::new(Module { parsed, utf16: source.encode_utf16().collect(), namespace, forwarded }))
        }).clone()
    }
}

type Reading = Result<Arc<File>, Arc<io::Error>>;

#[derive(Default)]
pub(super) struct Files {
    readings: DashMap<PathBuf, Arc<OnceLock<Reading>>>,
}

impl Files {
    pub fn read(&self, path: &Path) -> Reading {
        let cell = self.readings.entry(path.to_owned()).or_default().clone();
        cell.get_or_init(|| fs::read(path).map(|bytes| Arc::new(File {
            bytes, digest: OnceLock::new(), manifest: OnceLock::new(), module: OnceLock::new(),
        })).map_err(Arc::new)).clone()
    }

    pub fn digest(&self, path: &Path) -> Option<String> {
        Some(self.read(path).ok()?.digest())
    }

    pub fn manifest(&self, path: &Path) -> Option<Arc<serde_json::Value>> {
        let file = self.read(path).ok()?;
        file.manifest.get_or_init(|| serde_json::from_slice(&file.bytes).ok().map(Arc::new)).clone()
    }

    pub fn module(&self, path: &Path) -> Option<Arc<Module>> {
        self.read(path).ok()?.module(path)
    }
}

#[cfg(test)]
mod tests {
    use super::Files;
    use sha2::{Digest, Sha256};

    #[test]
    fn a_declarations_digest_describes_the_bytes_parsed_and_the_next_refresh_sees_edits() {
        let path = std::env::temp_dir().join(format!("sense-lexicon-read-{}.d.ts", std::process::id()));
        let original = "export declare const original: true;";
        std::fs::write(&path, original).unwrap();
        let refresh = Files::default();
        assert_eq!(refresh.module(&path).unwrap().parsed.symbols[0].name, "original");
        std::fs::write(&path, "export declare const edited: true;").unwrap();
        assert_eq!(refresh.digest(&path), Some(crate::journeys::hex(&Sha256::digest(original.as_bytes()))));
        let next = Files::default();
        assert_eq!(next.module(&path).unwrap().parsed.symbols[0].name, "edited");
        assert_ne!(refresh.digest(&path), next.digest(&path));
        std::fs::remove_file(path).unwrap();
    }
}
