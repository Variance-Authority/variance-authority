//! Which pairs of a refresh are what the last one left.
//!
//! A row of the lexicon is a function of the request the checkout writes for it, and of the installed files
//! its entries read. A pair whose written requests are the ones its rows already state, and none of whose
//! stamped inputs moved, is copied. Everything else is read again. Nothing else decides: not a count, not a
//! guess about which packages an edit could have touched.

// compass: variance-authority.reach.relations

use std::collections::{BTreeSet, HashMap, HashSet};

use super::{built, merge, Availability, Entry, Issue, Lexicon, Owner, Wanted};

/// What a pair yields: its rows, each with its entry and whether the entry was carried, and its issues.
pub(super) type Yield = (Vec<(Availability, Entry, bool)>, Vec<String>);

pub(super) struct Prior<'a> {
    rows: HashMap<(&'a str, &'a str), Vec<&'a Availability>>,
    entries: HashMap<&'a str, &'a Entry>,
    issues: HashMap<(&'a str, &'a str), Vec<&'a Issue>>,
    changed: &'a HashSet<String>,
}

impl<'a> Prior<'a> {
    pub(super) fn new(prior: &'a Lexicon, changed: &'a HashSet<String>) -> Self {
        let mut rows: HashMap<(&str, &str), Vec<&Availability>> = HashMap::new();
        for row in &prior.availability { rows.entry((row.owner.as_str(), row.package.as_str())).or_default().push(row); }
        let mut issues: HashMap<(&str, &str), Vec<&Issue>> = HashMap::new();
        for issue in &prior.issues { issues.entry((issue.owner.as_str(), issue.package.as_str())).or_default().push(issue); }
        Self { rows, entries: prior.entries.iter().map(|entry| (entry.id.as_str(), entry)).collect(), issues, changed }
    }

    /// The pair's rows as the last refresh left them, when nothing they came from has moved.
    pub(super) fn clean(&self, owner: &Owner, package: &str, wanted: &Wanted) -> Option<Yield> {
        let rows = self.rows.get(&(owner.manifest.as_str(), package))?;
        if merge::affects(self.changed, owner) { return None; }
        let imported: BTreeSet<&str> = rows.iter().filter(|row| row.imported == Some(true)).map(|row| row.specifier.as_str()).collect();
        if !imported.iter().copied().eq(wanted.imported.iter().map(String::as_str)) { return None; }
        let mut kept = Vec::with_capacity(rows.len());
        for &row in rows {
            if super::availability(owner, package, wanted, &row.specifier, row.entry.clone(), true) != *row { return None; }
            let entry = *self.entries.get(row.entry.as_str())?;
            if built::read_by(entry).iter().any(|path| self.changed.contains(path)) { return None; }
            kept.push((row.clone(), entry.clone(), true));
        }
        let issues = self.issues.get(&(owner.manifest.as_str(), package)).into_iter().flatten().map(|issue| issue.reason.clone()).collect();
        Some((kept, issues))
    }
}
