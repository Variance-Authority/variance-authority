//! What one file's bytes say about the files around it.
//!
//! [`read.ts`](../../src/read.ts) is the oracle and this answers the same
//! questions over the same parser: static imports, re-exports, literal dynamic
//! imports and `require()` calls, each as a specifier and the kind of edge it
//! makes. What it deliberately does not build is the per-binding record — names,
//! aliases and lines are a reading of the file for a human, and no edge in the
//! graph asks for them. Those stay on the JavaScript side, which already has
//! them and has no scale problem holding them.

use std::collections::HashMap;

use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;

/// What a request makes of the file it names, in the vocabulary the graph uses.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Imports = 0,
    Reexports,
    Dynamic,
    Type,
}

impl Kind {
    /// Every kind, in the order their codes index them.
    pub const ALL: [Kind; 4] = [Kind::Imports, Kind::Reexports, Kind::Dynamic, Kind::Type];

    /// This kind's index in [`Kind::ALL`], which is what crosses the boundary.
    pub fn code(self) -> u8 {
        self as u8
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Imports => "imports",
            Kind::Reexports => "reexports",
            Kind::Dynamic => "dynamic",
            Kind::Type => "type",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Request {
    pub value: String,
    pub kind: Kind,
}

#[derive(Debug, Default)]
pub struct Read {
    pub requests: Vec<Request>,
    /// Why these requests are not the whole set, when they are not.
    pub unknown: Option<String>,
}

/// Every specifier a module's bytes name, and whether that set is complete.
///
/// The arena is the caller's because arenas are the expensive part: a fresh one
/// per file is a mapping and an unmapping per file, and a pooled one that is
/// reset and handed to the next file is neither.
///
/// Parse errors are recoverable in `oxc` — a record always comes back — so a
/// file that failed to parse is a *partial* answer carrying its reason, never an
/// absent one. Rounding that down to "no edges" would claim a file depends on
/// nothing, which is the one answer that narrows a selection on no evidence.
pub fn read_module(file: &str, source: &str, allocator: &Allocator) -> Read {
    let source_type = SourceType::from_path(file).unwrap_or_else(|_| SourceType::tsx());
    let parsed = Parser::new(allocator, source, source_type).parse();

    let mut requests: Vec<Request> = Vec::new();
    let mut reasons: Vec<String> = Vec::new();
    let record = &parsed.module_record;

    // The napi binding hands JavaScript one entry per *statement*, with the
    // bindings nested under it. The Rust record is flat — one entry per binding,
    // carrying the span of the statement it came from — so the statement is
    // rebuilt here rather than read off. `import './x'` binds nothing and so
    // appears in no entry list at all; `requested_modules` is where it survives.
    let mut imported: Vec<(u32, String, bool)> = Vec::new();
    for entry in &record.import_entries {
        let at = entry.statement_span.start;
        match imported.last_mut() {
            Some(held) if held.0 == at => held.2 &= entry.is_type,
            _ => imported.push((at, entry.module_request.name.to_string(), entry.is_type)),
        }
    }
    // The statements an `import` already claimed, ascending, so asking whether a
    // requested module is one of them is a search rather than a scan of everything
    // claimed so far — which on a barrel is the difference between n and n squared.
    // `imported` itself stops being sorted the moment this loop appends to it, so
    // the keys are taken now and left alone.
    let claimed: Vec<u32> = imported.iter().map(|(at, ..)| *at).collect();

    for (specifier, occurrences) in &record.requested_modules {
        for occurrence in occurrences {
            // A statement that bound a name is already held, and an export or an
            // `import()` is not an import statement at all.
            if !occurrence.is_import
                || claimed.binary_search(&occurrence.statement_span.start).is_ok()
            {
                continue;
            }
            // Bare `import './x'` — a side effect, which is the shape a
            // stylesheet arrives in and never a type import.
            imported.push((occurrence.statement_span.start, specifier.to_string(), false));
        }
    }
    imported.sort_by_key(|(at, ..)| *at);
    for (_, value, only_types) in imported {
        requests.push(Request { value, kind: if only_types { Kind::Type } else { Kind::Imports } });
    }

    // `export { a, b } from './x'` arrives as two entries naming one specifier.
    // Grouping keeps it one request, so a barrel republishing fifty names is one
    // edge rather than fifty, and the type-only rule is decided over the whole
    // request the way an import's is. `export *` and `export { x } from` are
    // held in two lists and read in one, ordered the way the source wrote them.
    let mut exported: Vec<_> = record
        .indirect_export_entries
        .iter()
        .chain(record.star_export_entries.iter())
        .map(|entry| (entry, (entry.statement_span.start, entry.span.start)))
        .collect();
    exported.sort_by_key(|(_, at)| *at);

    let mut republished: Vec<(&str, bool)> = Vec::new();
    let mut at: HashMap<&str, usize> = HashMap::new();
    for (entry, _) in exported {
        let Some(from) = entry.module_request.as_ref() else { continue };
        let name = from.name.as_str();
        match at.get(name) {
            Some(group) => republished[*group].1 &= entry.is_type,
            None => {
                at.insert(name, republished.len());
                republished.push((name, entry.is_type));
            }
        }
    }
    for (value, only_types) in republished {
        let kind = if only_types { Kind::Type } else { Kind::Reexports };
        requests.push(Request { value: value.to_owned(), kind });
    }

    for entry in &record.dynamic_imports {
        let span = entry.module_request;
        match quoted(&source[span.start as usize..span.end as usize]) {
            Some(literal) => requests.push(Request { value: literal, kind: Kind::Dynamic }),
            None => reasons.push("an `import()` whose specifier is not a literal".to_owned()),
        }
    }

    let required = read_requires(source);
    requests.extend(required.requests);
    if let Some(reason) = required.unknown {
        reasons.push(reason);
    }

    if !parsed.diagnostics.is_empty() {
        let first = parsed.diagnostics.first().map(|e| e.message.to_string()).unwrap_or_default();
        reasons.push(format!("{} parse error(s): {first}", parsed.diagnostics.len()));
    }

    Read { requests, unknown: (!reasons.is_empty()).then(|| reasons.join("; ")) }
}

/// The text inside a string literal, when that is what this is.
fn quoted(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let first = *bytes.first()?;
    if bytes.len() < 2 || (first != b'\'' && first != b'"') || *bytes.last()? != first {
        return None;
    }
    let inner = &text[1..text.len() - 1];
    // A literal carrying an escape was written with one, and unescaping it here
    // would be a second and worse parser. Nothing wants the value that badly.
    (!inner.contains('\\') && !inner.contains(first as char)).then(|| inner.to_owned())
}

/// Literal `require` calls, and whether any call was not one.
///
/// The module record cannot see `require`, so this is a text scan, and — as on
/// the JavaScript side — it is written as a *count* comparison rather than as a
/// parse: every `require(` is counted, then every `require('literal')`, and a
/// difference means at least one call takes a value this cannot follow. The file
/// is then unknown, which widens.
///
/// Both failure modes of a text scan are safe here. A `require(` inside a
/// comment inflates the total and widens; a literal matched inside a string adds
/// an edge to a file that may not exist, and an edge to nothing reaches nothing.
///
/// A `require` is an import like any other, and is named one. The kind says what
/// the request does, not which syntax spelled it.
fn read_requires(source: &str) -> Read {
    let mut calls = 0usize;
    let mut requests = Vec::new();

    for (at, _) in source.match_indices("require") {
        // `\brequire\s*\(` — a word boundary, then the call.
        if at > 0 && is_word(source.as_bytes()[at - 1]) {
            continue;
        }
        let rest = &source[at + "require".len()..];
        let Some(open) = rest.find(|c: char| !c.is_whitespace()) else { continue };
        if rest.as_bytes()[open] != b'(' {
            continue;
        }
        calls += 1;

        // `require\(\s*(?:'([^']*)'|"([^"]*)")\s*\)` — one quoted run, then the
        // close, with nothing else between. Anything else is a call this cannot
        // read, and the count above is what says so.
        let inner = rest[open + 1..].trim_start();
        let Some(quote) = inner.as_bytes().first().copied() else { continue };
        if quote != b'\'' && quote != b'"' {
            continue;
        }
        let Some(shut) = inner[1..].find(quote as char) else { continue };
        if inner[1 + shut + 1..].trim_start().as_bytes().first() != Some(&b')') {
            continue;
        }
        requests.push(Request { value: inner[1..1 + shut].to_owned(), kind: Kind::Imports });
    }

    let unread = calls - requests.len();

    Read {
        requests,
        unknown: (unread > 0)
            .then(|| format!("{unread} `require()` call(s) with a specifier this cannot read")),
    }
}

/// A word character as `\b` means it: `[A-Za-z0-9_]`, and not `$`.
fn is_word(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}
