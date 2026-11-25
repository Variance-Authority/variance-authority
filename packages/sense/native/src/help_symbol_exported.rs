//! A name files export and no entry publishes, as `symbol` answers it: each
//! export that declares it, what it is, and how many places import it.

// compass: variance-authority.report.agent-surface

use std::collections::HashSet;

use crate::compact::Layer;
use crate::help_origin::{declaration_exported, export_line};
use crate::help_symbol_published::{member_rows, renamed_line};
use crate::help_symbol_rows::Rows;
use crate::help_unpublished::{Unpublished, UNCOUNTED};
use crate::help_usage::{importers, Asked};
use crate::text_cut::blank;

const UNFOLLOWED: &str = "this reading could not follow to a source file, such as a build output the checkout does not hold";

/// One block per export that declares the name, each with the imports the
/// source index resolved to it; a file that passes another one's export on is
/// left out, unless every one does. `None` where the walk to a declaration
/// ends at a default.
pub(crate) fn exported_only(root: &str, layers: &[Layer], rows: &Rows, name: &str, exported: &[&Unpublished<'_>]) -> Option<String> {
    let asked: Vec<_> = exported.iter().map(|held| vec![Asked { file: held.export.at.to_owned(), name: held.export.name.to_owned() }]).collect();
    let read = importers(root, layers, &asked);
    if read.groups.len() != exported.len() { return None }
    let passing: HashSet<&str> = read.groups.iter().flat_map(|group| group.through.iter().map(String::as_str)).collect();
    let mut declaring: Vec<_> = exported.iter().zip(&read.groups).filter(|(held, _)| !passing.contains(held.export.at)).collect();
    if declaring.is_empty() { declaring = exported.iter().zip(&read.groups).collect() }
    let blocks = declaring.into_iter().map(|(held, group)| {
        let (at, on, line, mut lines) = exported_rows(layers, rows, name, held)?;
        let count = group.uses.len();
        lines.push(if count == 0 {
            format!("Nothing in this workspace imports it; {UNCOUNTED}.")
        } else {
            format!("Imported in {count} {}; `variance ask uses` lists them, nearest to a file you name first.", if count == 1 { "place" } else { "places" })
        });
        lines.extend(renamed_line(name, group.uses.iter().map(|site| (site.at.as_str(), site.line, Some(site.local.as_deref().unwrap_or(&site.name))))));
        lines.extend(member_rows(layers, &at, &on, line));
        Some(lines.join("\n"))
    }).collect::<Option<Vec<_>>>()?;
    Some(blocks.join("\n\n"))
}

/// The rows that open one export's answer, and the declaration whose members
/// follow them: the name and its kind, where it is exported, the declaration
/// it passes on from another file, and that declaration's text, or the
/// export's own line when the walk reaches none.
fn exported_rows(layers: &[Layer], rows: &Rows, name: &str, held: &Unpublished<'_>) -> Option<(String, String, u32, Vec<String>)> {
    let export = &held.export;
    let bound = declaration_exported(layers, export.at, export.name);
    let origin = bound.as_ref().filter(|bound| bound.at != export.at);
    if origin.is_some_and(|origin| origin.name == "default") { return None }
    let (at, on, line) = origin.map_or_else(|| (export.at.to_owned(), export.name.to_owned(), held.line), |origin| (origin.at.clone(), origin.name.clone(), origin.line));
    let typed = if held.type_only { " (type only)" } else { "" };
    let exported = format!("at {}:{} by {}{typed}", export.at, held.line, export.by);
    let mut lines = vec![
        bound.as_ref().map_or_else(|| name.to_owned(), |bound| format!("{name} [{}]", bound.kind)),
        if rows.unfollowed(export.by)? {
            format!("exported {exported}; whether it is published is not known: the package declares an entry {UNFOLLOWED}")
        } else {
            format!("exported, without being published, {exported}")
        },
    ];
    if let Some(origin) = origin { lines.push(format!("It passes on `{}`, declared at {}:{}:", origin.name, origin.at, origin.line)); }
    match &bound {
        Some(bound) => lines.extend(bound.signature.iter().chain(&bound.doc).cloned()),
        None => lines.extend(export_line(layers, &at, line).map(|text| text.trim_matches(blank).to_owned())),
    }
    Some((at, on, line, lines))
}
