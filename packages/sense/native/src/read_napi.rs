//! What one module reads, as TypeScript asks for it with source text it already
//! holds: the oxc parse for a module, and the tree-sitter readers for the other
//! languages. Each call answers with JSON and does its work in [`crate::read`] or
//! [`crate::languages`].

use napi_derive::napi;

/// One module's parse, as JSON: the value `readBatch` answers for a file on
/// disk, for source text the caller already holds.
#[napi(catch_unwind)]
pub fn read_source(file: String, source: String) -> String {
    let read = crate::read::read_module(&file, &source, &oxc_allocator::Allocator::default(), true);
    serde_json::to_string(&read).unwrap_or_default()
}

/// What one file of a tree-sitter language asks for and publishes, as JSON.
///
/// The AST does not cross — a `Read` is a handful of specifiers and names, the
/// same object graph every reader answers with, and no more. `null` means no
/// reader here claims that language, and the caller records the file as unknown.
#[cfg(feature = "grammars")]
#[napi(catch_unwind)]
pub fn read_language(language: String, source: String) -> Option<String> {
    let read = crate::languages::read(&language, &source)?;
    serde_json::to_string(&read).ok()
}

/// The same method on a build whose grammars did not compile: it claims nothing.
///
/// The method stays rather than disappearing, so its callers have one branch
/// for it: `null` is a read nobody could make. Everything else this crate does — git
/// identity, the path set, the oxc parse, resolution, the journey fold — is here
/// and is what it was.
#[cfg(not(feature = "grammars"))]
#[napi(catch_unwind)]
pub fn read_language(_language: String, _source: String) -> Option<String> {
    None
}

/// Each file's text, read on every core, in the order asked: `null` where no
/// file is there, as `readFileSync`'s `ENOENT`. Bytes that are not UTF-8 read as
/// U+FFFD, as `readFileSync(path, 'utf8')` reads them; any other failure to
/// read is an error naming the file.
#[napi(catch_unwind)]
pub fn read_texts(paths: Vec<String>) -> napi::Result<Vec<Option<String>>> {
    use rayon::prelude::*;
    paths
        .par_iter()
        .map(|path| match std::fs::read(path) {
            Ok(bytes) => Ok(Some(match String::from_utf8(bytes) {
                Ok(text) => text,
                Err(error) => String::from_utf8_lossy(error.as_bytes()).into_owned(),
            })),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(napi::Error::from_reason(format!("`{path}`: {error}"))),
        })
        .collect()
}
