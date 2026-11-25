//! Published declarations, their ranked entry points and their use sites.

// compass: variance-authority.report.agent-surface

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use crate::compact::Layer;
use crate::help_members::members_on;
use crate::help_name_scope::PackageScope;
use crate::help_origin::declaration_exported;
use crate::help_symbol_rows::{Entry, Export, Site};
use crate::help_usage::{importers, Asked, Importers, NameUse};
use crate::help_uses_answer::Counts;
use crate::order::code_unit;
use crate::text_cut::blank;

/// Each declaration published under this spelling, with its own entry points and import sites.
pub(crate) fn published_symbols<'a>(root: &str, layers: &[Layer], name: &str, entries: Vec<Entry<'a>>, exports: &[Export<'a>], paths: &[crate::help_symbol_rows::PathSite<'a>], package: &PackageScope<'a>) -> Option<Vec<String>> {
    let (declarations, read) = published_imports(root, layers, name, entries, exports, PublicationScope::Asked(package))?;
    Some(declarations.iter().zip(&read.groups).map(|((entries, owner), group)| {
        let paths = paths.iter().filter(|path| path.to == Some(entries[0].at)).map(|path| path.site);
        let sites = joined_sites(entries, paths, &group.uses, &group.through);
        published_symbol(layers, name, entries, owner, &sites)
    }).collect())
}

pub(crate) type Published<'a> = (Vec<Entry<'a>>, &'a str);

pub(crate) enum PublicationScope<'a> { Asked(&'a PackageScope<'a>), PublishedOnly }

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

fn published_symbol(layers: &[Layer], name: &str, entries: &[Entry<'_>], owner: &str, sites: &[Site<'_>]) -> String {
    let lead = &entries[0];
    let at = lead.at;
    let count = Counts::of(sites, owner);

    let mut lines = vec![
        format!("{name} [{}]", lead.kind),
        format!("import {{ {name} }} from '{}';", lead.specifier),
        format!("declared at {at}:{}", lead.line),
        reach(lead, &count),
    ];
    if let Some(signature) = lead.signature { lines.extend([String::new(), signature.to_owned()]); }
    lines.push(String::new());
    match (lead.doc, lead.mention) {
        (Some(doc), _) => lines.push(doc.to_owned()),
        (None, Some((at, line, text))) => lines.extend([format!("Nothing is written above this declaration. {at}:{line} names it:"), String::new(), text.to_owned()]),
        _ => lines.push("Nothing is written above this declaration.".to_owned()),
    }
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
        lines.push(format!("\n`variance ask uses` names the {} {place} that {imports} this{split}, nearest to a file you name first{also}.", count.certain));
    } else if may {
        lines.push("\n`variance ask uses` names no place that imports this, and lists the ones that may read it.".into());
    }
    lines.join("\n")
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
