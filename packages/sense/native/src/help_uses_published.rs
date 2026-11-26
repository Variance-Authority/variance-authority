//! Who imports a name entries publish: the declaration answered first with
//! its imports, then each other published declaration of the name, and each
//! declaration exported by it and published by no entry, with their own.
//!
//! A declaration is the file declaring it and the name it is keyed by, so a
//! door that publishes it under another name, `export { clamp as ceiling }`,
//! is one more door to it, and its imports are read under every name its file
//! exports it by.

// compass: variance-authority.report.agent-surface

use std::collections::BTreeSet;

use crate::help_key::Keys;
use crate::help_name_scope::PackageScope;
use crate::help_symbol_published::{joined_sites, Declaration};
use crate::help_symbol_rows::{PathSite, Rows, Site};
use crate::help_unpublished::{exported_at, Unpublished};
use crate::help_usage::{Asked, NameUse};

use super::exported::{asked_of, declarations, landed, namesake};
use super::kept::{others_lines, spelled_as};
use super::{headline, importers_of_every, list_kinds, list_own, narrow, places, primary_sites, Asking, Beside, Counts, Strays};

/// `uses` for a name entries publish: `published` from `published_declarations`,
/// `exported` every export that answers to the name. `file` answers for the
/// declaration it declares, or the one a file it names passes on. `None` where
/// the answer needs what this reading does not carry.
pub(super) fn published_uses(asking: &Asking<'_>, keys: &Keys<'_>, paths: &[PathSite<'_>], published: Vec<Declaration<'_>>, exported: &[Unpublished<'_>], package: &PackageScope<'_>, beside: Beside<'_>) -> Option<String> {
    let &Asking { root, layers, name, file, .. } = asking;
    let rows = keys.rows();
    let every: BTreeSet<&str> = published.iter().map(|one| one.at)
        .chain(exported.iter().filter(|held| held.export.bound.is_some()).map(|held| held.export.at)).chain(beside.files.iter().copied()).collect();
    // Beside a published declaration, only an export that declares the name is another one.
    let unpublished: Vec<_> = exported.iter().filter(|held| !published.iter().any(|one| one.at == held.key.at && one.declared == held.key.named)).collect();
    let mut groups = declarations(&unpublished);
    groups.retain(|(at, held)| file.map_or(held[0].export.bound.is_some(), |file| *at == file));
    let asked: Vec<Vec<Asked>> = published.iter().map(|one| one.spellings.iter().map(|spelled| Asked { file: one.at.to_owned(), name: spelled.clone() }).collect())
        .chain(groups.iter().map(|(_, held)| asked_of(held))).collect();
    let mut read = importers_of_every(root, layers, &asked);
    for group in &mut read.groups { group.uses.retain(|site| package.through(&site.key)); }
    let (answered, apart) = read.groups.split_at(published.len());
    asking.listed.borrow_mut().through.extend(answered.iter().flat_map(|group| group.through.iter().cloned()));
    let mut chosen: Vec<_> = published.iter().zip(answered).collect();
    if let Some(file) = file {
        let at = chosen.iter().position(|(one, _)| one.at == file)
            .or_else(|| chosen.iter().position(|(_, group)| group.through.iter().any(|at| at == file)))?;
        chosen = vec![chosen[at]];
    }
    let mut answers = chosen.into_iter();
    let (lead, group) = answers.next()?;
    let sites = sites_of(rows, name, paths, package, lead, &group.uses, &group.through)?;
    let owner = home(keys, lead)?;
    let kinds: BTreeSet<_> = lead.doors.iter().map(|entry| entry.kind).collect();
    let kinds = kinds.into_iter().collect::<Vec<_>>().join(", ");
    let rest: Vec<_> = answers.collect();
    let namesakes = if file.is_some() { Vec::new() } else {
        rest.iter().map(|(one, _)| format!("{}:{}{}, published by {}", one.at, one.doors[0].line, spelled_as(&one.declared, name), publishers(one, name)))
            .chain(groups.iter().map(|(_, held)| format!("{}, exported without being published", exported_at(held)))).collect()
    };
    let others = others_lines(name, namesakes, &beside.kept, &beside.members);
    // An answer covering more than one declaration says which it counts first, and so does one a door or its file spells by another name.
    let renamed = lead.declared != name || lead.doors.iter().any(|entry| entry.name != name);
    let which = (!others.is_empty() || renamed).then(|| published_at(lead, name));
    let mut lines = vec![headline(asking, &kinds, which.as_deref(), None, owner, &sites, false)];
    lines.extend(others);
    primary_sites(&mut lines, asking, owner, &[lead.at], sites, Strays::default(), &read.in_file);
    for (one, group) in rest {
        lines.push(format!("\n`{name}` is {} as well, which is another declaration.", published_at(one, name)));
        let sites = sites_of(rows, name, paths, package, one, &group.uses, &group.through)?;
        if sites.is_empty() {
            lines.push("Nothing in this workspace imports it.".into());
        } else {
            let owner = home(keys, one)?;
            let count = Counts::of(&sites, owner);
            lines.push(format!("Imported in {}{}.{}", places(count.certain), count.split(owner), count.may_read(name)));
            list_kinds(&mut lines, asking, Some(owner), sites);
        }
        list_own(&mut lines, asking, one.at, "declares", &read.in_file);
    }
    let exports: Vec<_> = groups.iter().flat_map(|(_, held)| held.iter().map(|one| &one.export)).collect();
    let landed = landed(asking, paths, &exports);
    for ((_, held), group) in groups.iter().zip(apart) { namesake(&mut lines, asking, held, paths, &landed, group, &read.in_file) }
    lines.extend(beside.after);
    if file.is_none() && every.len() > 1 { lines.push(narrow(asking.surface)); }
    Some(lines.join("\n"))
}

/// The sites of one published declaration: its doors', the imports by path
/// of the name it is keyed by out of its file, and the imports read under
/// every name its file exports it by.
fn sites_of<'s>(rows: &'s Rows, name: &str, paths: &[PathSite<'s>], package: &PackageScope<'_>, one: &'s Declaration<'_>, uses: &'s [NameUse], through: &[String]) -> Option<Vec<Site<'s>>> {
    let by_declared;
    let paths = if one.declared == name { paths } else {
        by_declared = rows.path_uses(&one.declared)?.into_iter().map(|row| rows.path_site(row)).filter(|site| site.as_ref().is_none_or(|site| package.path(site.specifier))).collect::<Option<Vec<_>>>()?;
        &by_declared[..]
    };
    Some(joined_sites(&one.doors, paths.iter().filter(|path| path.to == Some(one.at)).map(|path| path.site), uses, through))
}

/// The package a published declaration is declared in, which a re-exporting door is not.
fn home<'a>(keys: &Keys<'a>, one: &Declaration<'a>) -> Option<&'a str> {
    Some(keys.rows().exports_in(one.at)?.first().map(|held| held.by).filter(|by| !by.is_empty()).unwrap_or(one.doors[0].package))
}

/// The entries that publish one declaration, each saying the name it publishes it under where that is not `asked`.
fn publishers(one: &Declaration<'_>, asked: &str) -> String {
    one.doors.iter().map(|entry| format!("{}{}", entry.specifier, spelled_as(entry.name, asked))).collect::<Vec<_>>().join(", ")
}

/// The entries that publish one declaration and where it is declared, which tells it from a namesake.
fn published_at(one: &Declaration<'_>, asked: &str) -> String {
    format!("published by {}, declared{} at {}:{}", publishers(one, asked), spelled_as(&one.declared, asked), one.at, one.doors[0].line)
}
