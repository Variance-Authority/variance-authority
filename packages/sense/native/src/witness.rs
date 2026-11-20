//! Directories named by lexical requests, resolver-owned candidates and settled edges.

// compass: variance-authority.reach.source-index

use std::collections::{BTreeSet, HashSet};

use crate::specifier::{is_relative, request_of};

/// The directories every request named, lexically, and the
/// directory each settled edge landed in — sorted by code unit, once each.
pub fn witnesses_of<'a>(
    file: &str,
    requests: impl IntoIterator<Item = &'a str>,
    edges: impl IntoIterator<Item = &'a str>,
    directories: &HashSet<String>,
    candidates: impl IntoIterator<Item = &'a str>,
) -> Vec<String> {
    let directory = parent(file);
    let mut found = BTreeSet::new();
    let mut candidate = |path: &str| {
        let Some(at) = within(path) else { return };
        if directories.contains(&at) {
            found.insert(Ordered(at.clone()));
        }
        found.insert(Ordered(parent(&at)));
    };
    for value in requests {
        let Some(request) = request_of(value) else { continue };
        let bare = request.strip_prefix('~').unwrap_or(request);
        if is_relative(bare) {
            candidate(&join(&[&directory, bare]));
        }
    }
    for path in candidates {
        candidate(path);
    }
    for edge in edges {
        found.insert(Ordered(parent(edge)));
    }
    found.into_iter().map(|Ordered(value)| value).collect()
}

/// A string ordered as JavaScript's default `sort` orders it.
#[derive(PartialEq, Eq)]
struct Ordered(String);

impl PartialOrd for Ordered {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Ordered {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        crate::order::code_unit(&self.0, &other.0)
    }
}

/// A path's directory, with the repository root written as the empty string.
fn parent(path: &str) -> String {
    let at = dirname(path);
    if at == "." || at == "/" { String::new() } else { at.to_owned() }
}

/// A repository-relative path, or nothing when it names something outside.
fn within(path: &str) -> Option<String> {
    let normalized = normalize(path);
    if normalized == "." || normalized.is_empty() {
        return Some(String::new());
    }
    (!(normalized.starts_with("../") || normalized == "..")).then_some(normalized)
}

/// Node's `path.posix.dirname`.
pub(crate) fn dirname(path: &str) -> &str {
    let bytes = path.as_bytes();
    if bytes.is_empty() {
        return ".";
    }
    let root = bytes[0] == b'/';
    let mut end = None;
    let mut matched_slash = true;
    for at in (1..bytes.len()).rev() {
        if bytes[at] == b'/' {
            if !matched_slash {
                end = Some(at);
                break;
            }
        } else {
            matched_slash = false;
        }
    }
    match end {
        None if root => "/",
        None => ".",
        Some(1) if root => "//",
        Some(end) => &path[..end],
    }
}

/// Node's `path.posix.normalize`.
pub(crate) fn normalize(path: &str) -> String {
    if path.is_empty() {
        return ".".to_owned();
    }
    let absolute = path.starts_with('/');
    let trailing = path.ends_with('/');
    let mut kept: Vec<&str> = Vec::new();
    for segment in path.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                if kept.last().is_some_and(|last| *last != "..") {
                    kept.pop();
                } else if !absolute {
                    kept.push("..");
                }
            }
            segment => kept.push(segment),
        }
    }
    let mut out = kept.join("/");
    if out.is_empty() {
        return if absolute { "/" } else if trailing { "./" } else { "." }.to_owned();
    }
    if trailing {
        out.push('/');
    }
    if absolute { format!("/{out}") } else { out }
}

/// Node's `path.posix.join`.
pub(crate) fn join(parts: &[&str]) -> String {
    let joined = parts.iter().filter(|part| !part.is_empty()).copied().collect::<Vec<_>>().join("/");
    if joined.is_empty() { ".".to_owned() } else { normalize(&joined) }
}

#[cfg(all(test, unix))]
#[path = "witness_tests.rs"]
mod tests;
