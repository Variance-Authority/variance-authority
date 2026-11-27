//! Rank and render the source rows selected for one search page.

// compass: variance-authority.report.agent-surface

use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap, HashSet};

use crate::compact::Layer;
use crate::help_origin::declaration_exported;
use crate::help_search_answer::{plural, sentence, summary};
use crate::help_search_matches::postings;
use crate::help_symbol_published::{joined_sites, published_imports};
use crate::help_symbol_rows::Rows;
use crate::help_usage::{importers, requested, Asked};
use crate::order::code_unit;

pub(crate) fn count_published<'a>(root: &str, layers: &[Layer], rows: &'a Rows, published: &mut [PublishedHit<'a>]) -> Option<()> {
    let mut counted = BTreeMap::new();

    for hit in published {
        let name = rows.string("names.name", hit.name)?;
        let key = (hit.name, hit.at);
        if let Some(&(packages, uses)) = counted.get(&key) {
            hit.packages = packages;
            hit.uses = uses;
            continue;
        }
        let group = rows.published(name)?.into_iter().map(|row| rows.entry(row)).collect::<Option<_>>()?;
        let (declarations, read) = published_imports(root, layers, name, group, &rows.exports(name)?)?;
        let paths = rows.path_uses(name)?.into_iter().map(|row| rows.path_site(row)).collect::<Option<Vec<_>>>()?;
        for ((entries, _), group) in declarations.iter().zip(&read.groups) {
            let paths = paths.iter().filter(|site| site.to == Some(entries[0].at)).map(|site| site.site);
            let sites = joined_sites(entries, paths, &group.uses, &group.through);
            let certain = sites.iter().filter(|site| !site.off && !site.whole);
            let packages = certain.clone().filter_map(|site| (!site.by.is_empty()).then_some(site.by)).collect::<HashSet<_>>().len();
            counted.insert((hit.name, entries[0].at), (packages, certain.count()));
        }
        let &(packages, uses) = counted.get(&key)?;
        hit.packages = packages;
        hit.uses = uses;
    }
    Some(())
}

pub(crate) fn published_line(hit: &PublishedHit<'_>, name: &str, words: &BTreeMap<String, String>) -> String {
    let imports = if hit.uses == 0 { "imported nowhere".into() } else {
        format!("imported in {} in {}", plural(hit.uses, "place", "places"), plural(hit.packages, "package", "packages"))
    };
    let said = hit.doc.map(|doc| sentence(doc, &words)).unwrap_or_else(|| "UNDOCUMENTED".into());
    let scoped = hit.in_area.as_ref().map(|area| {
        let hops = area.distance.iter().map(|(hops, files)| format!("{hops}: {files}")).collect::<Vec<_>>().join(", ");
        format!("{}, {} in this area (files by distance: {hops}); across the repository ", plural(area.files, "file", "files"), plural(area.imports, "import", "imports"))
    }).unwrap_or_default();
    format!("{} · {name} [{}] {scoped}{imports} — {said}", hit.specifier, hit.kind)
}

pub(crate) fn exported_page(root: &str, layers: &[Layer], rows: &Rows, exported: Vec<(usize, usize, ExportHit<'_>)>, admits: impl Fn(&str) -> bool, words: &BTreeMap<String, String>) -> Option<Vec<(String, String)>> {
    let mut picked = Vec::new();
    let mut written = Vec::new();
    let mut asks = Vec::new();
    for (name, count, hit) in exported {
        let name_text = rows.string("names.name", name)?;
        let all = postings(&rows, "names.expOff", "names.exp", name)?;
        let bound = declaration_exported(layers, hit.at, name_text).filter(|held| held.name == name_text)
            .and_then(|held| all.iter().find(|&&row| rows.string("exp.at", row) == Some(held.at.as_str())).map(|&home| (held, home)));
        if let Some((held, _)) = &bound {
            asks.push(vec![Asked { file: held.at.clone(), name: held.name.clone() }]);
        }
        picked.push((name_text, count, hit, all, bound));
    }
    let passers = (!asks.is_empty()).then(|| importers(root, layers, &asks));
    let mut groups = passers.iter().flat_map(|read| &read.groups);
    for (name, count, hit, all, bound) in picked {
        let Some((held, home)) = bound else {
            let by = rows.string("exp.by", hit.row)?;
            written.push((exported_line(name, by, hit.at, hit.line, "", count, hit.doc, words), hit.at.to_owned()));
            continue;
        };
        let group = groups.next()?;
        let through: HashSet<_> = group.through.iter().map(String::as_str).collect();
        let mut count = 1;
        let mut in_scope = Vec::new();
        for row in all {
            let at = rows.string("exp.at", row)?;
            if !admits(at) { continue }
            count += usize::from(at != held.at && !through.contains(at));
            in_scope.push((at, row));
        }
        let by = rows.string("exp.by", home)?;
        let door = entered_through(&rows, name, by, &through)?;
        let from = match door {
            Some(at) => {
                let line = in_scope.iter().find(|(file, _)| *file == at).and_then(|&(_, row)| rows.number("exp.line", row));
                line.map_or_else(|| format!(" · exported from {at}"), |line| format!(" · exported from {at}:{line}"))
            }
            None => String::new(),
        };
        let doc = if held.at == hit.at || hit.field >= 3 { hit.doc } else { held.doc.as_deref() };
        written.push((exported_line(name, by, &held.at, held.line, &from, count, doc, words), held.at));
    }
    Some(written)
}

fn entered_through<'a>(rows: &'a Rows, name: &str, home: &str, barrels: &HashSet<&str>) -> Option<Option<&'a str>> {
    if home.is_empty() || barrels.is_empty() { return Some(None) }
    let mut files = HashMap::<&str, HashSet<&str>>::new();
    for row in rows.path_uses(name)? {
        let path = rows.path_site(row)?;
        if let Some(to) = path.to.filter(|to| barrels.contains(to)) {
            if path.site.by != home && requested(path.specifier).0 == home {
                files.entry(to).or_default().insert(path.site.at);
            }
        }
    }
    Some(files.into_iter().min_by(|(a, left), (b, right)| right.len().cmp(&left.len()).then_with(|| code_unit(a, b))).map(|(file, _)| file))
}

fn exported_line(name: &str, by: &str, at: &str, line: u32, from: &str, count: usize, doc: Option<&str>, words: &BTreeMap<String, String>) -> String {
    let by = if by.is_empty() { "the repository" } else { by };
    let rest = count.saturating_sub(1);
    let more = if rest == 0 { String::new() } else { format!(" (+{} more {})", rest, if rest == 1 { "file" } else { "files" }) };
    let doc = summary(doc, words);
    format!("{name} — {by} · {at}:{line}{from}{more}{doc}")
}

pub(crate) struct PublishedHit<'a> {
    pub(crate) row: usize,
    pub(crate) name: usize,
    pub(crate) field: u8,
    pub(crate) packages: usize,
    pub(crate) uses: usize,
    pub(crate) specifier: &'a str,
    pub(crate) at: &'a str,
    pub(crate) kind: &'a str,
    pub(crate) doc: Option<&'a str>,
    pub(crate) in_area: Option<InArea>,
}

pub(crate) struct InArea {
    pub(crate) files: usize,
    pub(crate) imports: usize,
    pub(crate) distance: BTreeMap<u32, usize>,
}

pub(crate) fn published_sites_in(rows: &Rows, row: usize, area: &HashMap<&str, u32>) -> Option<InArea> {
    let mut files = HashSet::new();
    let mut imports = 0;
    let mut distance = BTreeMap::new();
    for site in rows.range("pub.sitesOff", row)? {
        let file = rows.string("use.at", site)?;
        if let Some(&hops) = area.get(file) {
            imports += 1;
            if files.insert(file) { *distance.entry(hops).or_insert(0) += 1; }
        }
    }
    Some(InArea { files: files.len(), imports, distance })
}

pub(crate) struct ExportHit<'a> {
    pub(crate) row: usize,
    pub(crate) field: u8,
    pub(crate) kind: u8,
    pub(crate) at: &'a str,
    pub(crate) line: u32,
    pub(crate) doc: Option<&'a str>,
}

pub(crate) fn compare_published(a: &PublishedHit<'_>, b: &PublishedHit<'_>) -> Ordering {
    let scoped = |hit: &PublishedHit<'_>| hit.in_area.as_ref().map_or((0, 0), |area| (area.files, area.imports));
    a.field.cmp(&b.field).then_with(|| scoped(b).cmp(&scoped(a))).then(b.packages.cmp(&a.packages)).then(b.uses.cmp(&a.uses)).then(a.name.cmp(&b.name))
        .then_with(|| doc_order(a.doc, b.doc)).then_with(|| code_unit(a.kind, b.kind)).then_with(|| code_unit(a.at, b.at)).then_with(|| code_unit(a.specifier, b.specifier)).then(a.row.cmp(&b.row))
}

pub(crate) fn compare_exported(a: &ExportHit<'_>, b: &ExportHit<'_>) -> Ordering {
    a.field.cmp(&b.field).then(a.kind.cmp(&b.kind)).then_with(|| doc_order(a.doc, b.doc)).then(a.line.cmp(&b.line)).then_with(|| code_unit(a.at, b.at)).then(a.row.cmp(&b.row))
}

fn doc_order(a: Option<&str>, b: Option<&str>) -> Ordering {
    match (a, b) {
        (Some(a), Some(b)) => code_unit(a, b),
        _ => b.is_some().cmp(&a.is_some()),
    }
}


pub(crate) fn published_hit<'a>(rows: &'a Rows, row: usize, field: u8, area: Option<&HashMap<&str, u32>>) -> Option<PublishedHit<'a>> {
    Some(PublishedHit {
        row,
        name: rows.number("pub.name", row)? as usize,
        field,
        packages: rows.range("pub.usedByOff", row)?.len(),
        uses: rows.number("pub.uses", row)? as usize,
        specifier: rows.string("pub.spec", row)?,
        at: rows.string("pub.at", row)?,
        kind: rows.string("pub.kind", row)?,
        doc: rows.optional("pub.doc", row)?,
        in_area: match area { Some(area) => Some(published_sites_in(rows, row, area)?), None => None },
    })
}

pub(crate) fn export_hit(rows: &Rows, row: usize, field: u8) -> Option<ExportHit<'_>> {
    Some(ExportHit {
        field,
        row,
        kind: *rows.bytes("exp.kind").get(row)?,
        at: rows.string("exp.at", row)?,
        line: rows.number("exp.line", row)?,
        doc: rows.optional("exp.doc", row)?,
    })
}
