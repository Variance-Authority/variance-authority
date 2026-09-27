//! Which directories could have answered a record's resolution: `witnessesOf`
//! in `witness.ts`, for the records a cold build settles on this side.
//!
//! The rule is the TypeScript one and so is its arithmetic. A witness is a
//! repository path spelled by Node's POSIX `normalize`, `dirname` and `join`,
//! and a wildcard alias is substituted by `String.prototype.replace`, so each
//! of those is ported here rather than approximated with `std::path`: a
//! witness spelled differently is a directory the next run never finds moved,
//! and a record reused past the change that should have rebuilt it.
//!
//! The alias patterns are not read here. `aliasesIn` has already read every
//! configuration and placed each target, and hands the result over as a table
//! (`Aliases.table`); this side only asks it the question `candidatesFor` asks.

// compass: variance-authority.reach.source-index

use std::collections::{BTreeSet, HashSet};

use serde::Deserialize;

use crate::specifier::{is_relative, request_of};

/// One `paths` pattern, placed: `Mapping` in `witness.ts`.
#[derive(Debug, Deserialize)]
pub struct Mapping {
    prefix: String,
    /// Absent when the pattern is exact.
    suffix: Option<String>,
    targets: Vec<String>,
}

/// What `aliasesIn` read: the `baseUrl` directories in the order they were
/// declared, and every mapping.
#[derive(Debug, Deserialize)]
pub struct AliasTable {
    bases: Vec<String>,
    mappings: Vec<Mapping>,
}

impl AliasTable {
    /// `candidatesFor`: every repository path this request could name through
    /// a configuration, in the order JavaScript lists them.
    fn candidates_for(&self, request: &str) -> Vec<String> {
        let mut found: Vec<String> = self.bases.iter().map(|base| join(&[base, request])).collect();
        for mapping in &self.mappings {
            match &mapping.suffix {
                None if request == mapping.prefix => found.extend(mapping.targets.iter().cloned()),
                None => {}
                Some(suffix) => {
                    if request.starts_with(&mapping.prefix)
                        && request.ends_with(suffix.as_str())
                        && request.len() >= mapping.prefix.len() + suffix.len()
                    {
                        let matched = &request[mapping.prefix.len()..request.len() - suffix.len()];
                        found.extend(mapping.targets.iter().map(|target| replace_star(target, matched)));
                    }
                }
            }
        }
        found
    }
}

/// `target.replace('*', matched)`: the first `*` only, with the replacement's
/// `$` patterns honoured the way `GetSubstitution` honours them for a string
/// pattern — `$$`, `$&`, `` $` `` and `$'`; anything else after a `$` is text.
fn replace_star(target: &str, matched: &str) -> String {
    let Some(at) = target.find('*') else {
        return target.to_owned();
    };
    let (before, after) = (&target[..at], &target[at + 1..]);
    let mut out = String::with_capacity(target.len() + matched.len());
    out.push_str(before);
    let mut characters = matched.chars().peekable();
    while let Some(character) = characters.next() {
        if character != '$' {
            out.push(character);
            continue;
        }
        match characters.peek() {
            Some('$') => out.push('$'),
            Some('&') => out.push('*'),
            Some('`') => out.push_str(before),
            Some('\'') => out.push_str(after),
            _ => {
                out.push('$');
                continue;
            }
        }
        characters.next();
    }
    out.push_str(after);
    out
}

/// `witnessesOf`: the directories every request named, lexically, and the
/// directory each settled edge landed in — sorted by code unit, once each.
pub fn witnesses_of<'a>(
    file: &str,
    requests: impl IntoIterator<Item = &'a str>,
    edges: impl IntoIterator<Item = &'a str>,
    directories: &HashSet<String>,
    aliases: Option<&AliasTable>,
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
        } else if let Some(aliases) = aliases {
            for alias in aliases.candidates_for(bare) {
                candidate(&alias);
            }
        }
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
