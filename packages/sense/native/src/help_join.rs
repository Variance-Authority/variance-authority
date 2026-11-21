//! The documented surface, joined where the publish encodes it: each opening's
//! names beside who uses them, and what a README says of the names nothing is
//! written above.
//!
//! The one join: the publish off the index and the walk with no index
//! (`joinWalkedHelp`) both run it. Nothing it joins crosses into JavaScript:
//! the entries borrow the reading's uses and declarations, and go straight to
//! the encoder.

// compass: variance-authority.report.agent-surface

use std::collections::{HashMap, HashSet};
use std::path::Path;

use rayon::prelude::*;

use crate::help_mention::{mention, Mention};
use crate::help_names::PublishedName;
use crate::help_readme::{nearest, readmes};
use crate::help_store::{EntryRef, MentionRef, OpeningRef, PackageRef, Packages, UseRef};
use crate::help_usage::NameUse;
use crate::order::code_unit;

/// One package as the manifests publish it, and its openings in their order.
pub(crate) struct Skeleton<'a> {
    pub(crate) name: &'a str,
    pub(crate) entry: bool,
    pub(crate) openings: Vec<OpeningSkeleton<'a>>,
}

/// One opening: its subpath, its file relative to the root and the specifier
/// a search line prints for it.
pub(crate) struct OpeningSkeleton<'a> {
    pub(crate) subpath: &'a str,
    pub(crate) source: &'a str,
    pub(crate) spec: &'a str,
}

/// The uses through each `<package> .<subpath>` key, by the name they take, in
/// the order the reading found them.
type Grouped<'a> = HashMap<&'a str, HashMap<&'a str, Vec<&'a NameUse>>>;

/// What a README says of each name, by the file its first kind is declared in;
/// a name no README mentions is not held.
pub(crate) type Mentions<'a> = HashMap<(&'a str, &'a str), Mention>;

/// Entries a run of packages holds before it is handed to the encoder: enough
/// for every core, and one run's joined rows at a time.
const RUN: usize = 1 << 14;

/// The names of the openings of `packages`, given flat in their order as
/// `names`, whose first kind has no doc and whose nearest README under
/// `root` names them, looked up once per declaring file and name. `Err` names
/// a README that is there and could not be read.
pub(crate) fn mentions<'a>(root: &Path, names: &'a [Vec<PublishedName>]) -> Result<Mentions<'a>, String> {
    let mut asked: Vec<(&str, &str)> = Vec::new();
    let mut seen: HashSet<(&str, &str)> = HashSet::new();
    for name in names.iter().flatten() {
        if let Some(first) = name.kinds.first() {
            if first.doc.is_none() && seen.insert((first.at.as_str(), name.name.as_str())) {
                asked.push((first.at.as_str(), name.name.as_str()));
            }
        }
    }
    let held = readmes(root, asked.iter().map(|(at, _)| *at))?;
    Ok(asked
        .into_par_iter()
        .filter_map(|(at, name)| Some(((at, name), mention(nearest(&held, at)?, name)?)))
        .collect())
}

/// Every package of `skeleton`, its openings' entries joined: `names` holds
/// each opening's names, flat in the skeleton's order, and `uses` every use
/// through an opened key. Entries are ordered by how many packages reach for
/// them, then how often, then by name in code units. Joined a run of packages
/// at a time, as the encoder asks.
pub(crate) struct Joined<'a> {
    skeleton: Vec<Skeleton<'a>>,
    names: &'a [Vec<PublishedName>],
    grouped: Grouped<'a>,
    mentions: &'a Mentions<'a>,
    /// The kinds of the names declared as several, each written once.
    kinds: Vec<String>,
    /// By each name's place in `names`, flat: its kind in `kinds`, or `NONE`
    /// for a name of one kind.
    kind_of: Vec<u32>,
    /// The entries at which a run closes.
    run: usize,
}

/// No kind of `kinds`: the name has one kind of its own.
const NONE: u32 = u32::MAX;

impl<'a> Joined<'a> {
    pub(crate) fn new(skeleton: Vec<Skeleton<'a>>, names: &'a [Vec<PublishedName>], uses: &'a [NameUse], mentions: &'a Mentions<'a>) -> Result<Self, String> {
        let openings: usize = skeleton.iter().map(|owner| owner.openings.len()).sum();
        if openings != names.len() {
            return Err(format!("the reading holds the names of {} openings, and {} were asked about", names.len(), openings));
        }
        let mut grouped: Grouped = HashMap::new();
        for held in uses {
            grouped.entry(held.key.as_str()).or_default().entry(held.name.as_str()).or_default().push(held);
        }
        let (mut kinds, mut at): (Vec<String>, HashMap<String, u32>) = (Vec::new(), HashMap::new());
        let mut kind_of = Vec::with_capacity(names.iter().map(Vec::len).sum());
        for name in names.iter().flatten() {
            kind_of.push(match name.kinds.len() {
                0 => return Err(format!("`{}` was reached with no declaration behind it", name.name)),
                1 => NONE,
                _ => *at.entry(several(name)).or_insert_with_key(|joined| {
                    kinds.push(joined.clone());
                    kinds.len() as u32 - 1
                }),
            });
        }
        Ok(Joined {
            skeleton,
            names,
            grouped,
            mentions,
            kinds,
            kind_of,
            run: RUN,
        })
    }

    /// The same join, closing its runs at `run` entries.
    #[cfg(test)]
    pub(crate) fn in_runs_of(self, run: usize) -> Self {
        Joined { run, ..self }
    }
}

impl Packages for Joined<'_> {
    fn names(&self) -> Vec<&str> {
        self.names.iter().flatten().map(|name| name.name.as_str()).collect()
    }

    fn each<'s>(&'s self, visit: &mut dyn FnMut(&[PackageRef<'s>])) {
        let (mut package, mut opening, mut name) = (0, 0, 0);
        while package < self.skeleton.len() {
            let (from, first, mut held) = (package, opening, 0);
            while package < self.skeleton.len() && (package == from || held < self.run) {
                let count = self.skeleton[package].openings.len();
                held += self.names[opening..opening + count].iter().map(Vec::len).sum::<usize>();
                (package, opening) = (package + 1, opening + count);
            }
            let owners = &self.skeleton[from..package];
            // Each opening of the run, and the place of its first name in `names`, flat.
            let flat: Vec<(&Skeleton, &OpeningSkeleton, usize)> = owners
                .iter()
                .flat_map(|owner| owner.openings.iter().map(move |opening| (owner, opening)))
                .zip(&self.names[first..opening])
                .map(|((owner, opening), names)| {
                    name += names.len();
                    (owner, opening, name - names.len())
                })
                .collect();
            let openings: Vec<OpeningRef> = flat
                .par_iter()
                .zip(self.names[first..opening].par_iter())
                .map(|((owner, opening, at), names)| self.opening_of(owner.name, opening, names, *at, self.grouped.get(format!("{} {}", owner.name, opening.subpath).as_str())))
                .collect();
            let mut openings = openings.into_iter();
            let run: Vec<PackageRef> = owners
                .iter()
                .map(|owner| PackageRef {
                    name: owner.name,
                    entry: owner.entry,
                    openings: openings.by_ref().take(owner.openings.len()).collect(),
                })
                .collect();
            visit(&run);
        }
    }
}

/// The kind of a name declared as several: each kind once, in code units, joined by `+`.
fn several(name: &PublishedName) -> String {
    let mut kinds: Vec<&str> = name.kinds.iter().map(|kind| kind.kind.as_str()).collect();
    kinds.sort_by(|a, b| code_unit(a, b));
    kinds.join("+")
}

impl<'a> Joined<'a> {
    fn opening_of<'s>(
        &'s self,
        owner: &'s str,
        opening: &OpeningSkeleton<'s>,
        names: &'s [PublishedName],
        at: usize,
        by_name: Option<&HashMap<&'s str, Vec<&'s NameUse>>>,
    ) -> OpeningRef<'s> {
        let held = |name: &str| by_name.and_then(|by_name| by_name.get(name)).map_or(&[][..], Vec::as_slice);
        let mut entries: Vec<EntryRef> = names.iter().zip(&self.kind_of[at..at + names.len()]).map(|(name, kind)| self.entry_of(owner, name, *kind, held(&name.name))).collect();
        entries.sort_by(|a, b| b.used_by.len().cmp(&a.used_by.len()).then(b.uses.cmp(&a.uses)).then_with(|| code_unit(a.name, b.name)));
        OpeningRef {
            subpath: opening.subpath,
            source: opening.source,
            spec: opening.spec,
            entries,
            whole: held("*").iter().map(|held| UseRef::site(held)).collect(),
        }
    }

    /// One name's entry: the first kind carries the place and the prose, and the
    /// rest their word; a read off the module's `default` is no use, and a
    /// package's own reads are counted in `uses` but not in `used_by`. `kind`
    /// is the name's place in `kinds`, as `kind_of` holds it.
    fn entry_of<'s>(&'s self, owner: &'s str, name: &'s PublishedName, kind: u32, held: &[&'s NameUse]) -> EntryRef<'s> {
        // `new` refused a name with no kinds.
        let first = &name.kinds[0];
        let kind = match kind {
            NONE => first.kind.as_str(),
            at => self.kinds[at as usize].as_str(),
        };
        let defaulted = |held: &NameUse| held.through.is_some() && held.through_default;
        let (through_default, sites): (Vec<&NameUse>, Vec<&NameUse>) = held.iter().copied().partition(|held| defaulted(held));
        let mut by: HashSet<&str> = HashSet::new();
        let used_by = sites.iter().map(|site| site.by.as_str()).filter(|site| *site != owner && by.insert(site)).collect();
        let mention = match first.doc {
            Some(_) => None,
            None => self.mentions.get(&(first.at.as_str(), name.name.as_str())),
        };
        EntryRef {
            name: &name.name,
            kind,
            at: &first.at,
            declared: &first.declared,
            line: first.line,
            signature: first.signature.as_deref(),
            doc: first.doc.as_deref(),
            used_by,
            uses: sites.len() as u32,
            sites: sites.into_iter().map(UseRef::site).collect(),
            through_default: through_default.into_iter().map(UseRef::site).collect(),
            mention: mention.map(|held| MentionRef {
                at: &held.at,
                line: held.line,
                text: &held.text,
            }),
        }
    }
}

#[cfg(test)]
#[path = "help_join_tests.rs"]
mod tests;
