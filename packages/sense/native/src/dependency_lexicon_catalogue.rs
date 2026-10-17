//! The catalogue: what the manifests ask for and what the installed packages offer, kept in the segment framing
//! and read where it lies.
//!
//! It holds no request a source file writes. Those are the sites file's, so an edit that asks for nothing the
//! catalogue lacks leaves this file's bytes as they were. A pair is an owner manifest and a package it declares
//! or imports; it names the install it resolved to. An install is one installed package as the pairs that resolve
//! to it share it, and it offers specifiers: the subpaths its manifest opens and every one a source imported. An
//! offer names the entry its specifier resolves to, and an entry's reading is a blob decoded only when a question
//! reaches it.

// compass: variance-authority.reach.relations

use std::collections::BTreeMap;

use crate::segment::{encode_as, u32s, u8s, Collected, Strings};
use crate::stored::{same_length, Stored, U32s};

use super::Owner;

const FORMAT: &str = "variance-authority-dependency-catalogue";
/// 2: a purpose holds stems cut to a fixed point, so a catalogue of one-pass stems is read again.
/// 3: an owner is every tracked manifest, not only a member the root's `workspaces` list, so a catalogue whose owners
/// were cut by `workspaces` is made again.
const VERSION: u8 = 3;
/// The version whose stems this release compares: a catalogue written before it answers no described question.
const STEMS: u8 = 2;
/// The oldest version still read: 1 lays its columns out as 2 does, so every question but a described one answers
/// from it, and a refresh writes it again whole.
const OLDEST: u8 = 1;
const KINDS: [&str; 4] = ["dependency", "optional", "peer", "dev"];

pub(super) struct MadePair { pub owner: u32, pub package: String, pub install: u32, pub issues: Vec<String> }
pub(super) struct MadeInstall { pub key: String, pub package: String, pub offers: Vec<(String, u32, bool)> }

/// A catalogue as a refresh made it, before it is written.
pub(super) struct Made {
    pub owners: Vec<Owner>,
    pub manifests: Vec<String>,
    pub internal: Vec<String>,
    pub pairs: Vec<MadePair>,
    pub installs: Vec<MadeInstall>,
    pub entries: Vec<(String, Vec<u8>)>,
    pub stamps: Vec<(String, String)>,
    /// Packages, entrypoints, the entries that resolved to one, and what was unavailable.
    pub summary: [u32; 4],
}

fn offsets<T>(groups: &[T], length: impl Fn(&T) -> usize) -> Vec<u32> {
    let mut offsets = Vec::with_capacity(groups.len() + 1);
    offsets.push(0);
    let mut end = 0;
    for group in groups { end += length(group) as u32; offsets.push(end); }
    offsets
}

impl Made {
    pub fn encode(&self) -> Vec<u8> {
        let mut collected = Collected::default();
        for owner in &self.owners {
            collected.extend([owner.manifest.as_str(), owner.directory.as_str(), owner.name.as_str()]);
            collected.extend(owner.kinds.keys().map(String::as_str));
        }
        collected.extend(self.manifests.iter().map(String::as_str));
        collected.extend(self.internal.iter().map(String::as_str));
        for pair in &self.pairs { collected.insert(&pair.package); collected.extend(pair.issues.iter().map(String::as_str)); }
        for install in &self.installs {
            collected.extend([install.key.as_str(), install.package.as_str()]);
            collected.extend(install.offers.iter().map(|offer| offer.0.as_str()));
        }
        collected.extend(self.entries.iter().map(|entry| entry.0.as_str()));
        for (at, value) in &self.stamps { collected.extend([at.as_str(), value.as_str()]); }
        let mut strings = Strings::of(collected);
        let ids = |values: &mut dyn Iterator<Item = &str>| values.map(|value| strings.id(value)).collect::<Vec<_>>();
        let kinds: Vec<_> = self.owners.iter().flat_map(|owner| owner.kinds.iter()).collect();
        let offers: Vec<_> = self.installs.iter().flat_map(|install| install.offers.iter()).collect();
        let mut blob = Vec::new();
        let mut blob_offsets = vec![0u32];
        for (_, bytes) in &self.entries { blob.extend_from_slice(bytes); blob_offsets.push(blob.len() as u32); }
        let columns = vec![
            u32s("owners.manifest", ids(&mut self.owners.iter().map(|owner| owner.manifest.as_str()))),
            u32s("owners.directory", ids(&mut self.owners.iter().map(|owner| owner.directory.as_str()))),
            u32s("owners.name", ids(&mut self.owners.iter().map(|owner| owner.name.as_str()))),
            u32s("owners.kinds", offsets(&self.owners, |owner| owner.kinds.len())),
            u32s("kinds.package", ids(&mut kinds.iter().map(|(package, _)| package.as_str()))),
            u8s("kinds.kind", kinds.iter().map(|(_, kind)| KINDS.iter().position(|known| known == *kind).unwrap_or(3) as u8).collect()),
            u32s("manifests", ids(&mut self.manifests.iter().map(String::as_str))),
            u32s("internal", ids(&mut self.internal.iter().map(String::as_str))),
            u32s("pairs.owner", self.pairs.iter().map(|pair| pair.owner).collect()),
            u32s("pairs.package", ids(&mut self.pairs.iter().map(|pair| pair.package.as_str()))),
            u32s("pairs.install", self.pairs.iter().map(|pair| pair.install).collect()),
            u32s("pairs.issues", offsets(&self.pairs, |pair| pair.issues.len())),
            u32s("issues", ids(&mut self.pairs.iter().flat_map(|pair| pair.issues.iter().map(String::as_str)))),
            u32s("installs.key", ids(&mut self.installs.iter().map(|install| install.key.as_str()))),
            u32s("installs.package", ids(&mut self.installs.iter().map(|install| install.package.as_str()))),
            u32s("installs.offers", offsets(&self.installs, |install| install.offers.len())),
            u32s("offers.specifier", ids(&mut offers.iter().map(|offer| offer.0.as_str()))),
            u32s("offers.entry", offers.iter().map(|offer| offer.1).collect()),
            u8s("offers.opened", offers.iter().map(|offer| u8::from(offer.2)).collect()),
            u32s("entries.id", ids(&mut self.entries.iter().map(|entry| entry.0.as_str()))),
            u32s("entries.blob", blob_offsets),
            u8s("blob", blob),
            u32s("stamps.path", ids(&mut self.stamps.iter().map(|stamp| stamp.0.as_str()))),
            u32s("stamps.value", ids(&mut self.stamps.iter().map(|stamp| stamp.1.as_str()))),
            u32s("summary", self.summary.to_vec()),
        ];
        let mut all = strings.columns().into_iter().collect::<Vec<_>>();
        all.extend(columns);
        encode_as(FORMAT, VERSION, all)
    }
}

/// A catalogue read in place.
pub(super) struct Catalogue<'a> {
    stored: Stored<'a>,
    written: u8,
    owners: [U32s<'a>; 4],
    kinds: (U32s<'a>, &'a [u8]),
    manifests: U32s<'a>,
    internal: U32s<'a>,
    pairs: [U32s<'a>; 4],
    issues: U32s<'a>,
    installs: [U32s<'a>; 3],
    offers: (U32s<'a>, U32s<'a>, &'a [u8]),
    entries: (U32s<'a>, U32s<'a>, &'a [u8]),
    stamps: (U32s<'a>, U32s<'a>),
    summary: U32s<'a>,
}

impl<'a> Catalogue<'a> {
    pub fn open(bytes: &'a [u8]) -> Result<Self, String> {
        let (stored, written) = Stored::open_since(bytes, FORMAT, OLDEST, VERSION)?;
        let owner_rows = stored.u32s("owners.manifest")?.len();
        let kinds = stored.u32s("kinds.package")?;
        let pair_rows = stored.u32s("pairs.owner")?.len();
        let issues = stored.u32s("issues")?;
        let install_rows = stored.u32s("installs.key")?.len();
        let offers = stored.u32s("offers.specifier")?;
        let entry_rows = stored.u32s("entries.id")?.len();
        let blob = stored.u8s("blob")?;
        let catalogue = Catalogue {
            owners: [stored.u32s("owners.manifest")?, stored.u32s("owners.directory")?, stored.u32s("owners.name")?,
                stored.offsets("owners.kinds", owner_rows, kinds.len())?],
            kinds: (kinds, stored.u8s("kinds.kind")?),
            manifests: stored.u32s("manifests")?,
            internal: stored.u32s("internal")?,
            pairs: [stored.u32s("pairs.owner")?, stored.u32s("pairs.package")?, stored.u32s("pairs.install")?,
                stored.offsets("pairs.issues", pair_rows, issues.len())?],
            issues,
            installs: [stored.u32s("installs.key")?, stored.u32s("installs.package")?,
                stored.offsets("installs.offers", install_rows, offers.len())?],
            offers: (offers, stored.u32s("offers.entry")?, stored.u8s("offers.opened")?),
            entries: (stored.u32s("entries.id")?, stored.offsets("entries.blob", entry_rows, blob.len())?, blob),
            stamps: (stored.u32s("stamps.path")?, stored.u32s("stamps.value")?),
            summary: stored.u32s("summary")?,
            stored,
            written,
        };
        let c = &catalogue;
        same_length(owner_rows, &[("owners.directory", c.owners[1].len()), ("owners.name", c.owners[2].len())])?;
        same_length(c.kinds.0.len(), &[("kinds.kind", c.kinds.1.len())])?;
        same_length(pair_rows, &[("pairs.package", c.pairs[1].len()), ("pairs.install", c.pairs[2].len())])?;
        same_length(install_rows, &[("installs.package", c.installs[1].len())])?;
        same_length(c.offers.0.len(), &[("offers.entry", c.offers.1.len()), ("offers.opened", c.offers.2.len())])?;
        same_length(c.stamps.0.len(), &[("stamps.value", c.stamps.1.len())])?;
        same_length(4, &[("summary", c.summary.len())])?;
        let refers = (0..pair_rows).all(|row| (c.pairs[0].at(row) as usize) < owner_rows && (c.pairs[2].at(row) as usize) < install_rows)
            && (0..c.offers.1.len()).all(|row| (c.offers.1.at(row) as usize) < entry_rows);
        if !refers { return Err("a row that names a row past its table".to_owned()); }
        Ok(catalogue)
    }

    fn text(&self, column: &U32s, row: usize) -> &'a str { self.stored.text(column.at(row)) }

    pub fn owners(&self) -> Vec<Owner> {
        (0..self.owners[0].len()).map(|row| {
            let kinds: BTreeMap<String, &'static str> = self.owners[3].range(row)
                .map(|at| (self.text(&self.kinds.0, at).to_owned(), KINDS[(self.kinds.1[at] as usize).min(3)])).collect();
            Owner { manifest: self.text(&self.owners[0], row).to_owned(), directory: self.text(&self.owners[1], row).to_owned(),
                name: self.text(&self.owners[2], row).to_owned(), declared: kinds.keys().cloned().collect(), kinds }
        }).collect()
    }

    pub fn manifests(&self) -> Vec<&'a str> { (0..self.manifests.len()).map(|row| self.text(&self.manifests, row)).collect() }

    pub fn internal(&self) -> Vec<&'a str> { (0..self.internal.len()).map(|row| self.text(&self.internal, row)).collect() }

    pub fn pairs(&self) -> usize { self.pairs[0].len() }

    /// A pair's owner row, package, and install row.
    pub fn pair(&self, row: usize) -> (u32, &'a str, u32) {
        (self.pairs[0].at(row), self.text(&self.pairs[1], row), self.pairs[2].at(row))
    }

    pub fn issues(&self, pair: usize) -> impl Iterator<Item = &'a str> + '_ {
        self.pairs[3].range(pair).map(|at| self.text(&self.issues, at))
    }

    /// An install's offers: each specifier, its entry row, and whether the manifest opens it.
    pub fn offers(&self, install: usize) -> impl Iterator<Item = (&'a str, u32, bool)> + '_ {
        self.installs[2].range(install).map(|at| (self.text(&self.offers.0, at), self.offers.1.at(at), self.offers.2[at] != 0))
    }

    pub fn entries(&self) -> usize { self.entries.0.len() }

    pub fn entry_id(&self, row: usize) -> &'a str { self.text(&self.entries.0, row) }

    pub fn entry_blob(&self, row: usize) -> &'a [u8] { &self.entries.2[self.entries.1.range(row)] }

    pub fn stamps(&self) -> Vec<(&'a str, &'a str)> {
        (0..self.stamps.0.len()).map(|row| (self.text(&self.stamps.0, row), self.text(&self.stamps.1, row))).collect()
    }

    pub fn summary(&self) -> [u32; 4] { [0, 1, 2, 3].map(|at| self.summary.at(at)) }

    /// The version this catalogue was written at, when it is older than the one this release writes: its columns
    /// read the same, and a refresh reuses nothing in it.
    pub fn older(&self) -> Option<u8> { (self.written < VERSION).then_some(self.written) }

    /// The version this catalogue was written at, when its stems were cut another way than this release cuts them.
    pub fn stems_older(&self) -> Option<u8> { (self.written < STEMS).then_some(self.written) }
}
