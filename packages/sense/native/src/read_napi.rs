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
pub fn read_language(language: String, file: String, source: String) -> Option<String> {
    let read = crate::languages::read(&language, &file, &source)?;
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
pub fn read_language(_language: String, _file: String, _source: String) -> Option<String> {
    None
}
