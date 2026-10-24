//! The walk `importers` runs: every use of each wanted name out of its file,
//! following each re-export that passes one on, as a name or as a member of
//! the namespace an `export * as` makes of it.

// compass: variance-authority.reach.relations

use std::collections::{HashMap, HashSet};

use rayon::prelude::*;

use super::{kind_of, taken, NameUse};
use crate::compact::Layer;
use crate::orient_map_read::beside;
use crate::package_graph::{fold, join_parses, passed_on, At, Crossing};
use crate::package_owners::{owners, NO_OWNER};

/// One use `importers_from` found, of the `origin` it was asked for, with the
/// name the import binds in the file, empty for a member read.
pub(crate) struct Taken {
    pub(crate) origin: usize,
    pub(crate) taken: NameUse,
    pub(crate) local: String,
}

/// A name wanted out of a file: the export itself, or with a member, the name
/// read off the namespace the export is, which `export * as` made of a module.
type Want = (String, Option<String>);

/// Per file, each name wanted out of it, and per origin whether only a
/// type-only path reached it.
type Wanted = HashMap<String, HashMap<Want, HashMap<usize, bool>>>;

/// One re-export passing a wanted name on: the file, the name it passes, the
/// origin, and whether only a type-only path reached it.
type Pass = (String, Want, usize, bool);

/// `importers` for several names at once: each `(file, name)` of `wanted`
/// carries the origins it answers for, and every use and every file passing
/// one on carries them along, so one walk answers them all. Each file is
/// followed once per name and origin, and once more when a value path reaches
/// it after a type-only one; a site reached both ways is a value use.
pub(crate) fn importers_from(
    root: &str,
    layers: &[Layer],
    asked: HashMap<String, HashMap<String, HashSet<usize>>>,
) -> (Vec<Taken>, HashSet<String>) {
    importers_folded(root, layers, &fold(layers), asked)
}

pub(super) fn importers_folded(
    root: &str,
    layers: &[Layer],
    folded: &HashMap<&str, At>,
    asked: HashMap<String, HashMap<String, HashSet<usize>>>,
) -> (Vec<Taken>, HashSet<String>) {
    let mut wanted: Wanted = asked
        .into_iter()
        .map(|(file, names)| (file, names.into_iter().map(|(name, origins)| ((name, None), origins.into_iter().map(|origin| (origin, false)).collect())).collect()))
        .collect();
    // Each `(file, want, origin)` followed, and whether only a type-only path reached it.
    let mut seen: HashMap<(String, Want, usize), bool> = HashMap::new();
    for (file, names) in &wanted {
        for (want, origins) in names {
            seen.extend(origins.keys().map(|&origin| ((file.clone(), want.clone(), origin), false)));
        }
    }
    let mut found: HashMap<(usize, String, u32, String, String, String), Taken> = HashMap::new();
    let mut through = HashSet::new();
    while !wanted.is_empty() {
        let (uses, passed) = importers_of(root, layers, folded, &wanted);
        for one in uses {
            let site = (one.origin, one.taken.at.clone(), one.taken.line, one.taken.name.clone(), one.taken.key.clone(), one.local.clone());
            match found.entry(site) {
                std::collections::hash_map::Entry::Occupied(mut held) => held.get_mut().taken.r#type &= one.taken.r#type,
                std::collections::hash_map::Entry::Vacant(free) => {
                    free.insert(one);
                }
            }
        }
        wanted = HashMap::new();
        for (file, want, origin, typed) in passed {
            let key = (file.clone(), want.clone(), origin);
            let follow = match seen.get(&key) {
                None => true,
                Some(&held) => held && !typed,
            };
            if follow {
                seen.insert(key, typed);
                through.insert(file.clone());
                let held = wanted.entry(file).or_default().entry(want).or_default().entry(origin).or_insert(typed);
                *held &= typed;
            }
        }
    }
    (found.into_values().collect(), through)
}

/// One step of `importers_from`: the uses of each wanted name out of its
/// file, and each re-export passing one of them on.
fn importers_of(root: &str, layers: &[Layer], folded: &HashMap<&str, At>, wanted: &Wanted) -> (Vec<Taken>, Vec<Pass>) {
    let lands = |at: At| {
        let (stored, records) = (&layers[at.0].stored, &layers[at.0].records);
        records.targets_present[at.1] == 1
            && records.targets.range(at.1).any(|target| stored.optional(records.target_path.at(target)).is_some_and(|path| wanted.contains_key(path)))
    };
    let mut crossings: Vec<Crossing> = folded
        .iter()
        .filter(|&(_, &at)| lands(at))
        .map(|(&file, &at)| Crossing { file, owner: NO_OWNER, others: Vec::new(), at, parse: None })
        .collect();
    crossings.sort_unstable_by(|a, b| crate::order::code_unit(a.file, b.file));
    join_parses(layers, &mut crossings);
    let paths = beside(root, crossings.iter().map(|crossing| crossing.file));
    let owners = owners(root, &paths);
    let parts: Vec<(Vec<Taken>, Vec<Pass>)> = crossings
        .par_iter()
        .map(|crossing| {
            let (mut found, mut passed) = (Vec::new(), Vec::new());
            let Some((layer, row)) = crossing.parse else { return (found, passed) };
            let (stored, records) = (&layers[crossing.at.0].stored, &layers[crossing.at.0].records);
            let resolved: Vec<Option<&str>> =
                records.targets.range(crossing.at.1).map(|target| stored.optional(records.target_path.at(target))).collect();
            let (text, parses) = (&layers[layer].stored, &layers[layer].parses);
            // A record whose targets do not line up with the parse's requests answers none of them.
            if resolved.len() != parses.requests.range(row).len() { return (found, passed); }
            let first = parses.requests.at(row) as usize;
            let by = owners.package_of(crossing.file);
            let kind = kind_of(crossing.file);
            for request in parses.requests.range(row) {
                let Some(names) = resolved[request - first].and_then(|path| wanted.get(path)) else { continue };
                if parses.request_republishes[request] != 1 {
                    let written = text.text(parses.request_value.at(request));
                    for (mut taken, local) in taken(&layers[layer], row, request, written, by, crossing.file, kind) {
                        // A module that escapes whole may be read for any name wanted out of it.
                        let asked: Vec<(&Want, &HashMap<usize, bool>)> =
                            if taken.whole { names.iter().collect() } else { names.get_key_value(&(taken.name.clone(), None)).into_iter().collect() };
                        let written_type = taken.r#type;
                        for ((name, member), origins) in asked {
                            taken.name.clone_from(member.as_ref().unwrap_or(name));
                            for (&origin, &typed) in origins {
                                taken.r#type = written_type || typed;
                                found.push(Taken { origin, taken: taken.clone(), local: local.to_owned() });
                            }
                        }
                    }
                    let at = Site { key: written, by, at: crossing.file, kind };
                    found.extend(read_off(&layers[layer], row, request, names, &at));
                    continue;
                }
                let every = |type_only: bool| {
                    names.iter().filter(|((name, _), _)| name != "default").flat_map(move |(want, origins)| {
                        origins.iter().map(move |(&origin, &typed)| (crossing.file.to_owned(), want.clone(), origin, typed || type_only))
                    })
                };
                match passed_on(&layers[layer], row, request) {
                    // An export list the parse never recorded reads as the whole
                    // module, and as types when the whole statement says `export type`.
                    None => passed.extend(every(text.text(parses.request_kind.at(request)) == "type")),
                    Some(listed) => {
                        for one in listed {
                            if one.exported.is_none() && one.imported == "*" {
                                passed.extend(every(one.type_only));
                                continue;
                            }
                            for ((name, member), origins) in names {
                                let exported = match one.exported {
                                    // `export * as G` passes a namespace: each name is a member read off `G`.
                                    Some(namespace) if one.imported == "*" && member.is_none() => (namespace.to_owned(), Some(name.clone())),
                                    Some(exported) if one.imported == name => (exported.to_owned(), member.clone()),
                                    // A namespace of a namespace is not followed.
                                    _ => continue,
                                };
                                passed.extend(origins.iter().map(|(&origin, &typed)| (crossing.file.to_owned(), exported.clone(), origin, typed || one.type_only)));
                            }
                        }
                    }
                }
            }
            (found, passed)
        })
        .collect();
    let (mut found, mut passed) = (Vec::new(), Vec::new());
    for (uses, passes) in parts {
        found.extend(uses);
        passed.extend(passes);
    }
    (found, passed)
}

/// Where a use is: the specifier as written, the package and file reading it,
/// and the file's kind.
struct Site<'a> {
    key: &'a str,
    by: &'a str,
    at: &'a str,
    kind: &'a str,
}

/// The member wants a non-republishing `request` answers: each name read off
/// a binding that imports the namespace the want is a member of.
fn read_off(layer: &Layer, row: usize, request: usize, names: &HashMap<Want, HashMap<usize, bool>>, site: &Site) -> Vec<Taken> {
    let (text, parses) = (&layer.stored, &layer.parses);
    let first = parses.requests.at(row) as usize;
    let mut found = Vec::new();
    for read in parses.binding_members.range(row) {
        if parses.binding_member_request.at(read) as usize != request - first { continue; }
        let binding = text.text(parses.binding_member_binding.at(read));
        let name = text.text(parses.binding_member_name.at(read));
        let Some(origins) = names.get(&(binding.to_owned(), Some(name.to_owned()))) else { continue };
        let Some(bound) = parses.request_bindings.range(request).find(|&one| text.text(parses.binding_imported.at(one)) == binding) else { continue };
        for (&origin, &typed) in origins {
            let taken = NameUse {
                key: site.key.to_owned(),
                name: name.to_owned(),
                local: None,
                by: site.by.to_owned(),
                at: site.at.to_owned(),
                line: parses.binding_member_line.at(read),
                r#type: parses.binding_type[bound] == 1 || typed,
                kind: site.kind.to_owned(),
                through: Some("namespace".to_owned()),
                through_line: parses.binding_line.at(bound),
                through_default: false,
                whole: false,
            };
            found.push(Taken { origin, taken, local: String::new() });
        }
    }
    found
}
