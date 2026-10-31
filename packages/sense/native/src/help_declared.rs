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
//!
//! A name asked for exactly is also answered by a function another function's
//! body declares, from the index's own nested table, with the function that
//! holds it. Only the exact question reads that table: a closure is its
//! holder's working name, documented for its holder, and a description or a
//! piece of a name is asked of what a caller can reach.

// compass: variance-authority.report.agent-surface

use std::collections::BTreeSet;

use napi_derive::napi;
use rayon::prelude::*;

use crate::dependency_lexicon::purposes::{code_stems, near, phrase_run, writes_run};

use crate::compact::Layer;
use crate::help_usage::kind_of;
use crate::orient_map_read::beside;
use crate::package_graph::{fold, join_parses, At, Crossing};
use crate::package_owners::{owners, NO_OWNER};
use crate::segment::NONE;

/// One declaration no export of its file binds, at its top level or inside a function.
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
    /// Who can name it, as the reader of its language recorded: `file`,
    /// `module`, `underscore` or `all`; absent when the reader cannot tell.
    pub reach: Option<String>,
    /// Asked by [`Matching::Described`]: the positions, ascending, of the
    /// asked stems its name or its doc holds; absent for any other question.
    pub held: Option<Vec<u32>>,
    /// Asked by [`Matching::Described`]: the positions, ascending, of those its name holds.
    pub named: Option<Vec<u32>>,
    /// Asked by [`Matching::Described`]: how many of the question's adjacent
    /// word pairs its doc writes as a phrase, as [`near`] counts them.
    pub near: Option<u32>,
    /// Asked by [`Matching::Described`]: the bytes of the doc the words were
    /// held against, its lines joined by single spaces; absent when it writes none.
    pub doc_length: Option<u32>,
    /// The name of the function whose body declares it, when that function
    /// has one; absent for a top-level declaration and for one inside a
    /// function nothing names.
    pub holder: Option<String>,
    /// The line the function whose body declares it starts on; present only
    /// for a declaration inside a function, which is how that one is told apart.
    pub holder_line: Option<u32>,
}

/// A file a description reached by its own name and its module doc: the
/// file's words, which none of its declarations hold for it.
#[napi(object)]
pub struct DescribedFile {
    pub at: String,
    /// The package whose source it is; empty at the repository root.
    pub by: String,
    /// The module doc's span, inside its marks, when it writes one.
    pub doc_start: Option<u32>,
    pub doc_end: Option<u32>,
    /// The positions, ascending, of the asked stems its name or its module doc holds.
    pub held: Vec<u32>,
    /// The positions, ascending, of those its name holds.
    pub named: Vec<u32>,
    /// How many of the question's adjacent word pairs its module doc writes as a phrase.
    pub near: u32,
    /// The bytes of the module doc the words were held against, its lines
    /// joined by single spaces; absent when it writes none.
    pub doc_length: Option<u32>,
}

/// What `declared` found, and the files whose declarations it could not read.
#[napi(object)]
pub struct Declared {
    /// Ordered by file in code units, then by line.
    pub names: Vec<DeclaredName>,
    /// Files on the chain whose declarations were not read — no parse, or one
    /// its reader did not harvest: unknown, not empty. Code-unit order.
    pub unread: Vec<String>,
    /// Asked by [`Matching::Described`]: the files whose name and module doc
    /// hold any of the question, by file in code units; empty otherwise.
    pub files: Vec<DescribedFile>,
}

/// How a name is matched against `query`.
pub(crate) enum Matching {
    /// The name is `query`, or ends in it after `::`: an item inside a Rust
    /// inline module is declared on its module path, `tests::fixture`, and is
    /// asked for by its own name as often as by the path. Only Rust names
    /// hold `::`, so no other language's match changes.
    Exact,
    /// The name, lowercased, contains `query`, which the caller lowercased, or
    /// the doc comment above it does, read as prose, or writes it as a phrase
    /// by [`crate::dependency_lexicon::purposes::writes_run`]'s rule.
    Containing,
    /// The words of the name and of its doc, cut into stems as the dependency
    /// lexicon cuts a package's words, hold any of `stems` — the question's —
    /// in any order and with any words between them.
    /// `query` is the question as written, which [`near`] reads for its phrase.
    Described { stems: Vec<String>, query: String },
    /// The name's search terms, cut as the search index cuts an exported
    /// name, hold one of every group: the terms the loose pass let each word of
    /// the question stand for.
    Terms { groups: Vec<Vec<String>> },
}

/// Which of `asked` the words of `text` hold, as positions into it.
fn held_in(asked: &[String], text: &str) -> BTreeSet<u32> {
    let words = code_stems(text);
    (0..asked.len() as u32).filter(|&at| words.contains(&asked[at as usize])).collect()
}

/// The words a file's name is written in: its last segment without its last extension.
fn file_name(file: &str) -> &str {
    let name = file.rsplit('/').next().unwrap_or(file);
    name.rsplit_once('.').map_or(name, |(stem, _)| stem)
}

/// The file as UTF-16, read once, and only when a doc is the one thing left to match.
fn source_of<'s>(source: &'s mut Option<Option<Vec<u16>>>, root: &str, file: &str) -> Option<&'s [u16]> {
    source
        .get_or_insert_with(|| std::fs::read_to_string(std::path::Path::new(root).join(file)).ok().map(|text| text.encode_utf16().collect()))
        .as_deref()
}

pub(crate) fn span(starts: crate::stored::U32s, ends: crate::stored::U32s, at: usize) -> (Option<u32>, Option<u32>) {
    let (start, end) = (starts.at(at), ends.at(at));
    if start == NONE || end == NONE { (None, None) } else { (Some(start), Some(end)) }
}

/// A doc comment as written, which [`near`] and [`writes_run`] read by paragraph,
/// and as words, its lines joined by single spaces and lowercased, so text
/// typed across a line break still matches.
struct Prose { written: String, words: String }

fn prose(source: &[u16], start: u32, end: u32) -> Option<Prose> {
    let written = crate::dependency_namespace::doc(source, Some(crate::harvest::TextSpan { start, end }))?;
    let words = written.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase();
    Some(Prose { written, words })
}

/// One file's matches, and the file
/// itself when its declarations were not read.
type FileHits<'a> = (Vec<Hit<'a>>, Option<&'a str>, Option<FileHit<'a>>);

/// Asked by [`Matching::Described`]: the positions of the stems held, those
/// of them the name holds, how near its doc writes the question, and the
/// bytes of that doc.
type Held = (Vec<u32>, Vec<u32>, u32, Option<u32>);

/// A row of a parse's top-level symbols, or of its nested table.
#[derive(Clone, Copy)]
enum Row {
    Symbol(usize),
    Nested(usize),
}

/// A layer, a file, a row and how it was held, when it was described.
type Hit<'a> = (usize, &'a str, Row, Option<Held>);

/// A file described by its name and module doc: its layer, its parse row, and how it was held.
type FileHit<'a> = (usize, &'a str, usize, Held);

/// The files of the chain, in `files` when they are named, by file in code units, each joined to its parse.
fn crossings<'a>(layers: &[Layer], folded: &'a std::collections::HashMap<&'a str, At>, files: Option<&[String]>) -> Vec<Crossing<'a>> {
    let wanted: Option<std::collections::HashSet<&str>> = files.map(|files| files.iter().map(String::as_str).collect());
    let mut crossings: Vec<Crossing> = folded
        .iter()
        .filter(|(file, _)| wanted.as_ref().is_none_or(|wanted| wanted.contains(*file)))
        .map(|(&file, &at)| Crossing { file, owner: NO_OWNER, others: Vec::new(), at, parse: None })
        .collect();
    crossings.sort_unstable_by(|a, b| crate::order::code_unit(a.file, b.file));
    join_parses(layers, &mut crossings);
    crossings
}

/// The distinct search terms of every top-level name the chain harvested, in
/// `files` when they are named, sorted by their UTF-8 bytes as the search
/// file's dictionary is: what the loose pass looks a word up in for the names
/// no export list holds. A name its file exports is cut too, and
/// [`Matching::Terms`] passes it over as [`declared`] passes over any.
pub(crate) fn declared_terms(layers: &[Layer], files: Option<&[String]>) -> Vec<String> {
    let folded = fold(layers);
    let terms: BTreeSet<String> = crossings(layers, &folded, files)
        .par_iter()
        .filter_map(|crossing| crossing.parse)
        .filter(|&(layer, row)| layers[layer].parses.harvested[row] == 1)
        .flat_map_iter(|(layer, row)| {
            let (text, parses) = (&layers[layer].stored, &layers[layer].parses);
            parses.symbols.range(row).flat_map(|symbol| crate::help_search::name_terms(text.text(parses.symbol_name.at(symbol)))).collect::<Vec<_>>()
        })
        .collect::<std::collections::HashSet<String>>()
        .into_iter()
        .collect();
    terms.into_iter().collect()
}

/// Every top-level declaration on the chain, every one in a Rust inline
/// module, and, asked `Exact`, every function a function's body declares under
/// that name, whose name `matching` admits for `query`, or whose doc does when it
/// is `Containing` or `Described`, in `files` when they are named, less the
/// ones its file exports, under that name or another, which the export list
/// already answers. A name
/// declared twice in one file, as an interface and a const, is one entry: the
/// first.
pub(crate) fn declared(root: &str, layers: &[Layer], query: &str, matching: Matching, files: Option<&[String]>) -> Declared {
    let folded = fold(layers);
    let crossings = crossings(layers, &folded, files);
    // Cut once for every doc; a question of one stem is no phrase, and no doc is cut for it.
    let run = matches!(matching, Matching::Containing).then(|| phrase_run(query)).flatten();
    let found: Vec<FileHits> = crossings
        .par_iter()
        .map(|crossing| {
            // A file with no parse was declined, by its size or its bytes, or
            // could not be opened: what it declares is as unknown as in a parse
            // its reader did not harvest.
            let Some((layer, row)) = crossing.parse else { return (Vec::new(), Some(crossing.file), None) };
            let (text, parses) = (&layers[layer].stored, &layers[layer].parses);
            let mut source: Option<Option<Vec<u16>>> = None;
            let file = match &matching {
                Matching::Described { stems, query } => {
                    let in_name = held_in(stems, file_name(crossing.file));
                    let doc = parses.doc_of_module(row)
                        .and_then(|span| source_of(&mut source, root, crossing.file).and_then(|source| prose(source, span.start, span.end)));
                    let mut held = in_name.clone();
                    if let Some(doc) = &doc { held.extend(held_in(stems, &doc.words)) }
                    (!held.is_empty()).then(|| {
                        let near = doc.as_ref().map_or(0, |doc| near(query, &doc.written));
                        (layer, crossing.file, row, (held.into_iter().collect(), in_name.into_iter().collect(), near, doc.as_ref().map(|doc| doc.words.len() as u32)))
                    })
                }
                _ => None,
            };
            if parses.harvested[row] != 1 { return (Vec::new(), Some(crossing.file), file) }
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
            for symbol in parses.symbols.range(row) {
                let name = text.text(parses.symbol_name.at(symbol));
                if own.contains(&name) || named.contains(&name) { continue }
                let mut doc = || {
                    let (Some(start), Some(end)) = span(parses.symbol_doc[0], parses.symbol_doc[1], symbol) else { return None };
                    source_of(&mut source, root, crossing.file).and_then(|source| prose(source, start, end))
                };
                let described = match &matching {
                    Matching::Exact if name == query || name.strip_suffix(query).is_some_and(|head| head.ends_with("::")) => None,
                    Matching::Containing if name.to_lowercase().contains(query)
                        || doc().is_some_and(|doc| doc.words.contains(query) || run.as_ref().is_some_and(|run| writes_run(run, &doc.written).is_some())) => None,
                    Matching::Terms { groups } => {
                        let terms = crate::help_search::name_terms(name);
                        if !groups.iter().all(|group| group.iter().any(|term| terms.contains(term))) { continue }
                        None
                    }
                    Matching::Described { stems, query } => {
                        let in_name = held_in(stems, name);
                        let doc = doc();
                        let mut held = in_name.clone();
                        if let Some(doc) = &doc { held.extend(held_in(stems, &doc.words)) }
                        if held.is_empty() { continue }
                        let near = doc.as_ref().map_or(0, |doc| near(query, &doc.written));
                        Some((held.into_iter().collect(), in_name.into_iter().collect(), near, doc.as_ref().map(|doc| doc.words.len() as u32)))
                    }
                    _ => continue,
                };
                named.push(name);
                hits.push((layer, crossing.file, Row::Symbol(symbol), described));
            }
            if matches!(matching, Matching::Exact) {
                // Each is its own declaration, under its own holder: none stands for another.
                hits.extend(parses.nested.range(row).filter(|&at| text.text(parses.nested_name.at(at)) == query).map(|at| (layer, crossing.file, Row::Nested(at), None)));
            }
            (hits, None, file)
        })
        .collect();

    let mut unread: Vec<String> = found.iter().filter_map(|(_, unread, _)| unread.map(str::to_owned)).collect();
    unread.sort_unstable_by(|a, b| crate::order::code_unit(a, b));
    let (mut hits, mut files): (Vec<Hit>, Vec<FileHit>) = (Vec::new(), Vec::new());
    for (found, _, file) in found {
        hits.extend(found);
        files.extend(file);
    }
    if hits.is_empty() && files.is_empty() { return Declared { names: Vec::new(), unread, files: Vec::new() } }

    // Who owns a file is a question about every manifest above it, so the
    // manifests are read only above the files that matched.
    let paths = beside(root, hits.iter().map(|&(_, at, _, _)| at).chain(files.iter().map(|&(_, at, _, _)| at)));
    let owners = owners(root, &paths);
    let files = files
        .into_iter()
        .map(|(layer, at, row, (held, named, near, doc_length))| {
            let doc = layers[layer].parses.doc_of_module(row);
            DescribedFile {
                at: at.to_owned(),
                by: owners.package_of(at).to_owned(),
                doc_start: doc.map(|doc| doc.start),
                doc_end: doc.map(|doc| doc.end),
                held,
                named,
                near,
                doc_length,
            }
        })
        .collect();
    let names = hits
        .into_iter()
        .map(|(layer, at, row, described)| {
            let (text, parses) = (&layers[layer].stored, &layers[layer].parses);
            let symbol = match row {
                Row::Symbol(symbol) => symbol,
                Row::Nested(nested) => return nested_name(layers, layer, at, nested, owners.package_of(at)),
            };
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
                reach: crate::harvest::reach_of(parses.symbol_reach[symbol]).map(str::to_owned),
                near: described.as_ref().map(|(_, _, near, _)| *near),
                doc_length: described.as_ref().and_then(|(_, _, _, doc_length)| *doc_length),
                named: described.as_ref().map(|(_, named, _, _)| named.clone()),
                held: described.map(|(held, _, _, _)| held),
                holder: None,
                holder_line: None,
            }
        })
        .collect();
    Declared { names, unread, files }
}

/// One row of a parse's nested table, as a declared name with its holder.
fn nested_name(layers: &[Layer], layer: usize, at: &str, nested: usize, by: &str) -> DeclaredName {
    let (text, parses) = (&layers[layer].stored, &layers[layer].parses);
    let (signature_start, signature_end) = span(parses.nested_signature[0], parses.nested_signature[1], nested);
    let (doc_start, doc_end) = span(parses.nested_doc[0], parses.nested_doc[1], nested);
    DeclaredName {
        name: text.text(parses.nested_name.at(nested)).to_owned(),
        kind: text.text(parses.nested_kind.at(nested)).to_owned(),
        at: at.to_owned(),
        by: by.to_owned(),
        line: parses.nested_line.at(nested),
        file_kind: kind_of(at).to_owned(),
        signature_start,
        signature_end,
        doc_start,
        doc_end,
        reach: None,
        held: None,
        named: None,
        near: None,
        doc_length: None,
        holder: text.optional(parses.nested_holder.at(nested)).map(str::to_owned),
        holder_line: Some(parses.nested_holder_line.at(nested)),
    }
}
