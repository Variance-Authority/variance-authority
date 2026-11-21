//! What a stylesheet asks for: `@import`, `@use`, `@forward` and `url()`, and
//! the forms the Sass partial convention lets one specifier take.
//!
//! A scan of the text and not a parse: it over-reads a specifier inside a
//! comment, which costs a collection, rather than miss one, which costs a
//! subject nobody observed. Nothing here binds a name: a stylesheet request is
//! a whole-file dependency. `\b` is ASCII in each pattern.

// compass: variance-authority.reach.source-scan

use std::sync::LazyLock;

use regex::Regex;

use crate::read::{Kind, Lines, Read, Request};

/// `@import "x"`, `@import url("x")`, `@use "x"`, `@forward "x"`.
static AT_RULE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"@(?:import|use|forward)\s+(?:url\(\s*)?(?:'([^']*)'|"([^"]*)")"#).expect("pattern"));
/// `url(x)` unquoted, and the quoted forms.
static URL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?-u:\b)url\(\s*(?:'([^']*)'|"([^"]*)"|([^)'"]+))\s*\)"#).expect("pattern"));
/// CSS Modules: `composes: name from './other.css'`.
static COMPOSES: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?-u:\b)composes\s*:[^;]*?(?-u:\b)from\s+(?:'([^']*)'|"([^"]*)")"#).expect("pattern"));

/// Every specifier a stylesheet names, each an `asset` request binding nothing.
/// A stylesheet declares no names, and that is read, not unknown.
pub(crate) fn read_style(source: &str) -> Read {
    let lines = Lines::new(source);
    let mut requests = Vec::new();
    for pattern in [&*AT_RULE, &*URL, &*COMPOSES] {
        for found in pattern.captures_iter(source) {
            let value = (1..=3).find_map(|group| found.get(group)).map_or("", |group| group.as_str());
            // `String.prototype.trim`: white space, line ends and the byte-order mark.
            let value = value.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}');
            if value.is_empty() || is_external(value) {
                continue;
            }
            let at = found.get(0).map_or(0, |whole| whole.start()) as u32;
            requests.push(Request {
                value: value.to_owned(),
                kind: Kind::Asset,
                bindings: Vec::new(),
                line: lines.at(at),
                republishes: false, guessed: false, item: false,
            });
        }
    }
    Read { requests, harvested: true, ..Read::default() }
}

/// `isExternal` in `read.ts`: a specifier that names no file of the tree.
fn is_external(value: &str) -> bool {
    ["data:", "http:", "https:", "//", "#"].iter().any(|prefix| value.starts_with(prefix))
}

/// The forms one stylesheet specifier can take: as written, as a Sass partial,
/// and, for the `~` of the webpack era, as written with it.
pub(crate) fn style_requests(request: &str) -> Vec<String> {
    let bare = request.strip_prefix('~').unwrap_or(request);
    let cut = bare.rfind('/').map_or(0, |at| at + 1);
    let partial = format!("{}_{}", &bare[..cut], &bare[cut..]);
    if bare.len() == request.len() {
        vec![bare.to_owned(), partial]
    } else {
        vec![bare.to_owned(), partial, request.to_owned()]
    }
}

#[cfg(test)]
#[path = "style_tests.rs"]
mod tests;
