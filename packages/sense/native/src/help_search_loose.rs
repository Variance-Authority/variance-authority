//! Terms a query reaches by prefix or one UTF-16 edit, for the loose pass.

// compass: variance-authority.report.agent-surface

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use crate::compact::Layer;
use crate::help_declared::{declared, declared_terms, DeclaredName, Matching};
use crate::help_search_matches::{postings, term, tokens};
use crate::help_search_near::{Described, IndexedRow, Kind};
use crate::help_symbol_rows::Rows;

#[derive(Default)]
pub(crate) struct Loose {
    pub published: BTreeSet<usize>,
    pub exported: BTreeMap<usize, BTreeSet<usize>>,
    pub private: Vec<DeclaredName>,
}

pub(crate) fn matches(root: &str, rows: &Rows, layers: &[Layer], query: &str, files: Option<&[String]>, already: &BTreeSet<usize>, described: &Described) -> Option<Loose> {
    let wanted: Vec<_> = tokens(query).map(|word| (word, word.encode_utf16().collect::<Vec<_>>())).collect();
    if wanted.is_empty() { return Some(Loose::default()) }
    let files_set = files.map(|paths| paths.iter().map(String::as_str).collect::<HashSet<_>>());
    let admitted = |kind, row| row_in(rows, files_set.as_ref(), IndexedRow { kind, row });
    let seen = |name| already.contains(&name) || described.names.contains(&name);
    let mut known = HashMap::new();
    let mut admit_name = |name| -> Option<bool> {
        if let Some(&admitted) = known.get(&name) { return Some(admitted) }
        let published = postings(rows, "names.pubOff", "names.pub", name)?.into_iter().any(|row| admitted(Kind::Published, row));
        let exported = postings(rows, "names.expOff", "names.exp", name)?.into_iter().any(|row| admitted(Kind::Exported, row));
        known.insert(name, published || exported);
        Some(published || exported)
    };

    let mut by_name = HashSet::new();
    let mut term_groups = vec![HashSet::new(); wanted.len()];
    let mut via_doc = BTreeMap::<usize, BTreeSet<usize>>::new();
    for id in 0..rows.column("terms.off").len().checked_sub(1)? {
        let term = term(rows, id)?;
        let units: Vec<_> = term.encode_utf16().collect();
        for (at, (word, sought)) in wanted.iter().enumerate() {
            if !fits(term, &units, word, sought) { continue }
            let reached = &mut term_groups[at];
            for name in postings(rows, "terms.nameOff", "terms.name", id)? {
                if !seen(name) && admit_name(name)? {
                    reached.insert(name);
                    by_name.insert(name);
                }
            }
            for (kind, offset, values, name_col) in [
                (Kind::Published, "terms.pubOff", "terms.pub", "pub.name"),
                (Kind::Exported, "terms.expOff", "terms.exp", "exp.name"),
            ] {
                for row in postings(rows, offset, values, id)? {
                    let name = rows.number(name_col, row)? as usize;
                    if !seen(name) && admitted(kind, row) {
                        reached.insert(name);
                        if kind == Kind::Exported { via_doc.entry(name).or_default().insert(row); }
                    }
                }
            }
        }
    }
    let mut term_groups = term_groups.into_iter();
    let mut reached = term_groups.next()?;
    for group in term_groups { reached.retain(|name| group.contains(name)); }

    let mut loose = Loose::default();
    for name in reached {
        let published: Vec<_> = postings(rows, "names.pubOff", "names.pub", name)?.into_iter().filter(|&row| admitted(Kind::Published, row)).collect();
        if !published.is_empty() {
            loose.published.extend(published);
            continue;
        }
        let rows = if by_name.contains(&name) || !via_doc.contains_key(&name) {
            postings(rows, "names.expOff", "names.exp", name)?.into_iter().filter(|&row| admitted(Kind::Exported, row)).collect()
        } else { via_doc.remove(&name).unwrap_or_default() };
        if !rows.is_empty() { loose.exported.insert(name, rows); }
    }

    let mut groups = vec![Vec::new(); wanted.len()];
    for term in declared_terms(layers, files) {
        let units: Vec<_> = term.encode_utf16().collect();
        for (at, (word, sought)) in wanted.iter().enumerate() {
            if fits(&term, &units, word, sought) { groups[at].push(term.clone()); }
        }
    }
    if groups.iter().all(|group| !group.is_empty()) {
        let read = declared(root, layers, query, Matching::Terms { groups }, files);
        loose.private = read.names.into_iter()
            .filter(|one| !described.private.contains(&(one.at.clone(), one.line, one.name.clone())))
            .collect();
    }
    Some(loose)
}

pub(crate) fn row_in(rows: &Rows, files: Option<&HashSet<&str>>, row: IndexedRow) -> bool {
    let Some(files) = files else { return true };
    match row.kind {
        Kind::Published => rows.range("pub.sitesOff", row.row).is_some_and(|mut sites| sites.any(|site| rows.string("use.at", site).is_some_and(|file| files.contains(file)))),
        Kind::Exported => rows.string("exp.at", row.row).is_some_and(|file| files.contains(file)),
    }
}

pub(crate) fn fits(term: &str, units: &[u16], word: &str, sought: &[u16]) -> bool {
    term.starts_with(word) || (sought.len() >= 3 && within_one(units, sought))
}

fn within_one(a: &[u16], b: &[u16]) -> bool {
    if a.len().abs_diff(b.len()) > 1 { return false }
    let start = a.iter().zip(b).take_while(|(a, b)| a == b).count();
    match a.len().cmp(&b.len()) {
        std::cmp::Ordering::Equal => start == a.len() || a[start + 1..] == b[start + 1..],
        std::cmp::Ordering::Less => a[start..] == b[start + 1..],
        std::cmp::Ordering::Greater => a[start + 1..] == b[start..],
    }
}
