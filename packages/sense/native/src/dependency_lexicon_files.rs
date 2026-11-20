//! One refresh's file readings: bytes, their digest, and context-free syntax.
//! Export traversal stays with each entrypoint, where its package and cycles are known.

// compass: variance-authority.reach.relations

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::cell::{OnceCell, RefCell};
use std::rc::Rc;
use std::sync::Arc;
use std::{fs, io};

use oxc_allocator::Allocator;
use sha2::{Digest, Sha256};

use crate::dependency_namespace::{exported_import, exported_namespace, NamespaceSymbol};
use crate::harvest::SourceSymbol;
use crate::read::{read_module_and_tree, Export, Read};

/// What an entrypoint's export walk reads of a declaration file. Its install
/// holds it while that install's pairs are read, so the rest of the
/// module record is dropped as soon as the file is parsed.
pub(super) struct Module {
    /// Whether the reader could not read the file as a module; nothing else is kept then.
    pub unknown: bool,
    /// Each name an import binds, to its request and the name imported.
    pub imports: HashMap<String, (String, String)>,
    pub exports: Vec<Export>,
    pub symbols: Vec<SourceSymbol>,
    pub utf16: Vec<u16>,
    pub namespace: Vec<NamespaceSymbol>,
    pub forwarded: Vec<String>,
}

impl Module {
    fn of(path: &Path, source: &str) -> Self {
        let allocator = Allocator::default();
        let path = path.to_string_lossy();
        let (parsed, program) = read_module_and_tree(&path, source, &allocator, true);
        if parsed.unknown.is_some() {
            return Module { unknown: true, imports: HashMap::new(), exports: Vec::new(), symbols: Vec::new(),
                utf16: Vec::new(), namespace: Vec::new(), forwarded: Vec::new() };
        }
        let namespace = exported_namespace(&path, source, &program, &parsed.symbols);
        let forwarded = exported_import(&program);
        let Read { requests, exports, symbols, .. } = parsed;
        let imports = requests.into_iter().flat_map(|request| request.bindings.into_iter()
            .map(move |binding| (binding.local, (request.value.clone(), binding.imported)))).collect();
        Module { unknown: false, imports, exports, symbols, utf16: source.encode_utf16().collect(), namespace, forwarded }
    }
}

/// A file as one install's pairs read it. The digest is taken from the bytes as read; the bytes are
/// let go once they are parsed as a module.
pub(super) struct File {
    digest: String,
    bytes: RefCell<Option<Vec<u8>>>,
    manifest: OnceCell<Option<Arc<serde_json::Value>>>,
    module: OnceCell<Option<Arc<Module>>>,
}

fn not_utf8() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, "stream did not contain valid UTF-8")
}

impl File {
    /// The file's text, from its bytes. A file parsed as a module has let its bytes go, and nothing
    /// asks the text of one: a manifest and a README are read, never parsed.
    pub fn text(&self) -> io::Result<String> {
        let bytes = self.bytes.borrow();
        let bytes = bytes.as_ref().ok_or_else(not_utf8)?;
        std::str::from_utf8(bytes).map(str::to_owned).map_err(|_| not_utf8())
    }

    fn module(&self, path: &Path) -> Option<Arc<Module>> {
        self.module.get_or_init(|| {
            let bytes = self.bytes.borrow_mut().take()?;
            std::str::from_utf8(&bytes).ok().map(|text| Arc::new(Module::of(path, text)))
        }).clone()
    }
}

type Reading = Result<Rc<File>, Rc<io::Error>>;

/// One install's readings, held by the one thread that reads that install's pairs.
#[derive(Default)]
pub(super) struct Files {
    readings: RefCell<HashMap<PathBuf, Reading>>,
}

impl Files {
    pub fn read(&self, path: &Path) -> Reading {
        if let Some(reading) = self.readings.borrow().get(path) { return reading.clone(); }
        let reading = fs::read(path).map(|bytes| Rc::new(File {
            digest: crate::journeys::hex(&Sha256::digest(&bytes)),
            bytes: RefCell::new(Some(bytes)), manifest: OnceCell::new(), module: OnceCell::new(),
        })).map_err(Rc::new);
        self.readings.borrow_mut().insert(path.to_owned(), reading.clone());
        reading
    }

    pub fn digest(&self, path: &Path) -> Option<String> {
        Some(self.read(path).ok()?.digest.clone())
    }

    pub fn manifest(&self, path: &Path) -> Option<Arc<serde_json::Value>> {
        let file = self.read(path).ok()?;
        file.manifest.get_or_init(|| serde_json::from_str(&file.text().ok()?).ok().map(Arc::new)).clone()
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
        assert_eq!(refresh.module(&path).unwrap().symbols[0].name, "original");
        std::fs::write(&path, "export declare const edited: true;").unwrap();
        assert_eq!(refresh.digest(&path), Some(crate::journeys::hex(&Sha256::digest(original.as_bytes()))));
        let next = Files::default();
        assert_eq!(next.module(&path).unwrap().symbols[0].name, "edited");
        assert_ne!(refresh.digest(&path), next.digest(&path));
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn a_parsed_declaration_lets_its_bytes_go_and_keeps_the_digest_of_what_was_parsed() {
        let path = std::env::temp_dir().join(format!("sense-lexicon-bytes-{}.d.ts", std::process::id()));
        let source = "/** é */\nexport declare const kept: true;\n";
        std::fs::write(&path, source).unwrap();
        let refresh = Files::default();
        let module = refresh.module(&path).unwrap();
        let file = refresh.read(&path).unwrap();
        let held = file.bytes.borrow().is_some();
        std::fs::remove_file(&path).unwrap();
        assert!(!held);
        assert_eq!(String::from_utf16(&module.utf16).unwrap(), source);
        assert_eq!(refresh.digest(&path), Some(crate::journeys::hex(&Sha256::digest(source.as_bytes()))));
    }
}
