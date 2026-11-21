//! What each file an orientation is asked about declares at its top level.
//!
//! A reader handed a file wants its outline before its text: the names it
//! declares, where, which an export binds, and what a class, an interface or a
//! type alias holds. The scan already recorded all of it with the file's parse
//! — its top-level symbols, its exports and its member declarations — so the
//! outline is read off the chain the orientation already opened, with no file
//! read and no second index open.
//!
//! An outline is bounded by lines, not names: a file of four hundred exports
//! would otherwise print four hundred lines before the graph the reader asked
//! for. Top-level declarations are shown first, then members in line order
//! while lines are left, and each cut is counted where it was made.

// compass: variance-authority.reach.relations

use std::collections::HashMap;

use napi_derive::napi;

use crate::chain_lookup::fold;
use crate::compact::Layer;
use crate::help_declared::exported_locals;
use crate::help_members::ContainerMember;
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
    /// The members on it the budget left out.
    pub more_members: u32,
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
}

/// The top level of each of `files` the chain holds, in the order asked, each
/// within `budget` lines; a file the chain does not hold is left out, as the
/// list of files asked about already says it is outside the index.
pub(crate) fn declarations_of(layers: &[Layer], files: &[String], budget: usize) -> Vec<FileDeclarations> {
    let folded = fold(layers);
    let mut crossings: Vec<Crossing> = files
        .iter()
        .filter_map(|file| folded.get_key_value(file.as_str()))
        .map(|(&file, &at)| Crossing { file, owner: NO_OWNER, others: Vec::new(), at, parse: None })
        .collect();
    join_parses(layers, &mut crossings);
    crossings.iter().map(|crossing| outline(layers, crossing, budget)).collect()
}

fn outline(layers: &[Layer], crossing: &Crossing, budget: usize) -> FileDeclarations {
    let unread = FileDeclarations { file: crossing.file.to_owned(), read: false, declarations: Vec::new(), more: 0 };
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
                more_members: 0,
            }
        })
        .collect();
    declarations.sort_by_key(|declaration| declaration.line);
    let more = declarations.len().saturating_sub(budget) as u32;
    declarations.truncate(budget);

    // A member goes under the first declaration of its container's name; a
    // member on the line its container is declared on is already shown there.
    let mut holder: HashMap<&str, usize> = HashMap::new();
    for (at, declaration) in declarations.iter().enumerate() {
        holder.entry(declaration.name.as_str()).or_insert(at);
    }
    let mut members: Vec<(usize, ContainerMember)> = parses
        .member_declarations
        .range(row)
        .filter_map(|member| {
            let on = holder.get(stored.text(parses.member_declaration_on.at(member)))?;
            let line = parses.member_declaration_line.at(member);
            (line != declarations[*on].line).then(|| (*on, ContainerMember {
                name: stored.text(parses.member_declaration_name.at(member)).to_owned(),
                line,
                text: stored.kept(parses.member_declaration_line_text.at(member)).map(str::to_owned),
            }))
        })
        .collect();
    members.sort_by_key(|(on, member)| (declarations[*on].line, member.line));
    let mut left = budget - declarations.len();
    for (on, member) in members {
        let declaration = &mut declarations[on];
        if left == 0 {
            declaration.more_members += 1;
        } else {
            left -= 1;
            declaration.members.push(member);
        }
    }
    FileDeclarations { file: crossing.file.to_owned(), read: true, declarations, more }
}

#[cfg(test)]
#[path = "orient_declarations_tests.rs"]
mod tests;
