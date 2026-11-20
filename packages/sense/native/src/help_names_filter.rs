//! The files whose names answer `discover`'s name sets, found in one pass over
//! the folded chain.
//!
//! `discover --imports react` and `--declares '^use'` each want a few files out
//! of every file the index holds. The names are already in the parse columns,
//! as string ids beside each request, binding, member, symbol and export, so
//! each file is read where it lies — on every core, compared in place — and
//! only a file that matches is turned into a row. No file's names are built
//! for JavaScript to filter, which on a large checkout was the question's
//! whole cost.
//!
//! What a file declares and what it imports is read as `namesOf` read it from
//! a parse: a declaration is the file's own symbols and the names it exports
//! without a `from`, never an export of a name it imports, and a default with a
//! name of its own is declared under that name; an import is each binding by
//! the name its module publishes, each member read off a namespace, and a
//! request that names nothing.

// compass: variance-authority.report.agent-surface

use std::collections::HashSet;

use napi_derive::napi;
use rayon::prelude::*;
use regex::{Regex, RegexBuilder};

use crate::chain_lookup::fold;
use crate::compact::Layer;
use crate::package_graph::Crossing;

/// `import * as x`: the module is taken whole, and its names arrive as members.
const NAMESPACE: &str = "*";
/// The name a default export is published under.
const DEFAULT: &str = "default";

/// One `imports` set: a specifier as written, a package, or the file a request
/// resolved to, and the name imported from it when one is asked.
#[napi(object)]
pub struct ImportAsked {
    pub spec: String,
    pub name: Option<String>,
}

/// One line that puts a file in a set. An import says what it imports and
/// from where; a declaration says only its name.
#[napi(object)]
pub struct NameHit {
    pub file: String,
    pub line: u32,
    pub name: Option<String>,
    /// The specifier as written; absent on a declaration.
    pub from: Option<String>,
    /// The local name, when it differs from `name`.
    pub local: Option<String>,
    /// The namespace a member was read through.
    pub through: Option<String>,
}

/// One `declares` set, or why its pattern is no regular expression.
#[napi(object)]
pub struct DeclaresFound {
    pub hits: Vec<NameHit>,
    pub refused: Option<String>,
}

/// Each asked set's lines, in the order they were asked, and the files whose
/// names the index does not hold: a file that is unknown, never one that
/// declares and imports nothing.
#[napi(object)]
pub struct NamesFound {
    pub imports: Vec<Vec<NameHit>>,
    pub declares: Vec<DeclaresFound>,
    pub unread: Vec<String>,
}

/// One file's share of the answer, kept only when it holds something.
#[derive(Default)]
struct FileFound {
    imports: Vec<(usize, NameHit)>,
    declares: Vec<(usize, NameHit)>,
    unread: Option<String>,
}

/// The lines of every file the chain holds that answer `imports` and
/// `declares`, each set by itself; a file with an extension in `readable`
/// whose parse or targets the chain does not hold is unread.
pub(crate) fn names_filter(layers: &[Layer], imports: &[ImportAsked], declares: &[String], readable: &[String]) -> NamesFound {
    let compiled: Vec<Result<Regex, String>> = declares
        .iter()
        .map(|pattern| RegexBuilder::new(pattern).case_insensitive(true).build().map_err(|error| error.to_string()))
        .collect();
    let patterns: Vec<(usize, &Regex)> = compiled.iter().enumerate().filter_map(|(at, one)| one.as_ref().ok().map(|regex| (at, regex))).collect();
    let readable: HashSet<&str> = readable.iter().map(String::as_str).collect();
    let folded = fold(layers);
    let crossings = crate::help_declared::crossings(layers, &folded, None);
    let found: Vec<FileFound> = crossings
        .par_iter()
        .filter_map(|crossing| {
            let one = file_found(layers, crossing, imports, &patterns, &readable);
            (one.unread.is_some() || !one.imports.is_empty() || !one.declares.is_empty()).then_some(one)
        })
        .collect();
    let mut answer = NamesFound {
        imports: imports.iter().map(|_| Vec::new()).collect(),
        declares: compiled.iter().map(|one| DeclaresFound { hits: Vec::new(), refused: one.as_ref().err().cloned() }).collect(),
        unread: Vec::new(),
    };
    for one in found {
        for (at, hit) in one.imports {
            answer.imports[at].push(hit);
        }
        for (at, hit) in one.declares {
            answer.declares[at].hits.push(hit);
        }
        // Pushed in the crossings' order, so the list stays sorted.
        answer.unread.extend(one.unread);
    }
    answer
}

/// One file read against every set: its names off the parse it carries, or
/// unread when the chain holds no harvested parse whose requests line up with
/// the targets its record resolved.
fn file_found(layers: &[Layer], crossing: &Crossing, imports: &[ImportAsked], patterns: &[(usize, &Regex)], readable: &HashSet<&str>) -> FileFound {
    let mut found = FileFound::default();
    let unread = |file: &str| FileFound { unread: readable.contains(extension(file)).then(|| file.to_owned()), ..FileFound::default() };
    let Some((layer, row)) = crossing.parse else { return unread(crossing.file) };
    let (stored, records) = (&layers[crossing.at.0].stored, &layers[crossing.at.0].records);
    let (text, parses) = (&layers[layer].stored, &layers[layer].parses);
    if parses.harvested[row] != 1 || records.targets_present[crossing.at.1] != 1 {
        return unread(crossing.file);
    }
    let file = crossing.file;
    let hit = |line: u32, name: Option<&str>| NameHit { file: file.to_owned(), line, name: name.map(str::to_owned), from: None, local: None, through: None };

    if !imports.is_empty() {
        let first = parses.requests.at(row) as usize;
        for request in parses.requests.range(row) {
            let from = text.text(parses.request_value.at(request));
            // Read only when a bare comparison of the specifier misses, so a file matching nothing allocates nothing.
            let to = || records.targets.range(crossing.at.1).nth(request - first).and_then(|target| stored.optional(records.target_path.at(target)));
            let asked: Vec<(usize, &ImportAsked)> = imports.iter().enumerate().filter(|(_, asked)| module_is(&asked.spec, from, to)).collect();
            if asked.is_empty() {
                continue;
            }
            // Every name the request brings in, as `namesOf` lists them.
            let mut entries: Vec<(u32, Option<&str>, Option<&str>, Option<&str>)> = Vec::new();
            let mut through = None;
            for binding in parses.request_bindings.range(request) {
                let imported = text.text(parses.binding_imported.at(binding));
                let local = text.text(parses.binding_local.at(binding));
                if imported == NAMESPACE {
                    through = through.or(Some(local));
                    continue;
                }
                entries.push((parses.binding_line.at(binding), Some(imported), (local != imported).then_some(local), None));
            }
            for member in parses.members.range(row) {
                if parses.member_request.at(member) as usize == request - first {
                    entries.push((parses.member_line.at(member), Some(text.text(parses.member_name.at(member))), None, through));
                }
            }
            if entries.is_empty() {
                entries.push((parses.request_line.at(request), None, None, None));
            }
            for (at, asked) in asked {
                for &(line, name, local, through) in &entries {
                    if asked.name.as_deref().is_some_and(|wanted| name != Some(wanted)) {
                        continue;
                    }
                    let mut one = hit(line, name);
                    one.from = Some(from.to_owned());
                    one.local = local.map(str::to_owned);
                    one.through = through.map(str::to_owned);
                    found.imports.push((at, one));
                }
            }
        }
    }

    if !patterns.is_empty() {
        for (name, line) in declared(layers, layer, row) {
            for &(at, regex) in patterns {
                if regex.is_match(name) {
                    found.declares.push((at, hit(line, Some(name))));
                }
            }
        }
    }
    found
}

/// `react/jsx-runtime` is `react`; `./store/selectors` is not `./store`; a
/// request is also the file it resolved to.
fn module_is<'a>(spec: &str, from: &str, to: impl Fn() -> Option<&'a str>) -> bool {
    let bare = !spec.starts_with('.') && !spec.starts_with('/');
    from == spec || (bare && from.len() > spec.len() && from.starts_with(spec) && from.as_bytes()[spec.len()] == b'/') || to() == Some(spec)
}

/// What one parse declares, each name once: its symbols, then the names it
/// exports without a `from`. An export of a name it imports is the declaration
/// of the file it comes from, and a default with a name of its own is
/// declared under that name, never as `default`.
fn declared<'a>(layers: &'a [Layer], layer: usize, row: usize) -> Vec<(&'a str, u32)> {
    let (text, parses) = (&layers[layer].stored, &layers[layer].parses);
    let exports: Vec<usize> = if parses.exports_present[row] == 1 { parses.exports.range(row).collect() } else { Vec::new() };
    let named = exports.iter().any(|&export| {
        text.optional(parses.export_exported.at(export)) == Some(DEFAULT)
            && text.optional(parses.export_local.at(export)).is_some_and(|local| local != DEFAULT)
    });
    let mut seen: HashSet<&str> = HashSet::new();
    let mut names = Vec::new();
    for symbol in parses.symbols.range(row) {
        let name = text.text(parses.symbol_name.at(symbol));
        if !(named && name == DEFAULT) && seen.insert(name) {
            names.push((name, parses.symbol_line.at(symbol)));
        }
    }
    if exports.is_empty() {
        return names;
    }
    let bound: HashSet<&str> = parses
        .requests
        .range(row)
        .flat_map(|request| parses.request_bindings.range(request))
        .map(|binding| text.text(parses.binding_local.at(binding)))
        .collect();
    for export in exports {
        let Some(exported) = text.optional(parses.export_exported.at(export)) else { continue };
        if text.optional(parses.export_from.at(export)).is_some() {
            continue;
        }
        let local = text.optional(parses.export_local.at(export));
        if local.is_some_and(|local| bound.contains(local) || (named && exported == DEFAULT)) {
            continue;
        }
        if seen.insert(exported) {
            names.push((exported, parses.export_line.at(export)));
        }
    }
    names
}

/// `.ts` of `src/a.ts`; empty for a file with none, as `extname` says.
fn extension(file: &str) -> &str {
    let base = file.rsplit('/').next().unwrap_or(file);
    match base.rfind('.') {
        Some(0) | None => "",
        Some(at) => &base[at..],
    }
}

#[cfg(test)]
#[path = "help_names_filter_tests.rs"]
mod tests;
