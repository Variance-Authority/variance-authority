//! The top-level names a file declares and does not export, read off the
//! folded chain.
//!
//! The Help value holds every export of every file, which is what a question
//! about a name reaches first. A name a file keeps to itself is in no export
//! list, and the index holds it anyway: every parse harvests its file's
//! top-level declarations. This reads those, so `symbol` and `search` can
//! answer for a private function the way they answer for an exported one.
//! `search` matches a declaration's doc comment as well as its name, and the
//! index holds only the comment's span, so the text is read from the file.

// compass: variance-authority.report.agent-surface

use napi_derive::napi;
use rayon::prelude::*;

use crate::compact::Layer;
use crate::help_usage::kind_of;
use crate::orient_map_read::beside;
use crate::package_graph::{fold, join_parses, Crossing};
use crate::package_owners::{owners, NO_OWNER};
use crate::segment::NONE;

/// One top-level declaration no export of its file binds.
#[napi(object)]
pub struct DeclaredName {
    pub name: String,
    /// The declaration's kind as the parser harvested it: `function`, `const`, …
    pub kind: String,
    pub at: String,
    /// The package whose source it is; empty at the repository root.
    pub by: String,
    pub line: u32,
    /// `source`, `test` or `story`, as `kindOf` in `package/src/use.ts` says.
    pub file_kind: String,
    /// The signature's span in the file's UTF-16 offsets, when the parser kept one.
    pub signature_start: Option<u32>,
    pub signature_end: Option<u32>,
    /// The doc comment's span, inside its opening and closing marks, when one is written above.
    pub doc_start: Option<u32>,
    pub doc_end: Option<u32>,
}

/// What `declared` found, and the files whose declarations it could not read.
#[napi(object)]
pub struct Declared {
    /// Ordered by file in code units, then by line.
    pub names: Vec<DeclaredName>,
    /// Files on the chain whose parse holds no declarations because none were
    /// harvested: unknown, not empty. Code-unit order.
    pub unread: Vec<String>,
}

/// How a name is matched against `query`.
pub(crate) enum Matching {
    /// The name is `query`.
    Exact,
    /// The name, lowercased, contains `query`, which the caller lowercased, or
    /// the doc comment above it does, read as prose.
    Containing,
}

fn span(starts: crate::stored::U32s, ends: crate::stored::U32s, at: usize) -> (Option<u32>, Option<u32>) {
    let (start, end) = (starts.at(at), ends.at(at));
    if start == NONE || end == NONE { (None, None) } else { (Some(start), Some(end)) }
}

/// `source` between two UTF-16 offsets, as the index spans a symbol's text.
fn cut(source: &str, start: u32, end: u32) -> Option<&str> {
    let (mut from, mut to, mut units) = (None, None, 0u32);
    for (byte, character) in source.char_indices().chain(std::iter::once((source.len(), '\0'))) {
        if units == start { from = Some(byte) }
        if units == end { to = Some(byte); break }
        units += character.len_utf16() as u32;
    }
    source.get(from?..to?)
}

/// A doc comment as words: each line without its `///`, `//!` or `*` margin,
/// joined by single spaces and lowercased, so a phrase across a line break
/// still matches.
fn prose(doc: &str) -> String {
    doc.lines()
        .map(|line| {
            let line = line.trim();
            line.strip_prefix("///").or_else(|| line.strip_prefix("//!")).or_else(|| line.strip_prefix('*')).unwrap_or(line).trim()
        })
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// Every top-level declaration on the chain whose name `matching` admits for
/// `query`, or whose doc does when it is `Containing`, in `files` when they are named, less the ones its file exports,
/// under that name or another, which the export list already answers. A name
/// declared twice in one file, as an interface and a const, is one entry: the
/// first.
pub(crate) fn declared(root: &str, layers: &[Layer], query: &str, matching: Matching, files: Option<&[String]>) -> Declared {
    let folded = fold(layers);
    let admits = |name: &str| match matching {
        Matching::Exact => name == query,
        Matching::Containing => name.to_lowercase().contains(query),
    };
    let wanted: Option<std::collections::HashSet<&str>> = files.map(|files| files.iter().map(String::as_str).collect());
    let mut crossings: Vec<Crossing> = folded
        .iter()
        .filter(|(file, _)| wanted.as_ref().is_none_or(|wanted| wanted.contains(*file)))
        .map(|(&file, &at)| Crossing { file, owner: NO_OWNER, others: Vec::new(), at, parse: None })
        .collect();
    crossings.sort_unstable_by(|a, b| crate::order::code_unit(a.file, b.file));
    join_parses(layers, &mut crossings);

    let found: Vec<(Vec<(usize, &str, usize)>, Option<&str>)> = crossings
        .par_iter()
        .map(|crossing| {
            let Some((layer, row)) = crossing.parse else { return (Vec::new(), None) };
            let (text, parses) = (&layers[layer].stored, &layers[layer].parses);
            if parses.harvested[row] != 1 { return (Vec::new(), Some(crossing.file)) }
            let own: Vec<&str> = if parses.exports_present[row] == 1 {
                parses.exports.range(row)
                    .filter(|&export| text.optional(parses.export_from.at(export)).is_none())
                    .filter_map(|export| text.optional(parses.export_local.at(export)))
                    .collect()
            } else {
                Vec::new()
            };
            let mut named: Vec<&str> = Vec::new();
            let mut hits = Vec::new();
            // Read once, and only when a doc is the one thing left to match.
            let mut source: Option<Option<String>> = None;
            for symbol in parses.symbols.range(row) {
                let name = text.text(parses.symbol_name.at(symbol));
                if own.contains(&name) || named.contains(&name) { continue }
                let mut documented = || {
                    let (Some(start), Some(end)) = span(parses.symbol_doc[0], parses.symbol_doc[1], symbol) else { return false };
                    let source = source.get_or_insert_with(|| std::fs::read_to_string(std::path::Path::new(root).join(crossing.file)).ok());
                    source.as_deref().and_then(|source| cut(source, start, end)).is_some_and(|doc| prose(doc).contains(query))
                };
                if !admits(name) && !(matches!(matching, Matching::Containing) && documented()) { continue }
                named.push(name);
                hits.push((layer, crossing.file, symbol));
            }
            (hits, None)
        })
        .collect();

    let mut unread: Vec<String> = found.iter().filter_map(|(_, unread)| unread.map(str::to_owned)).collect();
    unread.sort_unstable_by(|a, b| crate::order::code_unit(a, b));
    let hits: Vec<(usize, &str, usize)> = found.into_iter().flat_map(|(hits, _)| hits).collect();
    if hits.is_empty() { return Declared { names: Vec::new(), unread } }

    // Who owns a file is a question about every manifest above it, so the
    // manifests are read only above the files that matched.
    let paths = beside(root, hits.iter().map(|&(_, at, _)| at));
    let owners = owners(root, &paths);
    let names = hits
        .into_iter()
        .map(|(layer, at, symbol)| {
            let (text, parses) = (&layers[layer].stored, &layers[layer].parses);
            let (signature_start, signature_end) = span(parses.symbol_signature[0], parses.symbol_signature[1], symbol);
            let (doc_start, doc_end) = span(parses.symbol_doc[0], parses.symbol_doc[1], symbol);
            DeclaredName {
                name: text.text(parses.symbol_name.at(symbol)).to_owned(),
                kind: text.text(parses.symbol_kind.at(symbol)).to_owned(),
                at: at.to_owned(),
                by: owners.package_of(at).to_owned(),
                line: parses.symbol_line.at(symbol),
                file_kind: kind_of(at).to_owned(),
                signature_start,
                signature_end,
                doc_start,
                doc_end,
            }
        })
        .collect();
    Declared { names, unread }
}
