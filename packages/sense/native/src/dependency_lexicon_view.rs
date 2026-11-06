//! The rows a question reads: the catalogue's pairs and offers, joined with the requests the sites file holds.
//!
//! A file's owner is the nearest manifest directory above it, asked once per directory. A pair is shown when its
//! manifest declares the package or a source under it imports it, and an offer when the installed manifest opens
//! it or a source imports it, so a pair or an offer the sites no longer ask for is not an answer, whatever the
//! catalogue still holds.

// compass: variance-authority.reach.relations

use std::cell::OnceCell;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

use super::catalogue::Catalogue;
use super::codec::read_api;
use super::sites::{sites, State};
use super::{Api, Owner};
use crate::package_owners::{directory_owner, parent, NO_OWNER};

/// The owner manifest of each path, by the nearest owner directory above it.
pub(super) struct Owning<'a> {
    named: HashMap<&'a str, u32>,
    known: HashMap<&'a str, u32>,
}

impl<'a> Owning<'a> {
    pub fn new(owners: &'a [Owner]) -> Self {
        Self { named: owners.iter().enumerate().map(|(at, owner)| (owner.directory.as_str(), at as u32)).collect(), known: HashMap::new() }
    }

    /// A file's owner row, or [`NO_OWNER`].
    pub fn file(&mut self, file: &'a str) -> u32 { directory_owner(parent(file), &self.named, &mut self.known) }

    /// The owner of a path a question stands at, which may name a directory as well as a file.
    pub fn path(&mut self, path: &'a str) -> u32 {
        match self.named.get(path.trim_end_matches('/')) { Some(&owner) => owner, None => self.file(path) }
    }
}

/// One row a question reads.
pub(super) struct Row<'a> {
    pub owner: &'a str,
    pub package: &'a str,
    pub specifier: &'a str,
    pub entry: u32,
    /// Absent when no sites file was read.
    pub imported: Option<bool>,
    pub declared_as: Option<&'static str>,
    pub imports: Option<u32>,
    /// The first written request, by path and then line, as `file:line`.
    pub site: Option<String>,
}

pub(super) struct Issue<'a> { pub owner: &'a str, pub package: &'a str, pub reason: &'a str }

/// The two lexicon files' bytes, or `None` when no catalogue was published.
pub(super) fn read(path: &str, sites: &str) -> napi::Result<Option<(Vec<u8>, Option<Vec<u8>>)>> {
    let catalogue = match fs::read(Path::new(path)) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(napi::Error::from_reason(error.to_string())),
    };
    Ok(Some((catalogue, fs::read(Path::new(sites)).ok())))
}

pub(super) struct Lexicon<'a> {
    pub catalogue: Catalogue<'a>,
    pub owners: Vec<Owner>,
    sites: Option<State<'a>>,
    apis: Vec<OnceCell<Option<Api>>>,
}

impl<'a> Lexicon<'a> {
    pub fn open(catalogue: &'a [u8], sites: Option<&'a [u8]>) -> napi::Result<Self> {
        let catalogue = Catalogue::open(catalogue)
            .map_err(|error| napi::Error::from_reason(format!("the dependency lexicon did not read: {error}; `variance index` rebuilds it")))?;
        let apis = (0..catalogue.entries()).map(|_| OnceCell::new()).collect();
        Ok(Self { owners: catalogue.owners(), sites: sites.and_then(State::read), catalogue, apis })
    }

    /// An entry's reading, decoded the first time a question reaches it.
    pub fn api(&self, entry: u32) -> Option<&Api> {
        self.apis[entry as usize].get_or_init(|| read_api(self.catalogue.entry_blob(entry as usize))).as_ref()
    }

    pub fn entry_id(&self, entry: u32) -> &'a str { self.catalogue.entry_id(entry as usize) }

    /// The owner manifests of `files`: a path no manifest sits above is the root's.
    pub fn located<'f>(&'a self, files: &'f [String]) -> HashSet<&'a str> where 'f: 'a {
        let mut owning = Owning::new(&self.owners);
        files.iter().map(|file| match owning.path(file) {
            NO_OWNER => "package.json",
            owner => self.owners[owner as usize].manifest.as_str(),
        }).collect()
    }

    /// Every row and issue under the `allowed` owners, rows by owner and then specifier.
    pub fn rows(&'a self, allowed: Option<&HashSet<&str>>) -> (Vec<Row<'a>>, Vec<Issue<'a>>) {
        let shown = |owner: u32| allowed.is_none_or(|allowed| allowed.contains(self.owners[owner as usize].manifest.as_str()));
        let names: HashSet<&str> = self.owners.iter().map(|owner| owner.name.as_str()).collect();
        // Per owner, package and specifier: how many requests, and the first of them.
        let mut asked = HashMap::<(u32, &str, &str), (u32, &str, u32)>::new();
        if let Some(state) = &self.sites {
            let mut owning = Owning::new(&self.owners);
            for (file, rows) in state.files() {
                let owner = owning.file(file);
                if owner == NO_OWNER || !shown(owner) { continue; }
                for site in sites(rows).filter(|site| !names.contains(site.package)) {
                    let held = asked.entry((owner, site.package, site.specifier)).or_insert((0, file, site.line));
                    held.0 += 1;
                    if crate::order::code_unit(file, held.1).then(site.line.cmp(&held.2)).is_lt() { (held.1, held.2) = (file, site.line); }
                }
            }
        }
        let mut imported = HashMap::<(u32, &str), HashSet<&str>>::new();
        for &(owner, package, specifier) in asked.keys() { imported.entry((owner, package)).or_default().insert(specifier); }
        let indexed = self.sites.is_some();
        let (mut rows, mut issues) = (Vec::new(), Vec::new());
        for pair in 0..self.catalogue.pairs() {
            let (owner, package, install) = self.catalogue.pair(pair);
            if !shown(owner) { continue; }
            let manifest = &self.owners[owner as usize];
            let declared_as = manifest.kinds.get(package).copied();
            let specifiers = imported.get(&(owner, package));
            if declared_as.is_none() && specifiers.is_none() { continue; }
            for (specifier, entry, opened) in self.catalogue.offers(install as usize) {
                let asked_for = specifiers.is_some_and(|specifiers| specifiers.contains(specifier));
                if !opened && !asked_for { continue; }
                let request = asked.get(&(owner, package, specifier));
                rows.push(Row { owner: manifest.manifest.as_str(), package, specifier, entry,
                    imported: indexed.then_some(asked_for), declared_as, imports: indexed.then(|| request.map_or(0, |request| request.0)),
                    site: request.map(|request| format!("{}:{}", request.1, request.2)) });
            }
            issues.extend(self.catalogue.issues(pair).map(|reason| Issue { owner: manifest.manifest.as_str(), package, reason }));
        }
        rows.sort_by(|a, b| (a.owner, a.specifier).cmp(&(b.owner, b.specifier)));
        issues.sort_by(|a, b| (a.owner, a.package, a.reason).cmp(&(b.owner, b.package, b.reason)));
        issues.dedup_by(|a, b| (a.owner, a.package, a.reason) == (b.owner, b.package, b.reason));
        (rows, issues)
    }
}

/// Whether every request in `files` is a pair and an offer the catalogue holds, so the rows it already states
/// answer for them.
pub(super) fn covers<'f>(catalogue: &Catalogue, owners: &[Owner], names: &HashSet<&str>,
    files: impl Iterator<Item = (&'f str, Vec<(&'f str, &'f str)>)>) -> bool {
    let pairs: HashMap<(u32, &str), u32> = (0..catalogue.pairs()).map(|pair| { let (owner, package, install) = catalogue.pair(pair); ((owner, package), install) }).collect();
    let mut offered = HashMap::<u32, HashSet<&str>>::new();
    let mut owning = Owning::new(owners);
    for (file, requests) in files {
        let owner = owning.file(file);
        if owner == NO_OWNER { continue; }
        for (package, specifier) in requests.into_iter().filter(|(package, _)| !names.contains(package)) {
            let Some(&install) = pairs.get(&(owner, package)) else { return false };
            let offers = offered.entry(install).or_insert_with(|| catalogue.offers(install as usize).map(|offer| offer.0).collect());
            if !offers.contains(specifier) { return false; }
        }
    }
    true
}
