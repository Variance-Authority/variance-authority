//! The documented surface, joined where the publish encodes it: each opening's
//! names beside who uses them, and what a README says of the names nothing is
//! written above.
//!
//! `assembleHelp` in `packages/package/src/help.ts` is the rule, and the walk
//! that reads a workspace without an index still runs it; this is the same rule
//! on the publish's side. Nothing it joins crosses into JavaScript: the entries
//! borrow the reading's uses and declarations, and go straight to the encoder.

// compass: variance-authority.report.agent-surface

use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::path::Path;

use rayon::prelude::*;

use crate::help_mention::{mention, nearest, readmes, Mention};
use crate::help_names::PublishedName;
use crate::help_store::{EntryRef, MentionRef, OpeningRef, PackageRef, UseRef};
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

/// What a README says of each name, by the file its first kind is declared in.
pub(crate) type Mentions<'a> = HashMap<(&'a str, &'a str), Option<Mention>>;

/// The names of the openings of `packages`, given flat in their order as
/// `names`, whose first kind has no doc and whose nearest README under
/// `root` names them, looked up once per declaring file and name.
pub(crate) fn mentions<'a>(root: &Path, names: &'a [Vec<PublishedName>]) -> Mentions<'a> {
    let mut asked: Vec<(&str, &str)> = Vec::new();
    let mut seen: HashSet<(&str, &str)> = HashSet::new();
    for name in names.iter().flatten() {
        if let Some(first) = name.kinds.first() {
            if first.doc.is_none() && seen.insert((first.at.as_str(), name.name.as_str())) {
                asked.push((first.at.as_str(), name.name.as_str()));
            }
        }
    }
    let held = readmes(root, asked.iter().map(|(at, _)| *at));
    asked.into_par_iter().map(|(at, name)| ((at, name), nearest(&held, at).and_then(|readme| mention(readme, name)))).collect()
}

/// Every package of `skeleton`, its openings' entries joined: `names` holds
/// each opening's names, flat in the skeleton's order, and `uses` every use
/// through an opened key. Entries are ordered by how many packages reach for
/// them, then how often, then by name in code units. `Err` names the first
/// name with no declaration behind it.
pub(crate) fn join<'a>(
    skeleton: &'a [Skeleton<'a>],
    names: &'a [Vec<PublishedName>],
    uses: &'a [NameUse],
    mentions: &'a Mentions<'a>,
) -> Result<Vec<PackageRef<'a>>, String> {
    let mut grouped: Grouped = HashMap::new();
    for held in uses {
        grouped.entry(held.key.as_str()).or_default().entry(held.name.as_str()).or_default().push(held);
    }
    let flat: Vec<(&Skeleton, &OpeningSkeleton)> =
        skeleton.iter().flat_map(|owner| owner.openings.iter().map(move |opening| (owner, opening))).collect();
    if flat.len() != names.len() {
        return Err(format!("the reading holds the names of {} openings, and {} were asked about", names.len(), flat.len()));
    }
    let openings: Vec<OpeningRef> = flat
        .par_iter()
        .zip(names.par_iter())
        .map(|((owner, opening), names)| opening_of(owner.name, opening, names, grouped.get(format!("{} {}", owner.name, opening.subpath).as_str()), mentions))
        .collect::<Result<_, _>>()?;
    let mut openings = openings.into_iter();
    Ok(skeleton
        .iter()
        .map(|owner| PackageRef { name: owner.name, entry: owner.entry, openings: openings.by_ref().take(owner.openings.len()).collect() })
        .collect())
}

fn opening_of<'a>(
    owner: &'a str,
    opening: &OpeningSkeleton<'a>,
    names: &'a [PublishedName],
    by_name: Option<&HashMap<&'a str, Vec<&'a NameUse>>>,
    mentions: &'a Mentions<'a>,
) -> Result<OpeningRef<'a>, String> {
    let held = |name: &str| by_name.and_then(|by_name| by_name.get(name)).map_or(&[][..], Vec::as_slice);
    let mut entries = names.iter().map(|name| entry_of(owner, name, held(&name.name), mentions)).collect::<Result<Vec<_>, _>>()?;
    entries.sort_by(|a, b| b.used_by.len().cmp(&a.used_by.len()).then(b.uses.cmp(&a.uses)).then_with(|| code_unit(a.name, b.name)));
    Ok(OpeningRef {
        subpath: opening.subpath,
        source: opening.source,
        spec: opening.spec,
        entries,
        whole: held("*").iter().map(|held| UseRef::site(held)).collect(),
    })
}

/// `entryOf` and `reachedFrom`: the first kind carries the place and the
/// prose, and the rest their word; a read off the module's `default` is no use.
fn entry_of<'a>(owner: &'a str, name: &'a PublishedName, held: &[&'a NameUse], mentions: &'a Mentions<'a>) -> Result<EntryRef<'a>, String> {
    let Some(first) = name.kinds.first() else {
        return Err(format!("`{}` was reached with no declaration behind it", name.name));
    };
    let kind = if name.kinds.len() == 1 {
        Cow::Borrowed(first.kind.as_str())
    } else {
        let mut kinds: Vec<&str> = name.kinds.iter().map(|kind| kind.kind.as_str()).collect();
        kinds.sort_by(|a, b| code_unit(a, b));
        Cow::Owned(kinds.join("+"))
    };
    let defaulted = |held: &NameUse| held.through.is_some() && held.through_default;
    let (through_default, sites): (Vec<&NameUse>, Vec<&NameUse>) = held.iter().copied().partition(|held| defaulted(held));
    let mut by: HashSet<&str> = HashSet::new();
    let used_by = sites.iter().map(|site| site.by.as_str()).filter(|site| *site != owner && by.insert(site)).collect();
    let mention = match first.doc {
        Some(_) => None,
        None => mentions.get(&(first.at.as_str(), name.name.as_str())).and_then(Option::as_ref),
    };
    Ok(EntryRef {
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
        mention: mention.map(|held| MentionRef { at: &held.at, line: held.line, text: &held.text }),
    })
}
