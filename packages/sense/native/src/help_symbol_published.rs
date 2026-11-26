//! Published declarations, their ranked entry points and their use sites.

// compass: variance-authority.report.agent-surface

use crate::help_surface::Surface;
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use crate::compact::Layer;
use crate::help_members::members_on;
use crate::help_name_scope::PackageScope;
use crate::help_origin::declaration_exported;
use crate::help_key::{says, Keys, SLOT};
use crate::help_symbol_rows::{Entry, Export, PathSite, Site};
use crate::help_usage::{importers, Asked, Importers, NameUse};
use crate::help_uses_answer::Counts;
use crate::order::code_unit;
use crate::text_cut::blank;

/// Each declaration published under this spelling or answering to it, with
/// its own entry points and import sites: `declarations` from
/// [`published_declarations`], `paths` the imports by path of `name`.
pub(crate) fn published_symbols<'a>(keys: &Keys<'a>, root: &str, layers: &[Layer], name: &str, declarations: Vec<Declaration<'a>>, paths: &[PathSite<'a>], package: &PackageScope<'a>, surface: Surface<'_>) -> Option<Vec<String>> {
    let rows = keys.rows();
    let asked: Vec<_> = declarations.iter().map(|one| one.spellings.iter().map(|spelled| Asked { file: one.at.to_owned(), name: spelled.clone() }).collect()).collect();
    let mut read = importers(root, layers, &asked);
    for group in &mut read.groups { group.uses.retain(|site| package.through(&site.key)); }
    let mut blocks = Vec::with_capacity(declarations.len());
    for (one, group) in declarations.iter().zip(&read.groups) {
        // A declaration published by another name is imported by path by that name.
        let by_declared;
        let paths = if one.declared == name { paths } else {
            by_declared = rows.path_uses(&one.declared)?.into_iter().map(|row| rows.path_site(row)).filter(|site| site.as_ref().is_none_or(|site| package.path(site.specifier))).collect::<Option<Vec<_>>>()?;
            &by_declared[..]
        };
        let paths = paths.iter().filter(|path| path.to == Some(one.at)).map(|path| path.site);
        let sites = joined_sites(&one.doors, paths, &group.uses, &group.through);
        let lead = &one.doors[0];
        // Inside is the declaring file's package, which a re-exporting door is not.
        let owner = rows.exports_in(one.at)?.first().map(|held| held.by).filter(|by| !by.is_empty()).unwrap_or(lead.package);
        // A default export is headed by the name its declaration is keyed by, as every import of it is read.
        let named = if lead.name == SLOT { keys.key_of(lead.at, lead.declared)?.named } else { lead.name.to_owned() };
        let import = if lead.name != SLOT { Some(format!("import {{ {} }} from '{}';", lead.name, lead.specifier)) } else if named == SLOT { None } else { Some(format!("import {named} from '{}';", lead.specifier)) };
        blocks.push(published_symbol(layers, &named, import, &one.doors, owner, &sites, surface));
    }
    Some(blocks)
}

/// One published declaration: the file declaring it, the name it is keyed by,
/// every name that file exports it under, and the entries publishing it, the
/// one the workspace imports it by most first.
pub(crate) struct Declaration<'a> {
    pub at: &'a str,
    pub declared: String,
    pub spellings: Vec<String>,
    pub doors: Vec<Entry<'a>>,
}

/// Every published declaration of `name`: by the name an entry publishes, or
/// the name its declaring file exports it under, from the package asked, the
/// one whose leading door the workspace imports most first, then by file and
/// declared name in code units.
pub(crate) fn published_declarations<'a>(keys: &Keys<'a>, name: &str, package: &PackageScope<'_>) -> Option<Vec<Declaration<'a>>> {
    let rows = keys.rows();
    let mut candidates = rows.published(name)?;
    let answering: HashSet<(&str, &str)> = keys.answering(name)?.iter().map(|held| (held.at, held.name)).collect();
    if rows.holds("pub.at") {
        candidates.extend(rows.published_declaring(&answering)?);
    } else if !answering.is_empty() {
        // The entries are read for a name published or bound by an import; a door to another of its spellings is the full reading's.
        let spelled: HashSet<&str> = answering.iter().map(|(_, spelled)| *spelled).collect();
        if rows.publishes_declared(&spelled)? { return None }
    }
    let mut doors = Vec::new();
    for row in candidates {
        let entry = rows.entry(row)?;
        if !(says(entry.name, name) || keys.answers(entry.at, entry.declared, name)?) || !package.entry(&entry) { continue }
        let key = keys.key_of(entry.at, entry.declared)?;
        doors.push((entry, key));
    }
    doors.sort_by(|a, b| by_door(&a.0, &b.0));
    let mut declarations: Vec<Declaration<'a>> = Vec::new();
    for (entry, key) in doors {
        match declarations.iter_mut().find(|one| one.at == entry.at && one.declared == key.named) {
            Some(one) => one.doors.push(entry),
            None => declarations.push(Declaration { at: entry.at, declared: key.named, spellings: key.spellings, doors: vec![entry] }),
        }
    }
    declarations.sort_by(|a, b| by_door(&a.doors[0], &b.doors[0]).then_with(|| code_unit(a.at, b.at)).then_with(|| code_unit(&a.declared, &b.declared)));
    Some(declarations)
}

pub(crate) type Published<'a> = (Vec<Entry<'a>>, &'a str);

pub(crate) enum PublicationScope<'a> {
    Asked(&'a PackageScope<'a>),
    #[cfg_attr(not(feature = "standalone-cli"), allow(dead_code))]
    PublishedOnly,
}

pub(crate) fn published_imports<'a>(root: &str, layers: &[Layer], name: &str, entries: Vec<Entry<'a>>, exports: &[Export<'a>], scope: PublicationScope<'_>) -> Option<(Vec<Published<'a>>, Importers)> {
    if entries.iter().any(|entry| entry.declared != name || entry.name != name) {
        return None;
    }
    let mut declarations: HashMap<&str, Vec<Entry<'_>>> = HashMap::new();
    for entry in entries {
        declarations.entry(entry.at).or_default().push(entry);
    }
    if let PublicationScope::Asked(package) = scope {
        for export in exports.iter().filter(|export| package.export(export)) {
            if export.name != name || declaration_exported(layers, export.at, export.name)
                .is_none_or(|found| found.name != name || !declarations.contains_key(found.at.as_str()))
            {
                return None;
            }
        }
    } else if exports.iter().any(|export| export.name != name && export.bound == Some(name) && declarations.contains_key(export.at)) {
        // Counting under multiple export spellings uses the binding's full key.
        return None;
    }
    let mut declarations: Vec<_> = declarations.into_values().collect();
    for entries in &mut declarations { entries.sort_by(by_door); }
    declarations.sort_by(|a, b| by_door(&a[0], &b[0]).then_with(|| code_unit(a[0].at, b[0].at)));
    let asked: Vec<_> = declarations.iter().map(|entries| vec![Asked { file: entries[0].at.to_owned(), name: name.to_owned() }]).collect();
    let mut read = importers(root, layers, &asked);
    if let PublicationScope::Asked(package) = scope {
        for group in &mut read.groups { group.uses.retain(|site| package.through(&site.key)); }
    }
    let homes: HashMap<_, _> = exports.iter().filter(|export| export.bound == Some(name)).map(|export| (export.at, export.by)).collect();
    let declarations = declarations.into_iter().map(|entries| {
        let lead = &entries[0];
        let owner = homes.get(lead.at).copied().filter(|by| !by.is_empty()).unwrap_or(lead.package);
        (entries, owner)
    }).collect();
    Some((declarations, read))
}

fn by_door(a: &Entry<'_>, b: &Entry<'_>) -> Ordering {
    b.used_by.len().cmp(&a.used_by.len()).then(b.uses.cmp(&a.uses))
        .then_with(|| code_unit(a.package, b.package)).then_with(|| code_unit(a.subpath, b.subpath))
}

pub(crate) fn joined_sites<'a>(entries: &'a [Entry<'_>], paths: impl IntoIterator<Item = Site<'a>>, uses: &'a [NameUse], through: &[String]) -> Vec<Site<'a>> {
    let through: HashSet<&str> = through.iter().map(String::as_str).collect();
    let indexed: HashMap<_, _> = uses.iter().map(|site| ((site.at.as_str(), site.line), site.lines.as_deref())).collect();
    let held = entries.iter().flat_map(|entry| entry.sites.iter().copied())
        .chain(paths)
        .filter_map(|mut site| {
            let lines = indexed.get(&(site.at, site.line));
            if through.contains(site.at) && lines.is_none() { return None }
            site.lines = lines.copied().flatten();
            Some(site)
        });
    let indexed = uses.iter().map(|site| Site {
        at: &site.at,
        by: &site.by,
        line: site.line,
        local: site.local.as_deref().or(Some(site.name.as_str())),
        kind: &site.kind,
        type_only: site.r#type,
        through: site.through.as_deref().map(|kind| (kind, site.through_line)),
        off: site.through_default,
        whole: site.whole,
        lines: site.lines.as_deref(),
        path: None,
    });
    let mut seen = HashSet::new();
    held.chain(indexed).filter(|site| seen.insert((site.at, site.line))).collect()
}

fn published_symbol(layers: &[Layer], name: &str, import: Option<String>, entries: &[Entry<'_>], owner: &str, sites: &[Site<'_>], surface: Surface<'_>) -> String {
    let lead = &entries[0];
    let count = Counts::of(sites, owner);

    let mut lines = door_lines(lead, name, import, &count);
    append_members(&mut lines, layers, lead);
    append_renames(&mut lines, &sites, name);
    if entries.len() > 1 {
        let other = entries[1..].iter().map(|entry| entry.specifier).collect::<Vec<_>>().join(", ");
        lines.push(format!("\nAlso published by: {other}"));
    }
    let may = count.off + count.whole > 0;
    if count.certain > 0 {
        let split = count.split(owner);
        let (place, imports) = if count.certain == 1 { ("place", "imports") } else { ("places", "import") };
        let also = if may { ", and the ones that may read it" } else { "" };
        lines.push(format!("\n`{}` names the {} {place} that {imports} this{split}, nearest to a file you name first{also}.", surface.tool("uses"), count.certain));
    } else if may {
        lines.push(format!("\n`{}` names no place that imports this, and lists the ones that may read it.", surface.tool("uses")));
    }
    lines.join("\n")
}

/// The block that says `entry` as `name`: its kind, the import that reads it
/// when there is one, where it is declared, who reaches it through `sites`,
/// its signature and what is written above it.
pub(crate) fn door_lines(entry: &Entry<'_>, name: &str, import: Option<String>, sites: &Counts) -> Vec<String> {
    let mut lines = vec![format!("{name} [{}]", entry.kind)];
    lines.extend(import);
    lines.extend([format!("declared at {}:{}", entry.at, entry.line), reach(entry, sites)]);
    if let Some(signature) = entry.signature { lines.extend([String::new(), signature.to_owned()]); }
    lines.push(String::new());
    match (entry.doc, entry.mention) {
        (Some(doc), _) => lines.push(doc.to_owned()),
        (None, Some((at, line, text))) => lines.extend([format!("Nothing is written above this declaration. {at}:{line} names it:"), String::new(), text.to_owned()]),
        _ => lines.push("Nothing is written above this declaration.".to_owned()),
    }
    lines
}

fn reach(entry: &Entry<'_>, sites: &Counts) -> String {
    let may = sites.off + sites.whole;
    let possible = (may > 0).then(|| {
        let mut sources = Vec::new();
        if sites.off > 0 { sources.push(format!("{} off the module's `default`", sites.off)); }
        if sites.whole > 0 { sources.push(format!("{} passing the module on whole", sites.whole)); }
        format!("may be read in {may} {}: {}", if may == 1 { "place" } else { "places" }, sources.join(", "))
    });
    let count = entry.used_by.len();
    if count == 0 {
        return match possible {
            Some(possible) => {
                let unknown = if sites.certain == 0 { ", so whether it is used is unknown" } else { "" };
                format!("no other package imports it by name through its published path; it {possible}{unknown}")
            }
            None => "no other package imports it by its published path".to_owned(),
        };
    }
    let mut named = entry.used_by[..count.min(12)].join(", ");
    if count > 12 { named.push_str(&format!(", and {} more", count - 12)); }
    let packages = if count == 1 { "package" } else { "packages" };
    let imports = if entry.uses == 1 { "import" } else { "imports" };
    let also = possible.map_or_else(String::new, |possible| format!("; it also {possible}"));
    format!("used by {count} {packages}: {named} — {} {imports} by published path{also}", entry.uses)
}

fn append_members(lines: &mut Vec<String>, layers: &[Layer], entry: &Entry<'_>) {
    lines.extend(member_rows(layers, entry.at, entry.declared, entry.line));
}

/// A blank row, `Members:` and one row per line of `at` declaring a member of
/// the container `on`, as the index recorded the line; a line `line` already
/// shows is not shown again. Nothing when the container declares no members.
pub(crate) fn member_rows(layers: &[Layer], at: &str, on: &str, line: u32) -> Vec<String> {
    let mut seen = HashSet::from([line]);
    let members: Vec<_> = members_on(layers, at, on).into_iter().filter(|one| seen.insert(one.line)).collect();
    if members.is_empty() { return Vec::new() }
    let mut lines = vec![String::new(), "Members:".to_owned()];
    let prefix = if members.len() == 1 { format!("{at}:") } else { lines.push(at.to_owned()); "  ".to_owned() };
    for member in members {
        let text = member.text.as_deref().map_or(member.name.as_str(), |text| text.trim_matches(blank));
        lines.push(format!("{prefix}{}: {text}", member.line));
    }
    lines
}

fn append_renames(lines: &mut Vec<String>, sites: &[Site<'_>], name: &str) {
    lines.extend(renamed_line(name, sites.iter().map(|site| (site.at, site.line, site.local))).map(|line| format!("\n{line}")));
}

/// `Imported under another name:` and each import of `sites` that knows it
/// by a name other than `name`, once, by file in code units, then by line.
pub(crate) fn renamed_line<'s>(name: &str, sites: impl IntoIterator<Item = (&'s str, u32, Option<&'s str>)>) -> Option<String> {
    let mut sites: Vec<_> = sites.into_iter().collect();
    sites.sort_by(|a, b| code_unit(a.0, b.0).then(a.1.cmp(&b.1)));
    let mut seen = HashSet::new();
    let renamed: Vec<_> = sites.into_iter().filter_map(|(at, line, known)| {
        let known = known.filter(|known| *known != name)?;
        let said = format!("{at}:{line} as `{known}`");
        seen.insert(said.clone()).then_some(said)
    }).collect();
    if renamed.is_empty() { return None }
    let more = if renamed.len() > 12 { format!(", and {} more", renamed.len() - 12) } else { String::new() };
    Some(format!("Imported under another name: {}{more}.", renamed[..renamed.len().min(12)].join(", ")))
}
