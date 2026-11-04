//! A file of a tree-sitter language, as the boundary answers for it: the grammars
//! are a build feature, so each method here has a second body for a build without
//! them, and JavaScript calls the same name either way.

use napi_derive::napi;

#[cfg(feature = "grammars")]
use crate::languages;

/// What one file of a tree-sitter language asks for and publishes, as JSON.
///
/// The AST does not cross — a `Read` is a handful of specifiers and names, the
/// same object graph every reader answers with, and no more. `null` means no
/// reader here claims that language, and the caller records the file as unknown.
#[cfg(feature = "grammars")]
#[napi(catch_unwind)]
pub fn read_language(language: String, file: String, source: String) -> Option<String> {
    let read = languages::read(&language, &file, &source)?;
    serde_json::to_string(&read).ok()
}

/// The same method on a build whose grammars did not compile: it claims nothing.
///
/// The method stays rather than disappearing, so `record.ts` has one branch for
/// it: `null` makes every file in the five languages *unknown*, with a reason
/// that names the missing grammars. Everything else this crate does — git
/// identity, the path set, the oxc parse, resolution, the journey fold — is here
/// and is what it was.
#[cfg(not(feature = "grammars"))]
#[napi(catch_unwind)]
pub fn read_language(_language: String, _file: String, _source: String) -> Option<String> {
    None
}

/// The targets a `Package.swift` declares, as JSON `[{ name, path }]`.
///
/// `null` when the manifest does not parse, or on a build without the grammars;
/// either way `swift.ts` keeps the conventional `Sources/<name>` layout.
#[cfg(feature = "grammars")]
#[napi(catch_unwind)]
pub fn swift_targets(source: String) -> Option<String> {
    let targets = languages::swift_targets(&source)?;
    serde_json::to_string(&targets).ok()
}

/// The same method on a build whose grammars did not compile: it claims nothing.
#[cfg(not(feature = "grammars"))]
#[napi(catch_unwind)]
pub fn swift_targets(_source: String) -> Option<String> {
    None
}
