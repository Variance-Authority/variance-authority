//! Who imports a name files export and no entry publishes: the declaration
//! answered first with its imports, then each other declaration of the name
//! with its own.

// compass: variance-authority.report.agent-surface

use std::collections::{BTreeSet, HashSet};

use crate::help_in_file::InFile;
use crate::help_name_scope::PackageScope;
use crate::help_origin::declaration_exported;
use crate::help_symbol_published::joined_sites;
use crate::help_symbol_rows::{PathSite, Rows};
use crate::help_unpublished::{exported_at, Unpublished};
use crate::help_usage::{importers, Asked, Namespace};
use crate::order::code_unit;

use super::kept::others_lines;
use super::{headline, list_kinds, list_own, places, primary_sites, Asking, Beside, Counts, NARROW};

/// The exports of one declaration: the file declaring it, and every export of it, the declaring ones first.
type Declaration<'e, 'a> = (&'e str, Vec<&'e Unpublished<'a>>);

/// `uses` for a name no entry publishes: each declaration its exports key,
/// in file order, the first answered in full and each other one after it;
/// `file` answers for the one it declares alone. `None` where the answer
/// needs what this reading does not carry: an export no package owns.
pub(super) fn exported_uses(asking: &Asking<'_>, rows: &Rows, paths: &[PathSite<'_>], exported: &[Unpublished<'_>], package: &PackageScope<'_>, beside: Beside<'_>) -> Option<String> {
    let &Asking { root, layers, name, from, file, limit } = asking;
    let chosen: Vec<_> = match file {
        None => exported.iter().collect(),
        Some(file) => {
            if !exported.iter().any(|held| held.export.at == file && held.export.bound.is_some()) { return None }
            exported.iter().filter(|held| held.export.at == file || held.export.bound.is_none()).collect()
        }
    };
    let mut declarations = declarations(&chosen);
    if let Some(file) = file { declarations.retain(|(at, _)| *at == file) }
    let every: HashSet<&str> = declarations.iter().flat_map(|(_, held)| held.iter().map(|one| one.export.at)).collect();
    let asked: Vec<_> = declarations.iter().map(|(_, held)| files(held).into_iter().map(|at| Asked { file: at.to_owned(), name: name.to_owned() }).collect()).collect();
    let mut read = importers(root, layers, &asked);
    if read.groups.len() != declarations.len() { return None }
    // The headline is the declaration answered first's, so only the namespaces it is passed on inside are named.
    let inside = published_inside(rows, &read.groups.first()?.namespaces)?;
    let member = (!inside.is_empty()).then(|| format!("published as {}", inside.join(" and as ")));
    for group in &mut read.groups { group.uses.retain(|site| package.through(&site.key)); }

    let ((_, primary), others) = declarations.split_first()?;
    let home = primary[0].export.by;
    if home.is_empty() { return None }
    let own = files(primary);
    // An import by path no declaration's file is known for joins the one answered first.
    let stray = |site: &&PathSite<'_>| file.is_none() && site.to.is_none_or(|to| !every.contains(to));
    let by_path = paths.iter().filter(|site| site.to.is_some_and(|to| own.contains(&to)) || stray(site)).map(|site| site.site);
    let group = &read.groups[0];
    let sites = joined_sites(&[], by_path, &group.uses, &group.through);
    let passed = match primary.as_slice() {
        [only] if only.export.bound.is_none() => declaration_exported(layers, only.export.at, name)
            .filter(|origin| origin.at != only.export.at)
            .map_or_else(String::new, |origin| format!(", which passes on `{}`, declared at {}:{}", origin.name, origin.at, origin.line)),
        _ => String::new(),
    };
    let kinds: BTreeSet<_> = primary.iter().filter_map(|held| held.declaration).collect();
    let kinds = kinds.into_iter().collect::<Vec<_>>().join(", ");
    let mut lines = vec![headline(name, &kinds, None, Some((&format!("{}{passed}", exported_at(primary)), member.as_deref())), home, &sites)];
    let namesakes = others.iter().map(|(_, held)| format!("{}, exported without being published", exported_at(held))).collect();
    lines.extend(others_lines(name, namesakes, &beside.kept, &beside.members));
    primary_sites(&mut lines, name, home, &in_file_of(&read.in_file, &own), sites, &read.in_file, from, limit);
    for ((_, held), group) in others.iter().zip(&read.groups[1..]) {
        lines.push(format!("\n`{name}` is exported, without being published, at {} as well, which is another declaration.", exported_at(held)));
        let at = files(held);
        let by_path = paths.iter().filter(|site| site.to.is_some_and(|to| at.contains(&to))).map(|site| site.site);
        let sites = joined_sites(&[], by_path, &group.uses, &group.through);
        if sites.is_empty() {
            lines.push("Nothing in this workspace imports it.".into());
        } else {
            let home = Some(held[0].export.by).filter(|by| !by.is_empty());
            let count = Counts::of(&sites, home.unwrap_or_default());
            let split = home.map_or_else(String::new, |home| count.split(home));
            lines.push(format!("Imported in {}{split}.{}", places(count.certain), count.may_read(name)));
            list_kinds(&mut lines, name, home, sites, from, limit);
        }
        for at in in_file_of(&read.in_file, &at) { list_own(&mut lines, at, "declares", &read.in_file, limit); }
    }
    lines.extend(beside.after);
    let declaring: HashSet<_> = exported.iter().filter(|held| held.export.bound.is_some()).map(|held| held.export.at).chain(beside.files).collect();
    if file.is_none() && declaring.len() > 1 { lines.push(NARROW.into()); }
    Some(lines.join("\n"))
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

/// The exports grouped by the file declaring what they export, in code-unit order of that file, each group's declaring exports first.
fn declarations<'e, 'a>(exported: &[&'e Unpublished<'a>]) -> Vec<Declaration<'e, 'a>> {
    let mut declarations: Vec<Declaration<'e, 'a>> = Vec::new();
    for &held in exported {
        match declarations.iter_mut().find(|(at, _)| *at == held.declared_at) {
            Some((_, group)) => group.push(held),
            None => declarations.push((&held.declared_at, vec![held])),
        }
    }
    declarations.sort_by(|a, b| code_unit(a.0, b.0));
    for (_, group) in &mut declarations { group.sort_by_key(|held| held.export.bound.is_none()); }
    declarations
}

/// The files `held` are exported from, each once, in the order they come.
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
