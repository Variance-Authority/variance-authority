//! A name files export and no entry publishes, as `symbol` answers it: each
//! export that declares it, what it is, and how many places import it.

// compass: variance-authority.report.agent-surface

use crate::help_surface::Surface;
use std::collections::HashSet;

use crate::compact::Layer;
use crate::help_origin::{declaration_exported, export_line};
use crate::help_symbol_published::{member_rows, renamed_line};
use crate::help_key::{Keys, SLOT};
use crate::help_symbol_rows::Export;
use crate::help_unpublished::{Unpublished, UNCOUNTED};
use crate::help_usage::{importers, Asked, Group};
use crate::text_cut::blank;

const UNFOLLOWED: &str = "this reading could not follow to a source file, such as a build output the checkout does not hold";

/// One block per export that declares the name, each with the imports the
/// source index resolved to it; a file that passes another one's export on is
/// left out, unless every one does. `None` where the walk to a declaration
/// ends at a default.
pub(crate) fn exported_only(keys: &Keys<'_>, layers: &[Layer], name: &str, exported: &[(&Unpublished<'_>, &Group)], surface: Surface<'_>) -> Option<String> {
    let rows = keys.rows();
    let declaring = declaring(exported);
    let unfollowed = rows.unfollowed()?;
    let blocks = declaring.into_iter().map(|&(held, group)| {
        let Opening { at, on, line, mut lines, .. } = exported_rows(keys, layers, &unfollowed, name, &held.export, held.line, held.type_only)?;
        let count = group.uses.len();
        lines.push(if count == 0 {
            format!("Nothing in this workspace imports it; {UNCOUNTED}.")
        } else {
            format!("Imported in {count} {}; `{}` lists them, nearest to a file you name first.", if count == 1 { "place" } else { "places" }, surface.tool("uses"))
        });
        lines.extend(renamed_line(name, group.uses.iter().map(|site| (site.at.as_str(), site.line, Some(site.local.as_deref().unwrap_or(&site.name))))));
        lines.extend(member_rows(layers, &at, &on, line));
        Some(lines.join("\n"))
    }).collect::<Option<Vec<_>>>()?;
    Some(blocks.join("\n\n"))
}

/// Each export of a name the source index read who imports, in the order
/// asked; `None` when the walk read another count of groups than asked.
pub(crate) fn imports_of(root: &str, layers: &[Layer], exported: &[Unpublished<'_>]) -> Option<Vec<Group>> {
    if exported.is_empty() { return Some(Vec::new()) }
    let asked: Vec<_> = exported.iter().map(|held| vec![Asked { file: held.export.at.to_owned(), name: held.export.name.to_owned() }]).collect();
    let read = importers(root, layers, &asked);
    (read.groups.len() == exported.len()).then_some(read.groups)
}

/// The exports that declare the name: a file that passes another one's export
/// on is left out, unless every one does, and then all are.
pub(crate) fn declaring<'e, 'a>(exported: &'e [(&'e Unpublished<'a>, &'e Group)]) -> Vec<&'e (&'e Unpublished<'a>, &'e Group)> {
    let passing: HashSet<&str> = exported.iter().flat_map(|(_, group)| group.through.iter().map(String::as_str)).collect();
    let declaring: Vec<_> = exported.iter().filter(|(held, _)| !passing.contains(held.export.at)).collect();
    if declaring.is_empty() { exported.iter().collect() } else { declaring }
}

/// The rows that open one export's answer, and the declaration whose members follow them.
pub(crate) struct Opening {
    /// The file, the name and the line of the declaration: the export's own, or the one it passes on.
    pub at: String,
    pub on: String,
    pub line: u32,
    /// Whether the declaration is another file's, said on the third row.
    pub passes: bool,
    pub lines: Vec<String>,
}

/// The rows that open one export's answer: the name and its kind, where it is
/// exported, the declaration it passes on from another file, said by the name
/// its key gives an anonymous default, and that declaration's text, or the
/// export's own line when the walk reaches none.
pub(crate) fn exported_rows(keys: &Keys<'_>, layers: &[Layer], unfollowed: &HashSet<&str>, name: &str, export: &Export<'_>, line: u32, type_only: bool) -> Option<Opening> {
    let bound = declaration_exported(layers, export.at, export.name);
    let origin = bound.as_ref().filter(|bound| bound.at != export.at);
    let typed = if type_only { " (type only)" } else { "" };
    let exported = format!("at {}:{line} by {}{typed}", export.at, export.by);
    let (at, on, line) = origin.map_or_else(|| (export.at.to_owned(), export.name.to_owned(), line), |origin| (origin.at.clone(), origin.name.clone(), origin.line));
    let mut lines = vec![
        bound.as_ref().map_or_else(|| name.to_owned(), |bound| format!("{name} [{}]", bound.kind)),
        if unfollowed.contains(export.by) {
            format!("exported {exported}; whether it is published is not known: the package declares an entry {UNFOLLOWED}")
        } else {
            format!("exported, without being published, {exported}")
        },
    ];
    if let Some(origin) = origin {
        let named = if origin.name == SLOT { keys.origin_key(origin)?.named } else { origin.name.clone() };
        lines.push(format!("It passes on `{named}`, declared at {}:{}:", origin.at, origin.line));
    }
    match &bound {
        Some(bound) => lines.extend(bound.signature.iter().chain(&bound.doc).cloned()),
        None => lines.extend(export_line(layers, &at, line).map(|text| text.trim_matches(blank).to_owned())),
    }
    Some(Opening { at, on, line, passes: origin.is_some(), lines })
}
