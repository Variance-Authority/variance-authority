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
//! file, so the counts add no line per container.

// compass: variance-authority.reach.relations

use napi_derive::napi;

use crate::chain_lookup::record;
use crate::compact::Layer;
use crate::help_declared::exported_locals;
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

/// What each of `files` declares at its top level, read off the source index
/// at `index` alone, each within `budget` lines; `None` when no index was
/// published. No listing of the tree is taken: a file's parse is in the index,
/// so a checkout git cannot list is still answered.
/// bound: one entry per file the caller names
#[napi(catch_unwind)]
pub fn file_declarations(index: String, files: Vec<String>, budget: u32) -> napi::Result<Option<Vec<FileDeclarations>>> {
    let fail = |error: String| napi::Error::from_reason(format!("the source index at {index} did not read: {error}"));
    let Some(chain) = crate::index_chain::read_chain(&index).map_err(fail)? else { return Ok(None) };
    let layers = chain
        .segments
        .iter()
        .enumerate()
        .map(|(at, bytes)| Layer::open(bytes).map_err(|error| format!("segment {at}: {error}")))
        .collect::<Result<Vec<_>, _>>()
        .map_err(fail)?;
    Ok(Some(declarations_of(&layers, &files, budget as usize)))
}

fn outline(layers: &[Layer], crossing: &Crossing, budget: usize) -> FileDeclarations {
    let unread = FileDeclarations { file: crossing.file.to_owned(), read: false, declarations: Vec::new(), more: 0, more_members: 0 };
    let Some((layer, row)) = crossing.parse else { return unread };
    let (stored, parses) = (&layers[layer].stored, &layers[layer].parses);
    if parses.harvested[row] != 1 { return unread }
    let exported = (parses.exports_present[row] == 1).then(|| exported_locals(&layers[layer], row));
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
    let mut members: Vec<(usize, ContainerMember)> = members_of_row(&layers[layer], row)
        .into_iter()
        .filter_map(|(of, member)| Some((holder(&declarations, of, member.line)?, member)))
        .collect();
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
    FileDeclarations { file: crossing.file.to_owned(), read: true, declarations, more, more_members }
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
