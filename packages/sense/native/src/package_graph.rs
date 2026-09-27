//! What a handful of packages take from each other, read from the committed
//! source index without handing a record to JavaScript.
//!
//! The question comes from `variance ask orient`: an agent has a few files in
//! hand and wants to know what the packages owning them are made of.
//! The index already holds the answer — every record keeps one resolved target
//! per request of its parse, in the parse's order, and the parse keeps what each
//! request binds — so the join `uses.ts` makes per importer is made here for
//! every importer that crosses into or out of an asked package. On a repository
//! of a hundred thousand files that is a hundred megabytes of segments, and the
//! only thing worth sending back is a few rows of shares.
//!
//! A unit of use is one importing file taking one name from one other package,
//! counted once however many requests say it. Shares are units over a total,
//! never counts against a threshold: four names at twenty percent each and
//! twenty at one percent are different packages, and a count cannot say which
//! one it is looking at. A name's total is everything the package exporting it
//! gets from outside, so every importer of every package an asked one takes
//! from is read too (`package_flows.rs` says why). A relative import inside one
//! package is not an edge between packages, and neither is anything a record
//! resolved outside the tracked tree.

// compass: variance-authority.reach.relations

use std::collections::{HashMap, HashSet};

use napi_derive::napi;
use rayon::prelude::*;

use crate::compact::Layer;
use crate::git::Oid;
use crate::index_chain::{read_chain, Chain};
use crate::package_owners::{owners, Owners, NO_OWNER};

use crate::package_flows::{flows, OrientFlows, Uses};

/// Where a file belongs: `undefined` for both when no named manifest sits above it.
#[napi(object)]
pub struct OrientOwner {
    pub package: Option<String>,
    pub directory: Option<String>,
    /// Whether the index holds a record for the file, which is what makes it a
    /// start point a question with `--from` can walk the imports from.
    pub indexed: bool,
}

/// One asked package, what it takes from the others and what they take from it.
#[napi(object)]
pub struct OrientPackage {
    pub package: String,
    pub directory: String,
    /// How many of its files the index holds a record for. With none, neither
    /// side was read, and an empty side is not a package nobody uses.
    pub indexed: u32,
    pub takes: OrientFlows,
    pub taken: OrientFlows,
}

#[napi(object)]
pub struct Orientation {
    /// One per asked file, in the order asked.
    pub owners: Vec<OrientOwner>,
    /// One per distinct package the asked files belong to, in the order first owned.
    pub packages: Vec<OrientPackage>,
    /// Records the committed chain holds.
    pub records: u32,
    /// Records whose file git no longer lists, or lists with other contents.
    pub stale: u32,
    /// Records the answer reads — crossing into or out of an asked package, or
    /// into a package one takes from — whose parse could not be joined to them.
    pub unread: u32,
    /// Segments the manifest names past the first one that could not be used.
    pub dropped: u32,
}

/// The tracked tree: each path and the object git holds for it.
pub(crate) struct Listed<'a> {
    pub paths: &'a [String],
    pub oids: &'a [Oid],
}

/// How many provider or importer rows, and names in each, an answer keeps.
#[derive(Clone, Copy)]
pub(crate) struct Limits {
    pub rows: usize,
    pub names: usize,
}

/// The packages owning `files`, read from the index at `index`; `undefined`
/// when nothing was ever published there. A chain that cannot be read, or a
/// checkout git cannot list, throws: neither is a smaller answer.
#[napi(catch_unwind)]
pub fn orient_packages(root: String, index: String, files: Vec<String>, rows: u32, names: u32) -> napi::Result<Option<Orientation>> {
    let limits = Limits { rows: rows as usize, names: names as usize };
    let (chain, snapshot) = std::thread::scope(|scope| {
        let snapshot = scope.spawn(|| crate::git::snapshot(&root));
        (read_chain(&index), snapshot.join().ok().flatten())
    });
    let fail = |error: String| napi::Error::from_reason(format!("the source index at {index} did not read: {error}"));
    let Some(chain) = chain.map_err(fail)? else { return Ok(None) };
    let snapshot = snapshot.ok_or_else(|| napi::Error::from_reason(format!("git could not list the tree at {root}")))?;
    let listed = Listed { paths: &snapshot.paths, oids: &snapshot.oids };
    orientation(&root, &chain, &listed, &files, limits).map(Some).map_err(fail)
}

/// A folded record: its layer and row.
type At = (usize, usize);

/// One folded record as the answer sees it.
struct Record<'a> {
    file: &'a str,
    at: At,
    /// `None` when git no longer lists the file.
    owner: Option<u32>,
    stale: bool,
    /// The packages other than its own that its targets belong to, once each.
    others: Vec<u32>,
}

/// One record the answer reads: it crosses into or out of an asked package, or
/// into a package an asked one takes from.
struct Crossing<'a> {
    file: &'a str,
    owner: u32,
    others: Vec<u32>,
    at: At,
    parse: Option<At>,
}

/// The packages an answer is about: the asked ones, and with them every
/// package one of them takes from, whose whole outside use is read so a name's
/// share can be over it.
struct Parties {
    asked: Vec<u32>,
    counted: Vec<bool>,
    unowned: bool,
}

impl Parties {
    fn new(asked: Vec<u32>, packages: usize) -> Parties {
        let mut parties = Parties { counted: vec![false; packages], unowned: false, asked: Vec::new() };
        for &owner in &asked {
            parties.count(owner);
        }
        parties.asked = asked;
        parties
    }

    fn asked(&self, owner: u32) -> Option<usize> {
        self.asked.iter().position(|&asked| asked == owner)
    }

    fn count(&mut self, owner: u32) {
        match self.counted.get_mut(owner as usize) {
            Some(counted) => *counted = true,
            None => self.unowned = true,
        }
    }

    fn counted(&self, owner: u32) -> bool {
        self.counted.get(owner as usize).copied().unwrap_or(self.unowned)
    }

    /// Whether a use from `owner` into `other` is one the answer counts.
    fn crosses(&self, owner: u32, other: u32) -> bool {
        other != owner && (self.asked(owner).is_some() || self.counted(other))
    }
}

pub(crate) fn orientation(root: &str, chain: &Chain, listed: &Listed, files: &[String], limits: Limits) -> Result<Orientation, String> {
    let (layers, owners) = rayon::join(
        || {
            chain
                .segments
                .par_iter()
                .enumerate()
                .map(|(at, bytes)| Layer::open(bytes).map_err(|error| format!("segment {at}: {error}")))
                .collect::<Result<Vec<_>, _>>()
        },
        || owners(root, listed.paths),
    );
    let layers = layers?;
    let owner_of = |file: &str| owners.files.get(file).map_or(NO_OWNER, |&(owner, _)| owner);

    let mut asked: Vec<u32> = Vec::new();
    for file in files {
        let owner = owner_of(file);
        if owner != NO_OWNER && !asked.contains(&owner) {
            asked.push(owner);
        }
    }

    // The fold is `compacted`'s: oldest layer first, its deletes, then its puts.
    let mut folded: HashMap<&str, At> = HashMap::new();
    for (at, layer) in layers.iter().enumerate() {
        let (stored, records) = (&layer.stored, &layer.records);
        for row in 0..records.deleted.len() {
            folded.remove(stored.text(records.deleted.at(row)));
        }
        for row in 0..records.file.len() {
            folded.insert(stored.text(records.file.at(row)), (at, row));
        }
    }
    let indexed: Vec<bool> = files.iter().map(|file| folded.contains_key(file.as_str())).collect();
    let folded: Vec<(&str, At)> = folded.into_iter().collect();

    let read: Vec<Record> = folded.par_iter().map(|&(file, at)| record(&layers, &owners, listed, file, at)).collect();
    let stale = read.iter().filter(|record| record.stale).count() as u32;
    let mut parties = Parties::new(asked, owners.packages.len());
    let mut indexed_in = vec![0u32; parties.asked.len()];
    for record in &read {
        if let Some(at) = record.owner.and_then(|owner| parties.asked(owner)) {
            indexed_in[at] += 1;
            for &other in &record.others {
                parties.count(other);
            }
        }
    }
    let mut crossings: Vec<Crossing> = read
        .into_iter()
        .filter_map(|record| {
            let owner = record.owner?;
            record.others.iter().any(|&other| parties.crosses(owner, other)).then_some(Crossing {
                file: record.file,
                owner,
                others: record.others,
                at: record.at,
                parse: None,
            })
        })
        .collect();
    join_parses(&layers, &mut crossings);

    let used: Vec<Option<Vec<(u32, &str)>>> =
        crossings.par_iter().map(|crossing| units(&layers, &owners, &parties, crossing)).collect();
    let mut takes: Vec<(Uses, u32)> = parties.asked.iter().map(|_| (Uses::new(), 0)).collect();
    let mut taken: Vec<(Uses, u32)> = parties.asked.iter().map(|_| (Uses::new(), 0)).collect();
    // Every unit each counted package gets from outside it: a name's total.
    let mut into: HashMap<u32, u32> = HashMap::new();
    let mut unread = 0;
    for (crossing, used) in crossings.iter().zip(used) {
        let from = parties.asked(crossing.owner);
        let Some(used) = used else {
            unread += 1;
            if let Some(at) = from {
                takes[at].1 += 1;
            }
            for at in crossing.others.iter().filter_map(|&other| parties.asked(other)) {
                taken[at].1 += 1;
            }
            continue;
        };
        for (other, name) in used {
            if let Some(at) = from {
                *takes[at].0.entry(other).or_default().entry(name).or_default() += 1;
            }
            if let Some(at) = parties.asked(other) {
                *taken[at].0.entry(crossing.owner).or_default().entry(name).or_default() += 1;
            }
            if parties.counted(other) {
                *into.entry(other).or_default() += 1;
            }
        }
    }

    let named = |owner: u32| owners.packages.get(owner as usize);
    let outside = |owner: u32| into.get(&owner).copied().unwrap_or(0);
    let packages = parties
        .asked
        .iter()
        .zip(takes.iter().zip(&taken).zip(indexed_in))
        .map(|(&owner, (((takes, takes_unread), (taken, taken_unread)), indexed))| OrientPackage {
            package: owners.packages[owner as usize].name.clone(),
            directory: owners.packages[owner as usize].directory.clone(),
            indexed,
            // A name taken from another package is over that package's outside
            // use; a name another package takes from this one is over its own.
            takes: flows(takes, &named, limits, *takes_unread, &outside),
            taken: flows(taken, &named, limits, *taken_unread, &|_| outside(owner)),
        })
        .collect();
    let owners_asked = files
        .iter()
        .zip(indexed)
        .map(|(file, indexed)| {
            let package = named(owner_of(file));
            OrientOwner {
                package: package.map(|package| package.name.clone()),
                directory: package.map(|package| package.directory.clone()),
                indexed,
            }
        })
        .collect();
    Ok(Orientation {
        owners: owners_asked,
        packages,
        records: folded.len() as u32,
        stale,
        unread,
        dropped: chain.dropped,
    })
}

/// Whether the record is stale, and which other packages its targets land in.
fn record<'a>(layers: &'a [Layer<'a>], owners: &Owners, listed: &Listed, file: &'a str, at: At) -> Record<'a> {
    let (layer, row) = at;
    let (stored, records) = (&layers[layer].stored, &layers[layer].records);
    let Some(&(owner, listing)) = owners.files.get(file) else {
        return Record { file, at, owner: None, stale: true, others: Vec::new() };
    };
    let stale = !stored.optional(records.digest.at(row)).is_some_and(|digest| names_object(digest, &listed.oids[listing as usize]));
    let mut others: Vec<u32> = Vec::new();
    if records.targets_present[row] == 1 {
        // TODO: a target outside the tracked tree — an installed package, which
        // the record keeps under `packages` rather than as a path — is not an edge
        // here yet, so what a package takes from npm is left out of its shares.
        for target in records.targets.range(row) {
            let other = stored.optional(records.target_path.at(target)).and_then(|path| owners.files.get(path));
            if let Some(&(other, _)) = other {
                if other != owner && !others.contains(&other) {
                    others.push(other);
                }
            }
        }
    }
    Record { file, at, owner: Some(owner), stale, others }
}

/// `git:<hex>` names exactly this object.
fn names_object(digest: &str, oid: &Oid) -> bool {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let Some(hex) = digest.strip_prefix("git:") else { return false };
    hex.len() == 40
        && oid
            .iter()
            .zip(hex.as_bytes().chunks(2))
            .all(|(byte, pair)| pair[0] == HEX[(byte >> 4) as usize] && pair[1] == HEX[(byte & 0x0f) as usize])
}

/// Each crossing's parse, found the way the fold would find it: the key is the
/// record's digest and its file's way (`keyFor` in `files.ts`), and the newest
/// layer that puts or deletes the key decides. Only the wanted keys are looked
/// at, so a question about three packages reads three packages' parses.
fn join_parses(layers: &[Layer], crossings: &mut [Crossing]) {
    let ways: Vec<String> = crossings.iter().map(|crossing| crate::index::way(crossing.file)).collect();
    let mut wanted: HashMap<&str, Vec<usize>> = HashMap::new();
    for (at, crossing) in crossings.iter().enumerate() {
        let (layer, row) = crossing.at;
        let (stored, records) = (&layers[layer].stored, &layers[layer].records);
        if let Some(digest) = stored.optional(records.digest.at(row)) {
            wanted.entry(digest).or_default().push(at);
        }
    }
    let (wanted, ways) = (&wanted, &ways);
    let hits: Vec<(Vec<usize>, Vec<(usize, usize)>)> = layers
        .par_iter()
        .map(|layer| {
            let (stored, parses) = (&layer.stored, &layer.parses);
            let matching = |digest: u32, way: u32, into: &mut Vec<usize>| {
                if let Some(held) = wanted.get(stored.text(digest)) {
                    let way = stored.text(way);
                    into.extend(held.iter().copied().filter(|&at| ways[at] == way));
                }
            };
            let (mut deleted, mut found, mut put) = (Vec::new(), Vec::new(), Vec::new());
            for row in 0..parses.deleted.len() {
                matching(parses.deleted.at(row), parses.deleted_way.at(row), &mut deleted);
            }
            for row in 0..parses.key.len() {
                matching(parses.key.at(row), parses.way.at(row), &mut found);
                put.extend(found.drain(..).map(|at| (at, row)));
            }
            (deleted, put)
        })
        .collect();
    for (layer, (deleted, put)) in hits.into_iter().enumerate() {
        for at in deleted {
            crossings[at].parse = None;
        }
        for (at, row) in put {
            crossings[at].parse = Some((layer, row));
        }
    }
}

/// The names one crossing record takes across a package line, once each per
/// other package; `None` when its parse is not there or does not line up with
/// its targets, which `usesByTarget` refuses in the same way.
fn units<'a>(layers: &'a [Layer<'a>], owners: &Owners, parties: &Parties, crossing: &Crossing) -> Option<Vec<(u32, &'a str)>> {
    let (record_layer, record_row) = crossing.at;
    let (parse_layer, parse_row) = crossing.parse?;
    let (stored, records) = (&layers[record_layer].stored, &layers[record_layer].records);
    let (text, parses) = (&layers[parse_layer].stored, &layers[parse_layer].parses);
    let (targets, requests) = (records.targets.range(record_row), parses.requests.range(parse_row));
    if targets.len() != requests.len() {
        return None;
    }
    let mut seen: HashSet<(u32, &str)> = HashSet::new();
    for (local, (target, request)) in targets.zip(requests.clone()).enumerate() {
        let Some(&(other, _)) = stored.optional(records.target_path.at(target)).and_then(|path| owners.files.get(path)) else {
            continue;
        };
        if !parties.crosses(crossing.owner, other) {
            continue;
        }
        let mut names: Vec<&str> = Vec::new();
        if text.text(parses.request_kind.at(request)) == "reexports" {
            // What a republishing request passes on is in the parse's exports,
            // not its bindings, for the reason `uses.ts` gives.
            // An export list the parse never recorded reads as the whole module.
            if parses.exports_present[parse_row] != 1 {
                names.push("*");
            }
            let value = text.text(parses.request_value.at(request));
            let listed = if parses.exports_present[parse_row] == 1 { parses.exports.range(parse_row) } else { 0..0 };
            for export in listed {
                if parses.export_type[export] != 1 && text.optional(parses.export_from.at(export)) == Some(value) {
                    names.push(text.optional(parses.export_imported.at(export)).unwrap_or("*"));
                }
            }
        } else {
            for binding in parses.request_bindings.range(request) {
                let imported = text.text(parses.binding_imported.at(binding));
                if imported != "*" {
                    names.push(imported);
                    continue;
                }
                // A namespace is charged with the members read off it, when
                // the parse saw any; otherwise it is the whole module.
                let before = names.len();
                for member in parses.members.range(parse_row) {
                    if parses.member_request.at(member) as usize == local {
                        names.push(text.text(parses.member_name.at(member)));
                    }
                }
                if names.len() == before {
                    names.push("*");
                }
            }
            if parses.request_bindings.range(request).is_empty() {
                names.push("*");
            }
        }
        seen.extend(names.into_iter().map(|name| (other, name)));
    }
    Some(seen.into_iter().collect())
}

#[cfg(all(test, unix))]
#[path = "package_graph_tests.rs"]
mod tests;
