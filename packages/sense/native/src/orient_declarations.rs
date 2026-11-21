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
//! for. Top-level declarations are shown first, then members in line order
//! while lines are left; the declarations and the members cut are each counted
//! once for the file, so the counts add no line per container.

// compass: variance-authority.reach.relations

use std::collections::HashMap;

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
    /// The members the budget left out, those of a declaration it cut included.
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

    // A member goes under the first declaration of its container's name, as
    // `symbol` lists a container's members; one whose container the budget
    // cuts is counted with the members cut.
    let mut holder: HashMap<&str, usize> = HashMap::new();
    for (at, declaration) in declarations.iter().enumerate() {
        holder.entry(declaration.name.as_str()).or_insert(at);
    }
    let mut members: Vec<(usize, ContainerMember)> = members_of_row(&layers[layer], row)
        .into_iter()
        .filter_map(|(of, member)| Some((*holder.get(of)?, member)))
        .collect();
    drop(holder);
    let more = declarations.len().saturating_sub(budget) as u32;
    declarations.truncate(budget);
    members.sort_by_key(|(on, member)| (declarations.get(*on).map(|on| on.line), member.line));
    let mut left = budget - declarations.len();
    let mut more_members = 0;
    for (on, member) in members {
        match declarations.get_mut(on) {
            Some(declaration) if left > 0 => {
                left -= 1;
                declaration.members.push(member);
            }
            _ => more_members += 1,
        }
    }
    FileDeclarations { file: crossing.file.to_owned(), read: true, declarations, more, more_members }
}

#[cfg(test)]
#[path = "orient_declarations_tests.rs"]
mod tests;
