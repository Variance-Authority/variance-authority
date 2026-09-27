//! What a written specifier asks for, read the way `specifier.ts` reads it.
//!
//! A cold build settles every module's record on this side, so the four
//! questions `builtFromBatch` asks of a specifier — is there a request in it,
//! is it relative, which package does it name, is its target code — are asked
//! here too. They are ports rather than new rules: a record built here and a
//! record built by the TypeScript path from the same batch are compared byte
//! for byte, so every branch follows the JavaScript one, down to which
//! characters `String.prototype.trim` removes.
//!
//! Only the module reading of each question is ported. The cold graph reads
//! modules and nothing else (`batch.rs` walks the eight module extensions), so
//! the Python, Rust and Swift branches of `isRelative` are never asked here.

// compass: variance-authority.reach.source-index

use std::collections::HashSet;

/// Whether JavaScript's `trim` removes this character: ECMAScript's
/// WhiteSpace and LineTerminator. Unicode's `White_Space` differs in two
/// places — it holds U+0085, which JavaScript keeps, and lacks U+FEFF, which
/// JavaScript removes.
fn js_space(value: char) -> bool {
    (value.is_whitespace() && value != '\u{85}') || value == '\u{feff}'
}

/// `requestOf`: the part of a written specifier that names a file, or nothing
/// when it names none — empty, inline data, or a `node:` builtin.
pub fn request_of(value: &str) -> Option<&str> {
    let trimmed = value.trim_matches(js_space);
    if trimmed.is_empty() || trimmed.starts_with("data:") || trimmed.starts_with("node:") {
        return None;
    }
    let query = trimmed.find('?').unwrap_or(trimmed.len());
    let from = usize::from(trimmed.starts_with('#'));
    let hash = trimmed[from..].find('#').map_or(trimmed.len(), |at| at + from);
    let bare = &trimmed[..query.min(hash)];
    (!bare.is_empty()).then_some(bare)
}

/// `isRelative` for a module.
pub fn is_relative(request: &str) -> bool {
    request.starts_with("./") || request.starts_with("../") || request == "." || request == ".."
}

/// `packageOf`: the package a bare request names. `builtins` is Node's own
/// list, handed over by the caller, because which names are builtin is the
/// runtime's answer and not one to copy into a table here.
pub fn package_of<'a>(request: &'a str, builtins: &HashSet<String>) -> Option<&'a str> {
    if is_relative(request)
        || request.starts_with('/')
        || request.starts_with('#')
        || request.contains("://")
        || builtins.contains(request)
    {
        return None;
    }
    let name = if request.starts_with('@') {
        match request.match_indices('/').nth(1) {
            Some((at, _)) => &request[..at],
            None => request,
        }
    } else {
        request.split('/').next().unwrap_or(request)
    };
    (!(name.is_empty() || (name.starts_with('@') && !name.contains('/')))).then_some(name)
}

/// `kindFor`: a declared `type` or `depends` edge stays itself, and any other
/// edge is its kind when the target is read as code and `asset` when it is not.
/// `code` is every extension whose language carries code, from `language.ts`.
pub fn kind_for<'a>(kind: &'a str, target: &str, code: &HashSet<String>) -> &'a str {
    if kind == "type" || kind == "depends" || code.contains(extname(target)) {
        kind
    } else {
        "asset"
    }
}

/// Node's `path.extname`, for a POSIX path: the basename's last `.` onward,
/// unless that dot opens the name or the name is `..`. Trailing slashes are
/// not part of the name.
pub fn extname(path: &str) -> &str {
    let trimmed = path.trim_end_matches('/');
    let name = &trimmed[trimmed.rfind('/').map_or(0, |at| at + 1)..];
    if name == ".." {
        return "";
    }
    match name.rfind('.') {
        Some(at) if at > 0 => &name[at..],
        _ => "",
    }
}

#[cfg(all(test, unix))]
#[path = "specifier_tests.rs"]
mod tests;
