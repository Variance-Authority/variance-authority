//! Who imports a name files export and no entry publishes: the declaration
//! answered first with its imports, then each other declaration of the name
//! with its own.

// compass: variance-authority.report.agent-surface

use std::collections::{BTreeSet, HashSet};

use crate::help_in_file::InFile;
use crate::help_name_scope::PackageScope;
use crate::help_origin::declaration_exported;
use crate::help_symbol_published::joined_sites;
use crate::help_path_landing::landing;
use crate::help_symbol_rows::{Export, PathSite, Rows};
use crate::help_unpublished::{exported_at, Unpublished};
use crate::help_key::SLOT;
use crate::help_usage::{Asked, Group, Namespace};
use crate::order::code_unit;

use super::kept::others_lines;
use super::{headline, importers_of_every, list_kinds, list_own, narrow, places, primary_sites, Asking, Beside, Counts};

/// The exports of one declaration: the file declaring it, and every export of it, the declaring ones first.
pub(super) type Declaration<'e, 'a> = (&'e str, Vec<&'e Unpublished<'a>>);

/// `uses` for a name no entry publishes: each declaration its exports key,
/// in file order, the first answered in full and each other one after it;
/// `file` answers for the one it declares alone. `None` where the answer
/// needs what this reading does not carry.
pub(super) fn exported_uses(asking: &Asking<'_>, rows: &Rows, paths: &[PathSite<'_>], exported: &[Unpublished<'_>], package: &PackageScope<'_>, beside: Beside<'_>) -> Option<String> {
    let &Asking { root, layers, name, file, .. } = asking;
    let chosen: Vec<_> = match file {
        None => exported.iter().collect(),
        Some(file) => {
            if !exported.iter().any(|held| held.export.at == file && held.export.bound.is_some()) { return None }
            exported.iter().filter(|held| held.export.at == file || held.export.bound.is_none()).collect()
        }
    };
    let mut declarations = declarations(&chosen);
    if let Some(file) = file { declarations.retain(|(at, _)| *at == file) }
    let exports: Vec<&Export<'_>> = declarations.iter().flat_map(|(_, held)| held.iter().map(|one| &one.export)).collect();
    let asked: Vec<_> = declarations.iter().map(|(_, held)| asked_of(held)).collect();
    let mut read = importers_of_every(root, layers, &asked);
    if read.groups.len() != declarations.len() { return None }
    // The headline is the declaration answered first's, so only the namespaces it is passed on inside are named.
    let inside = published_inside(rows, &read.groups.first()?.namespaces)?;
    let member = (!inside.is_empty()).then(|| format!("published as {}", inside.join(" and as ")));
    for group in &mut read.groups { group.uses.retain(|site| package.through(&site.key)); }

    let ((_, primary), others) = declarations.split_first()?;
    let home = primary[0].export.by;
    let own = files(primary);
    let landed = landed(asking, paths, &exports);
    // An import by path that reaches no declaration read here is no declaration's, and is listed apart.
    // An import by path of `default` is the declaration its file's default is named by, never a stray of the slot.
    let strays: Vec<_> = paths.iter().zip(&landed).filter(|(_, to)| file.is_none() && name != SLOT && to.is_none()).map(|(site, _)| site.site).collect();
    let by_path = paths.iter().zip(&landed).filter(|(_, to)| to.is_some_and(|to| own.contains(&to))).map(|(site, _)| site.site);
    let group = &read.groups[0];
    let sites = joined_sites(&[], by_path, &group.uses, &group.through);
    let passed = match primary.as_slice() {
        // A default passed on is said by the name its declaration is keyed by, which the export's key holds.
        [only] if only.export.bound.is_none() => declaration_exported(layers, only.export.at, only.export.name)
            .filter(|origin| origin.at != only.export.at)
            .map_or_else(String::new, |origin| format!(", which passes on `{}`, declared at {}:{}", if origin.name == SLOT { &only.key.named } else { &origin.name }, origin.at, origin.line)),
        _ => String::new(),
    };
    let kinds: BTreeSet<_> = primary.iter().filter_map(|held| held.declaration).collect();
    let kinds = kinds.into_iter().collect::<Vec<_>>().join(", ");
    let mut lines = vec![headline(asking, &kinds, None, Some((&format!("{}{passed}", exported_at(primary)), member.as_deref())), home, &sites)];
    let namesakes = others.iter().map(|(_, held)| format!("{}, exported without being published", exported_at(held))).collect();
    lines.extend(others_lines(name, namesakes, &beside.kept, &beside.members));
    primary_sites(&mut lines, asking, home, &in_file_of(&read.in_file, &own), sites, strays, &read.in_file);
    for ((_, held), group) in others.iter().zip(&read.groups[1..]) { namesake(&mut lines, asking, held, paths, &landed, group, &read.in_file) }
    lines.extend(beside.after);
    let declaring: HashSet<_> = exported.iter().filter(|held| held.export.bound.is_some()).map(|held| held.export.at).chain(beside.files).collect();
    if file.is_none() && declaring.len() > 1 { lines.push(narrow(asking.surface)); }
    Some(lines.join("\n"))
}

/// The section of a declaration exported without being published, beside the one answered first: its imports and the lines of its files that use it.
pub(super) fn namesake(lines: &mut Vec<String>, asking: &Asking<'_>, held: &[&Unpublished<'_>], paths: &[PathSite<'_>], landed: &[Option<&str>], group: &Group, in_file: &[InFile]) {
    let name = asking.name;
    lines.push(format!("\n`{name}` is exported, without being published, at {} as well, which is another declaration.", exported_at(held)));
    let at = files(held);
    let by_path = paths.iter().zip(landed).filter(|(_, to)| to.is_some_and(|to| at.contains(&to))).map(|(site, _)| site.site);
    let sites = joined_sites(&[], by_path, &group.uses, &group.through);
    if sites.is_empty() {
        lines.push("Nothing in this workspace imports it.".into());
    } else {
        let home = Some(held[0].export.by).filter(|by| !by.is_empty());
        let count = Counts::of(&sites, home.unwrap_or_default());
        let split = home.map_or_else(String::new, |home| count.split(home));
        lines.push(format!("Imported in {}{split}.{}", places(count.certain), count.may_read(name)));
        list_kinds(lines, asking, home, sites);
    }
    for at in in_file_of(in_file, &at) { list_own(lines, asking, at, "declares", in_file); }
}

/// The imports to read for the exports of one declaration: out of each of their files, under every name its key spells it by.
pub(super) fn asked_of(held: &[&Unpublished<'_>]) -> Vec<Asked> {
    files(held).into_iter().flat_map(|at| held[0].key.spellings.iter().map(move |name| Asked { file: at.to_owned(), name: name.clone() })).collect()
}

/// The doors that publish the name only inside a namespace, `shout.greet` by
/// `@acme/lib` for an entry doing `export * as shout`: each namespace the walk
/// followed it into, at a file an entry opens.
fn published_inside(rows: &Rows, namespaces: &[Namespace]) -> Option<Vec<String>> {
    if namespaces.is_empty() { return Some(Vec::new()) }
    let doors = rows.openings_in(&namespaces.iter().map(|one| one.at.as_str()).collect())?;
    let mut inside: Vec<String> = Vec::new();
    for one in namespaces {
        for (_, door) in doors.iter().filter(|(at, _)| *at == one.at) {
            let named = format!("`{}` by {door}", dotted(one));
            if !inside.contains(&named) { inside.push(named) }
        }
    }
    Some(inside)
}

/// A namespace and the members read off it to reach the name, joined by dots.
fn dotted(one: &Namespace) -> String {
    std::iter::once(one.name.as_str()).chain(one.members.iter().map(String::as_str)).collect::<Vec<_>>().join(".")
}

/// The exports grouped by the declaration they reach, its file and the name
/// it is keyed by, in code-unit order of that file, then of that name, each
/// group's declaring exports first.
pub(super) fn declarations<'e, 'a>(exported: &[&'e Unpublished<'a>]) -> Vec<Declaration<'e, 'a>> {
    let mut declarations: Vec<Declaration<'e, 'a>> = Vec::new();
    for &held in exported {
        match declarations.iter_mut().find(|(at, group)| *at == held.declared_at && group[0].key.named == held.key.named) {
            Some((_, group)) => group.push(held),
            None => declarations.push((&held.declared_at, vec![held])),
        }
    }
    declarations.sort_by(|a, b| code_unit(a.0, b.0).then_with(|| code_unit(&a.1[0].key.named, &b.1[0].key.named)));
    for (_, group) in &mut declarations { group.sort_by_key(|held| held.export.bound.is_none()); }
    declarations
}

/// The files `held` are exported from, each once, in the order they come.
/// The file of the export each of `paths` lands on, among `exports`; `None` where it reaches none.
pub(super) fn landed<'e>(asking: &Asking<'_>, paths: &[PathSite<'_>], exports: &[&'e Export<'_>]) -> Vec<Option<&'e str>> {
    paths.iter().map(|site| landing(asking.layers, asking.name, site, exports).map(|export| export.at)).collect()
}

fn files<'a>(held: &[&Unpublished<'a>]) -> Vec<&'a str> {
    let mut files = Vec::new();
    for one in held {
        if !files.contains(&one.export.at) { files.push(one.export.at) }
    }
    files
}

/// The files among `asked` whose own lines use the name, in the order the index lists them.
fn in_file_of<'u>(uses: &'u [InFile], asked: &[&str]) -> Vec<&'u str> {
    let mut files: Vec<&str> = Vec::new();
    for site in uses {
        if asked.contains(&site.at.as_str()) && files.last() != Some(&site.at.as_str()) { files.push(&site.at) }
    }
    files
}
