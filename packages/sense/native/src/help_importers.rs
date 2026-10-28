//! The walk `importers` runs: every use of each wanted name out of its file,
//! following each re-export that passes one on, as a name or as a member of
//! the namespace an `export * as` makes of it, at any depth.

// compass: variance-authority.reach.relations

use std::collections::{HashMap, HashSet};

use rayon::prelude::*;

use super::{kind_of, taken, Namespace, NameUse};
use crate::compact::Layer;
use crate::help_origin::star_passes;
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

/// What `importers_from` walked: every use, every file that passes a wanted
/// name on, and every namespace a file passes one on inside.
pub(crate) struct Walked {
    pub(crate) taken: Vec<Taken>,
    pub(crate) through: HashSet<String>,
    pub(crate) namespaces: Vec<Namespace>,
}

/// A name wanted out of a file: an export of it, and the names read off that
/// export to reach the name asked about, nearest first, the last of them the
/// name itself; empty when the export is the name. `export * as` makes each
/// name it passes a member of the namespace it exports.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct Want {
    export: String,
    within: Within,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
enum Within {
    Path(Vec<String>),
    /// Deeper than any read the index records off a value inside a module,
    /// keeping only the name asked about: no read reaches it, and only a module
    /// that goes on whole may. The export alone decides what passes it on, so
    /// a namespace that holds itself ends here.
    Deep(String),
}

impl Want {
    /// The name asked about.
    fn asked(&self) -> &str {
        match &self.within {
            Within::Path(path) => path.last().unwrap_or(&self.export),
            Within::Deep(name) => name,
        }
    }

    /// The want `export * as namespace` makes of this one, kept a path while a
    /// read as deep as it is recorded somewhere.
    fn inside(&self, namespace: &str, deepest: usize) -> Want {
        let within = match &self.within {
            Within::Path(path) if path.len() < deepest => Within::Path(std::iter::once(self.export.clone()).chain(path.iter().cloned()).collect()),
            _ => Within::Deep(self.asked().to_owned()),
        };
        Want { export: namespace.to_owned(), within }
    }
}

/// Per file, each name wanted out of it, and per origin whether only a
/// type-only path reached it.
type Wanted = HashMap<String, HashMap<Want, HashMap<usize, bool>>>;

/// One re-export passing a wanted name on: the file, the name it passes, the
/// origin, and whether only a type-only path reached it.
type Pass = (String, Want, usize, bool);

/// `importers` for several names at once: each `(file, name)` of `asked`
/// carries the origins it answers for, and every use and every file passing
/// one on carries them along, so one walk answers them all. Each file is
/// followed once per name and origin, and once more when a value path reaches
/// it after a type-only one; a site reached both ways is a value use.
pub(crate) fn importers_from(root: &str, layers: &[Layer], asked: HashMap<String, HashMap<String, HashSet<usize>>>) -> Walked {
    importers_folded(root, layers, &fold(layers), asked)
}

/// The most names any recorded read reaches off an export, `lib.a.b.x` reads
/// three: a want deeper than that no read answers.
fn deepest(layers: &[Layer]) -> usize {
    layers
        .iter()
        .flat_map(|layer| {
            let within = &layer.parses.binding_member_within;
            (0..layer.parses.binding_member_name.len()).map(move |read| within.range(read).len() + 1)
        })
        .max()
        .unwrap_or(0)
}

pub(super) fn importers_folded(
    root: &str,
    layers: &[Layer],
    folded: &HashMap<&str, At>,
    asked: HashMap<String, HashMap<String, HashSet<usize>>>,
) -> Walked {
    let deepest = deepest(layers);
    let mut wanted: Wanted = asked
        .into_iter()
        .map(|(file, names)| {
            let names = names.into_iter().map(|(name, origins)| (Want { export: name, within: Within::Path(Vec::new()) }, origins.into_iter().map(|origin| (origin, false)).collect()));
            (file, names.collect())
        })
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
    let mut namespaces = HashSet::new();
    while !wanted.is_empty() {
        let (uses, passed) = importers_of(root, layers, folded, &wanted, deepest);
        for one in uses {
            let site = (one.origin, one.taken.at.clone(), one.taken.line, one.taken.name.clone(), one.taken.key.clone(), one.local.clone());
            match found.entry(site) {
                std::collections::hash_map::Entry::Occupied(mut held) => {
                    let held = &mut held.get_mut().taken;
                    held.r#type &= one.taken.r#type;
                    // A read a namespace's `default` makes certain is no interop guess.
                    held.through_default &= one.taken.through_default;
                }
                std::collections::hash_map::Entry::Vacant(free) => {
                    free.insert(one);
                }
            }
        }
        wanted = HashMap::new();
        for (file, want, origin, typed) in passed {
            if let Within::Path(path) = &want.within {
                if !path.is_empty() {
                    namespaces.insert(Namespace { at: file.clone(), name: want.export.clone(), members: path.clone() });
                }
            }
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
    Walked { taken: found.into_values().collect(), through, namespaces: namespaces.into_iter().collect() }
}

/// One step of `importers_from`: the uses of each wanted name out of its
/// file, and each re-export passing one of them on.
fn importers_of(root: &str, layers: &[Layer], folded: &HashMap<&str, At>, wanted: &Wanted, deepest: usize) -> (Vec<Taken>, Vec<Pass>) {
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
                let Some((from, names)) = resolved[request - first].and_then(|path| Some((path, wanted.get(path)?))) else { continue };
                if parses.request_republishes[request] != 1 {
                    let written = text.text(parses.request_value.at(request));
                    for (taken, local) in taken(&layers[layer], row, request, written, by, crossing.file, kind) {
                        found.extend(answered(names, taken, local));
                    }
                    let at = Site { key: written, by, at: crossing.file, kind };
                    found.extend(read_off(&layers[layer], row, request, names, &at));
                    continue;
                }
                // Every wanted name `keep` lets through, as the file passes it on.
                let pass = |keep: &dyn Fn(&str) -> bool, type_only: bool| -> Vec<Pass> {
                    names
                        .iter()
                        .filter(|(want, _)| keep(&want.export))
                        .flat_map(|(want, origins)| origins.iter().map(move |(&origin, &typed)| (crossing.file.to_owned(), want.clone(), origin, typed || type_only)))
                        .collect()
                };
                match passed_on(&layers[layer], row, request) {
                    // An export list the parse never recorded reads as the whole
                    // module, and as types when the whole statement says `export type`.
                    None => passed.extend(pass(&|name| name != "default", text.text(parses.request_kind.at(request)) == "type")),
                    Some(listed) => {
                        for one in listed {
                            if one.exported.is_none() && one.imported == "*" {
                                passed.extend(pass(&|name| star_passes(layers, folded, crossing.file, from, name), one.type_only));
                                continue;
                            }
                            for (want, origins) in names {
                                let exported = match one.exported {
                                    // `export * as G` passes a namespace: each name is a member read off `G`.
                                    Some(namespace) if one.imported == "*" => want.inside(namespace, deepest),
                                    Some(exported) if one.imported == want.export => Want { export: exported.to_owned(), within: want.within.clone() },
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

/// The wants one name a request takes answers: a module that escapes whole
/// may be read for any of them, a binding or member read answers the want of
/// its name, and a name read off the module's `default` answers too a member
/// of the namespace a module passes on as its `default`, for certain.
fn answered(names: &HashMap<Want, HashMap<usize, bool>>, mut taken: NameUse, local: &str) -> Vec<Taken> {
    let mut asked: Vec<(&Want, &HashMap<usize, bool>, bool)> = Vec::new();
    if taken.whole {
        asked.extend(names.iter().map(|(want, origins)| (want, origins, taken.through_default)));
    } else {
        let named = Want { export: taken.name.clone(), within: Within::Path(Vec::new()) };
        asked.extend(names.get_key_value(&named).map(|(want, origins)| (want, origins, taken.through_default)));
        if taken.through_default {
            let member = Want { export: "default".to_owned(), within: Within::Path(vec![taken.name.clone()]) };
            asked.extend(names.get_key_value(&member).map(|(want, origins)| (want, origins, false)));
        }
    }
    let written_type = taken.r#type;
    let mut found = Vec::new();
    for (want, origins, through_default) in asked {
        taken.name = want.asked().to_owned();
        taken.through_default = through_default;
        for (&origin, &typed) in origins {
            taken.r#type = written_type || typed;
            found.push(Taken { origin, taken: taken.clone(), local: local.to_owned() });
        }
    }
    found
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
/// a value inside the module that is the namespace the want is a member of.
/// The read is marked with the line its import starts on, as a namespace
/// import's member reads are.
fn read_off(layer: &Layer, row: usize, request: usize, names: &HashMap<Want, HashMap<usize, bool>>, site: &Site) -> Vec<Taken> {
    let (text, parses) = (&layer.stored, &layer.parses);
    let first = parses.requests.at(row) as usize;
    let kind_written = text.text(parses.request_kind.at(request));
    let through = if kind_written == "dynamic" || kind_written == "type" { "dynamic" } else { "namespace" };
    let mut found = Vec::new();
    for read in parses.binding_members.range(row) {
        if parses.binding_member_request.at(read) as usize != request - first { continue; }
        let binding = text.text(parses.binding_member_binding.at(read));
        let name = text.text(parses.binding_member_name.at(read));
        let path = parses
            .binding_member_within
            .range(read)
            .map(|within| text.text(parses.binding_within_name.at(within)).to_owned())
            .chain(std::iter::once(name.to_owned()))
            .collect();
        let Some(origins) = names.get(&Want { export: binding.to_owned(), within: Within::Path(path) }) else { continue };
        // The binding the value comes through: the named import of `binding`,
        // the namespace import, or none, through an `import()`.
        let bound = parses
            .request_bindings
            .range(request)
            .find(|&one| text.text(parses.binding_imported.at(one)) == binding)
            .or_else(|| parses.request_bindings.range(request).find(|&one| text.text(parses.binding_imported.at(one)) == "*"));
        let typed_import = bound.map_or(kind_written == "type", |bound| parses.binding_type[bound] == 1);
        for (&origin, &typed) in origins {
            let taken = NameUse {
                key: site.key.to_owned(),
                name: name.to_owned(),
                local: None,
                by: site.by.to_owned(),
                at: site.at.to_owned(),
                line: parses.binding_member_line.at(read),
                r#type: typed_import || typed,
                kind: site.kind.to_owned(),
                through: Some(through.to_owned()),
                through_line: parses.request_line.at(request),
                through_default: false,
                whole: false,
            };
            found.push(Taken { origin, taken, local: String::new() });
        }
    }
    found
}
