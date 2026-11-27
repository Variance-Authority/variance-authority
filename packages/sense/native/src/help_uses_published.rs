//! Who imports a name entries publish: the declaration answered first with
//! its imports, and each other published declaration of the name, and each
//! declaration exported by it and published by no entry, on a line with how
//! many places import it, answered alone by `--file`.
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
use crate::help_unpublished::Unpublished;
use crate::help_usage::{Asked, NameUse};

use super::exported::{asked_of, declarations, exported_line, landed, namesake, namesake_sites};
use super::kept::{others_lines, spelled_as};
use super::{headline, imported, importers_of_every, narrow, primary_sites, Asking, Beside, Counts, Strays};

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
    // The lead is the published declaration most places import by name, then the most that may read it, then the first in order.
    let mut answers = chosen.into_iter().map(|(one, group)| Some((one, sites_of(rows, name, paths, package, one, &group.uses, &group.through)?))).collect::<Option<Vec<_>>>()?;
    let rank = |sites: &[Site<'_>]| { let count = Counts::of(sites, ""); (count.certain, count.off + count.whole) };
    let most = (0..answers.len()).fold(0, |best, at| if rank(&answers[at].1) > rank(&answers[best].1) { at } else { best });
    if answers.is_empty() { return None }
    let (lead, sites) = answers.remove(most);
    let owner = home(keys, lead)?;
    let kinds: BTreeSet<_> = lead.doors.iter().map(|entry| entry.kind).collect();
    let kinds = kinds.into_iter().collect::<Vec<_>>().join(", ");
    let exports: Vec<_> = groups.iter().flat_map(|(_, held)| held.iter().map(|one| &one.export)).collect();
    let landed = landed(asking, paths, &exports);
    // Asked for no file, each other declaration is one line with its import count; `--file` answers one.
    let mut namesakes = Vec::new();
    if file.is_none() {
        for (one, sites) in &answers {
            namesakes.push(format!("{}:{}{}, published by {}{}", one.at, one.doors[0].line, spelled_as(&one.declared, name), publishers(one, name), imported(asking, sites)));
        }
        namesakes.extend(groups.iter().zip(apart).map(|((_, held), group)| exported_line(held, &imported(asking, &namesake_sites(held, paths, &landed, group)))));
    }
    // Only the kept and member declarations left are answered below.
    let below = namesakes.is_empty();
    let others = others_lines(name, namesakes, &beside.kept, &beside.members, below);
    // An answer covering more than one declaration says which it counts first, and so does one a door or its file spells by another name.
    let renamed = lead.declared != name || lead.doors.iter().any(|entry| entry.name != name);
    let which = (!others.is_empty() || renamed).then(|| published_at(lead, name));
    let mut lines = vec![headline(asking, &kinds, which.as_deref(), None, owner, &sites, false)];
    lines.extend(others);
    primary_sites(&mut lines, asking, owner, &[lead.at], sites, Strays::default(), &read.in_file);
    // A file named answers each declaration it holds that no entry publishes after the published one.
    if file.is_some() {
        for ((_, held), group) in groups.iter().zip(apart) { namesake(&mut lines, asking, held, paths, &landed, group, &read.in_file) }
    }
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
