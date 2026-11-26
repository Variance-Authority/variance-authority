//! What each file an orientation is asked about declares at its top level.
//!
//! A reader handed a file wants its outline before its text: the names it
//! declares, where, which an export binds, and what a class, an interface or a
//! type alias holds. The scan already recorded all of it with the file's parse
//! — its top-level symbols, its exports and its member declarations — so the
//! outline is read off the layers the orientation already opened for its
//! other two readings, with no file read.
//!
//! An outline is bounded by lines, not names: a file of four hundred exports
//! would otherwise print four hundred lines before the graph the reader asked
//! for. Top-level declarations are shown first, then member lines in line order
//! while lines are left, a line that declares several members spending one;
//! the declarations and the member lines cut are each counted once for the
//! file, so the counts add no line per container. A name the file only binds is
//! no declaration: unless an export binds it, it takes no line and is counted.
//!
//! A file asked about at a line is answered with the declarations the line is
//! in, read off the same parse by the lines each one spans: its top-level
//! symbols, the members of its classes, interfaces and type literals, and the
//! functions written inside its functions. The holders are those whose first
//! and last lines enclose the line, outermost first, as a language server's
//! document symbols nest; none is the module's own top level. Nothing is
//! guessed from where the next declaration starts: a blank line between two
//! functions is in neither.

// compass: variance-authority.reach.relations

use std::collections::HashSet;

use napi_derive::napi;

use crate::chain_lookup::record;
use crate::compact::Layer;
use crate::harvest::is_bound;
use crate::help_declared::exported_locals;
use crate::help_publish::{opened_chain, OpenedIndex};
use crate::help_members::{members_of_row, ContainerMember};
use crate::package_graph::{join_parses, Crossing};
use crate::package_owners::NO_OWNER;

/// One top-level declaration of a file.
#[napi(object)]
pub struct FileDeclaration {
    pub name: String,
    /// The word the reader of its language gave it: `function`, `class`, `const`, …
    pub kind: String,
    pub line: u32,
    /// Whether an export of the file binds the name; absent when the parse
    /// kept no exports to tell by.
    pub exported: Option<bool>,
    /// The members declared on it, by line, as many as the budget left.
    pub members: Vec<ContainerMember>,
}

/// One asked file's top level, or why it cannot be told.
#[napi(object)]
pub struct FileDeclarations {
    pub file: String,
    /// False when the index holds the file and no parse of its declarations:
    /// the file declares something or nothing, and the index does not say which.
    pub read: bool,
    pub declarations: Vec<FileDeclaration>,
    /// The top-level declarations the budget left out.
    pub more: u32,
    /// The member lines the budget left out, those of a declaration it cut
    /// included; a line that declares several members is one.
    pub more_members: u32,
    /// The top-level names the file binds, does not declare and is not known to
    /// export: none is listed and none spends the budget.
    pub bound: u32,
    /// False when the parse kept no exports, or it was not read: whether a name
    /// is exported is unknown, the names counted as bound included.
    pub exports_kept: bool,
}

/// A line asked about in a file: 1-based, as an editor numbers it.
#[napi(object)]
pub struct AskedLine {
    pub file: String,
    pub line: u32,
}

/// A declaration whose first and last lines enclose an asked line.
#[napi(object)]
pub struct LineHolder {
    /// Its name; the names one statement declares on the same lines, such as
    /// `const width = 1, height = 2`, are joined as `width, height`.
    pub name: String,
    /// The word the parse stored for it: a top-level symbol's kind, a nested
    /// function's, or what a member is to its container (`method`, `property`, …).
    pub kind: String,
    pub line: u32,
    /// The line it ends on.
    pub end: u32,
}

/// The declarations one asked line is in, or why they cannot be told.
#[napi(object)]
pub struct LineHeld {
    pub file: String,
    pub line: u32,
    /// False when the index holds the file and no parse of its declarations:
    /// the line may be in anything.
    pub read: bool,
    /// The declarations whose lines enclose the line, outermost first; none when
    /// it is at the module's top level.
    pub holders: Vec<LineHolder>,
}

/// The declarations each of `asked` is in, in the order asked; an ask of a file the chain
/// does not hold is left out, as the list of files asked about already says it
/// is outside the index.
pub(crate) fn lines_held(layers: &[Layer], asked: &[AskedLine]) -> Vec<LineHeld> {
    let (asks, mut crossings): (Vec<&AskedLine>, Vec<Crossing>) = asked
        .iter()
        .filter_map(|ask| record(layers, &ask.file).map(|(file, at)| (ask, Crossing { file, owner: NO_OWNER, others: Vec::new(), at, parse: None })))
        .unzip();
    join_parses(layers, &mut crossings);
    asks.into_iter()
        .zip(&crossings)
        .map(|(ask, crossing)| {
            let parse = crossing.parse.filter(|(layer, row)| layers[*layer].parses.harvested[*row] == 1);
            LineHeld {
                file: crossing.file.to_owned(),
                line: ask.line,
                read: parse.is_some(),
                holders: parse.map_or_else(Vec::new, |(layer, row)| holders(&spans(&layers[layer], row), ask.line)),
            }
        })
        .collect()
}

/// Every declaration one parse row records, as `(kind, name, first, last)`
/// lines: its top-level symbols, then its members, then its nested functions,
/// the order a tie of lines keeps. A last line the parse did not keep is read
/// as the first, so the declaration spans the line it starts on.
fn spans<'a>(layer: &'a Layer, row: usize) -> Vec<(&'a str, &'a str, u32, u32)> {
    let (stored, parses) = (&layer.stored, &layer.parses);
    let span = |kind: u32, name: u32, line: u32, end: u32| (stored.text(kind), stored.text(name), line, end.max(line));
    let symbols = parses.symbols.range(row).map(|at| span(parses.symbol_kind.at(at), parses.symbol_name.at(at), parses.symbol_line.at(at), parses.symbol_end_line.at(at)));
    let members = parses.member_declarations.range(row).map(|at| {
        span(parses.member_declaration_kind.at(at), parses.member_declaration_name.at(at), parses.member_declaration_line.at(at), parses.member_declaration_end_line.at(at))
    });
    let nested = parses.nested.range(row).map(|at| span(parses.nested_kind.at(at), parses.nested_name.at(at), parses.nested_line.at(at), parses.nested_end_line.at(at)));
    symbols.chain(members).chain(nested).collect()
}

/// The declarations among `spans` whose lines enclose `line`, outermost first: an
/// earlier first line, then a later last line. Two of one kind on the same
/// lines are one statement's names, and are one holder.
fn holders(spans: &[(&str, &str, u32, u32)], line: u32) -> Vec<LineHolder> {
    let mut holding: Vec<&(&str, &str, u32, u32)> = spans.iter().filter(|(_, _, first, last)| *first <= line && line <= *last).collect();
    holding.sort_by(|left, right| left.2.cmp(&right.2).then(right.3.cmp(&left.3)));
    let mut chain: Vec<LineHolder> = Vec::new();
    for &(kind, name, first, last) in holding {
        match chain.last_mut() {
            Some(held) if (held.kind.as_str(), held.line, held.end) == (kind, first, last) => {
                held.name.push_str(", ");
                held.name.push_str(name);
            }
            _ => chain.push(LineHolder { name: name.to_owned(), kind: kind.to_owned(), line: first, end: last }),
        }
    }
    chain
}

/// The top level of each of `files` the chain holds, in the order asked, each
/// within `budget` lines; a file the chain does not hold is left out, as the
/// list of files asked about already says it is outside the index.
pub(crate) fn declarations_of(layers: &[Layer], files: &[String], budget: usize) -> Vec<FileDeclarations> {
    let mut crossings: Vec<Crossing> = files
        .iter()
        .filter_map(|file| record(layers, file))
        .map(|(file, at)| Crossing { file, owner: NO_OWNER, others: Vec::new(), at, parse: None })
        .collect();
    join_parses(layers, &mut crossings);
    crossings.iter().map(|crossing| outline(layers, crossing, budget)).collect()
}

/// What each of `files` declares at its top level, read off the chain the
/// question already opened at `index`, each within `budget` lines; `None` when
/// no index was published. No listing of the tree is taken: a file's parse is in
/// the index, so a checkout git cannot list is still answered.
/// bound: one entry per file the caller names
#[napi(catch_unwind)]
pub fn file_declarations_of(index: &OpenedIndex, files: Vec<String>, budget: u32) -> napi::Result<Option<Vec<FileDeclarations>>> {
    opened_chain(index, |layers| declarations_of(layers, &files, budget as usize))
}

fn outline(layers: &[Layer], crossing: &Crossing, budget: usize) -> FileDeclarations {
    let unread = FileDeclarations { file: crossing.file.to_owned(), read: false, declarations: Vec::new(), more: 0, more_members: 0, bound: 0, exports_kept: false };
    let Some((layer, row)) = crossing.parse else { return unread };
    let (stored, parses) = (&layers[layer].stored, &layers[layer].parses);
    if parses.harvested[row] != 1 { return unread }
    let exports_kept = parses.exports_present[row] == 1;
    let exported = exports_kept.then(|| exported_locals(&layers[layer], row));
    let mut declarations: Vec<FileDeclaration> = parses
        .symbols
        .range(row)
        .map(|symbol| {
            let name = stored.text(parses.symbol_name.at(symbol));
            FileDeclaration {
                name: name.to_owned(),
                kind: stored.text(parses.symbol_kind.at(symbol)).to_owned(),
                line: parses.symbol_line.at(symbol),
                exported: exported.as_ref().map(|exported| exported.contains(name)),
                members: Vec::new(),
            }
        })
        .collect();
    declarations.sort_by_key(|declaration| declaration.line);

    // A member goes under the top-level declaration it is written in: top-level
    // declarations do not nest, so that is the last one starting on or before
    // the member's line, and the parser's container must name it. A value and a
    // type may share a name, and an interface may be declared twice; each keeps
    // its own members. One in a container nested elsewhere — a function, a
    // call — is not the file's top level, and is not listed.
    // The holder is looked for among the names only bound too: what is written
    // in a binding's value is not in the declaration above it.
    let places = places(&declarations);
    let mut members: Vec<(usize, ContainerMember)> = members_of_row(&layers[layer], row)
        .into_iter()
        .filter_map(|(of, member)| Some((places[holder(&declarations, of, member.line)?]?, member)))
        .collect();
    let bindings: Vec<FileDeclaration> = declarations.extract_if(.., |declaration| only_bound(declaration)).collect();
    let declared: HashSet<&str> = declarations.iter().map(|declaration| declaration.name.as_str()).collect();
    // Names, not rows: a file may bind one name twice.
    let bound: HashSet<&str> = bindings.iter().map(|binding| binding.name.as_str()).filter(|name| !declared.contains(name)).collect();
    let bound = bound.len() as u32;
    let more = declarations.len().saturating_sub(budget) as u32;
    declarations.truncate(budget);
    // The budget is spent by the line shown, as `symbol`'s rule shows one row
    // for a line that declares several members: a member on a line its
    // declaration already shows costs nothing, and a line cut is counted once.
    members.sort_by_key(|(on, member)| (*on, member.line));
    let mut left = budget - declarations.len();
    let (mut more_members, mut last) = (0, None);
    for (on, member) in members {
        let fresh = last != Some((on, member.line));
        last = Some((on, member.line));
        match declarations.get_mut(on) {
            Some(declaration) if !fresh && declaration.members.last().is_some_and(|shown| shown.line == member.line) => {
                declaration.members.push(member);
            }
            Some(declaration) if fresh && left > 0 => {
                left -= 1;
                declaration.members.push(member);
            }
            _ if fresh => more_members += 1,
            _ => {}
        }
    }
    FileDeclarations { file: crossing.file.to_owned(), read: true, declarations, more, more_members, bound, exports_kept }
}

/// Whether the row only binds its name, and no export of the file is known to bind it.
fn only_bound(declaration: &FileDeclaration) -> bool {
    is_bound(&declaration.kind) && declaration.exported != Some(true)
}

/// Where each of `declarations` stands once the names only bound are left out.
fn places(declarations: &[FileDeclaration]) -> Vec<Option<usize>> {
    let mut listed = 0..;
    declarations.iter().map(|declaration| if only_bound(declaration) { None } else { listed.next() }).collect()
}

/// The declaration among `declarations`, by line, that a member of the
/// container named `of` on `line` is written in: the last one starting on or
/// before `line`, among those that start on the same line the last named `of`.
fn holder(declarations: &[FileDeclaration], of: &str, line: u32) -> Option<usize> {
    let after = declarations.partition_point(|declaration| declaration.line <= line);
    let starts = declarations[..after].last()?.line;
    (0..after).rev().take_while(|at| declarations[*at].line == starts).find(|at| declarations[*at].name == of)
}

#[cfg(test)]
#[path = "orient_declarations_tests.rs"]
mod tests;
