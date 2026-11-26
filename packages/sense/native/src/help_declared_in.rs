//! The files of the checkout an answer about a name rests on: each
//! declaration it reads, at its line, with the names written there, and for
//! `symbol` and `uses` the entries and barrels a published one is taught through.

// compass: variance-authority.report.agent-surface

use std::collections::HashMap;

use crate::compact::Layer;
use crate::harvest::is_bound;
use crate::help_declared::DeclaredName;
use crate::help_members::MemberSite;
use crate::help_origin::declaration_exported;
use crate::help_symbol_published::Declaration;
use crate::help_symbol_rows::{Export, PathSite, Rows};
use crate::help_unpublished::Unpublished;
use crate::help_usage::requested;

/// One declaration an answer reads: its file, its line, and every name written there.
pub(crate) type Row = (String, u32, Vec<String>);

/// What one answer about a name read, before it is cut to the files it rests on.
pub(crate) struct Readings<'r, 'a> {
    pub name: &'r str,
    pub member: &'r str,
    pub published: &'r [Declaration<'a>],
    pub paths: &'r [PathSite<'a>],
    /// The exports of the name in the package asked, which an import by path resolves to.
    pub exports: &'r [Export<'a>],
    /// Every file that keeps the name to itself or only binds it, as the answer orders them.
    pub declared: &'r [DeclaredName],
    pub members: &'r [MemberSite],
}

/// The declarations `read` holds, in the order an answer says them: the
/// published ones, else the ones the imports by path reach, then the exports
/// `exported` chooses with the declaration each passes on, the files that keep
/// it, and the bindings where `bindings` asks for them, the local names
/// `aliases` gives, the nested declarations, and the members, a method named
/// under its class.
pub(crate) fn rows_of(read: &Readings<'_, '_>, rows: &Rows, layers: &[Layer], exported: &[&Unpublished<'_>], bindings: bool, aliases: &[(String, u32, String)]) -> Option<Vec<Row>> {
    let name = read.name;
    let mut at: Vec<Row> = read.published.iter().map(|one| (one.at.to_owned(), one.doors[0].line, one.spellings.clone())).collect();
    if at.is_empty() {
        for site in read.paths {
            let (owner, _) = requested(site.specifier);
            let mut named = read.exports.iter().filter(|export| export.name == name && site.to.map_or(export.by == owner, |to| export.at == to));
            let export = named.next().filter(|_| site.to.is_some() || named.next().is_none());
            if let Some(held) = export { at.push((held.at.to_owned(), rows.export_line(held)?, vec![held.name.to_owned()])) }
        }
    }
    for held in exported {
        let export = &held.export;
        // `export { shout as format }` declares nothing: the function it binds, in the same file, is the declaration.
        match declaration_exported(layers, export.at, export.name) {
            Some(bound) if bound.at == export.at => at.push((bound.at, bound.line, vec![bound.name, export.name.to_owned()])),
            bound => {
                at.push((export.at.to_owned(), held.line, vec![export.name.to_owned()]));
                if let Some(origin) = bound { at.push((origin.at, origin.line, vec![origin.name])) }
            }
        }
    }
    let kept = read.declared.iter().filter(|one| bindings || !is_bound(&one.kind));
    at.extend(kept.clone().filter(|one| one.holder_line.is_none()).map(|one| (one.at.clone(), one.line, vec![one.name.clone()])));
    at.extend(aliases.iter().map(|(file, line, local)| (file.clone(), *line, vec![local.clone()])));
    at.extend(kept.filter(|one| one.holder_line.is_some()).map(|one| (one.at.clone(), one.line, vec![one.name.clone()])));
    at.extend(read.members.iter().map(|site| {
        let unnamed = matches!(site.on.as_str(), "a type literal" | "a class");
        (site.at.clone(), site.line, vec![if unnamed { read.member.to_owned() } else { format!("{}/{}", site.on, read.member) }])
    }));
    Some(at)
}

/// The files `at` names, each with its lines in the order first read, and
/// every name written at each `file:line`.
pub(crate) fn joined(at: Vec<Row>) -> (Vec<(String, Vec<u32>)>, Vec<(String, Vec<String>)>) {
    let mut files: Vec<(String, Vec<u32>)> = Vec::new();
    let mut spelled: Vec<(String, Vec<String>)> = Vec::new();
    let (mut file_at, mut spelled_at) = (HashMap::new(), HashMap::new());
    for (file, line, names) in at {
        let key = format!("{file}:{line}");
        let held = *file_at.entry(file.clone()).or_insert_with(|| { files.push((file, Vec::new())); files.len() - 1 });
        let lines = &mut files[held].1;
        if !lines.contains(&line) { lines.push(line) }
        let held = *spelled_at.entry(key.clone()).or_insert_with(|| { spelled.push((key, Vec::new())); spelled.len() - 1 });
        let written = &mut spelled[held].1;
        for one in names { if !written.contains(&one) { written.push(one) } }
    }
    (files, spelled)
}

/// The entry each door of a published declaration opens from, and each file
/// that passes it on between that entry and the declaration.
pub(crate) fn publishing(published: &[Declaration<'_>], through: &[String]) -> Vec<String> {
    published.iter().flat_map(|one| one.doors.iter().filter_map(|door| door.source.map(str::to_owned)))
        .chain(through.iter().cloned()).collect()
}

/// The last line of the head the source index cut for each declaration
/// `spelled` names, under any name its file spells it: the line a function's
/// parameters must open by to be the one it declares; `None` where it kept no head.
pub(crate) fn heads(spelled: &[(String, Vec<String>)], layers: &[Layer], declared: &[DeclaredName]) -> Vec<Option<u32>> {
    spelled.iter().map(|(key, names)| {
        let (file, line) = key.rsplit_once(':')?;
        let line: u32 = line.parse().ok()?;
        names.iter().find_map(|name| {
            let bound = declaration_exported(layers, file, name).filter(|held| held.at == file && held.line == line).and_then(|held| held.signature);
            let signature = bound.or_else(|| declared.iter().find(|held| held.name == *name && held.at == file && held.line == line).and_then(|held| held.signature.clone()))?;
            Some(line + signature.split('\n').count() as u32 - 1)
        })
    }).collect()
}
