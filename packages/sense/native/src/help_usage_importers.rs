//! Who imports one name out of a set of files, told apart by the file asked:
//! the answer `importers` composes from the walk in `help_importers.rs`.

// compass: variance-authority.reach.relations

use std::collections::{HashMap, HashSet};

use napi_derive::napi;

use super::importers_walk::importers_from;
use super::unresolved_walk::{self, Configurations};
use super::NameUse;
use crate::compact::Layer;
use crate::help_in_file::{in_file, InFile};

/// Who imports each name asked out of the file asked with it, and which files pass it on.
#[napi(object)]
pub struct Importers {
    /// Every use, ordered by the importing file in code units, then by line.
    pub uses: Vec<NameUse>,
    /// Every file that passes a name asked on with `export … from`, under the
    /// name it exports, in code-unit order; none of the files asked about.
    pub through: Vec<String>,
    /// Every line of one of the files asked about that uses the name asked of
    /// it, declared at its top level, by file in code units, then by line.
    pub in_file: Vec<InFile>,
    /// Every namespace a file passes a name asked on inside, by file in code
    /// units, then by name: `export * as shout` passes `greet` as `shout.greet`.
    pub namespaces: Vec<Namespace>,
    /// Every file, in code-unit order, with an import the index resolved to
    /// no file that could take the name: a use there is not listed.
    pub unresolved: Vec<String>,
    /// Each group asked, in the order asked, with what a question about it
    /// alone would list.
    pub apart: Vec<Apart>,
}

/// One file asked about, and the name it exports what is asked under.
#[napi(object)]
pub struct Asked {
    pub file: String,
    pub name: String,
}

/// What one group asked about answers alone: the uses of its names, and the
/// files passing them on, its own left out.
#[napi(object)]
pub struct Apart {
    pub uses: Vec<NameUse>,
    pub through: Vec<String>,
}

/// A namespace one file passes a name on inside: the name it exports the
/// namespace as, and the names read off it to reach the name, nearest first,
/// the last the name itself.
#[napi(object)]
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Namespace {
    pub at: String,
    pub name: String,
    pub members: Vec<String>,
}

/// Every import, by any file on the chain, of a name asked out of the file
/// asked with it: the bindings and member reads that take it through a request
/// the index resolved to that file. A relative import is read like one between
/// packages, which `usage` does not record. Each use's `key` is the specifier
/// as written, and its `name` the name it takes, which a re-export can rename.
///
/// What an `export … from` passes on is `passed_on`'s answer, the one the
/// package graph reads: that is no use, and the file that writes it is
/// followed instead under the name it exports, so an import through a barrel
/// is listed and the barrel is not. A bare `export *` passes a name on only
/// where ECMAScript's export resolution says it does (`star_passes`): never
/// `default`, never past the file's own export or named `export … from` of the
/// name, and never when another star reaches a different declaration. The
/// question is about source, so a type-only re-export passes its names on too,
/// and every use that came through one is a type use, whatever its importer
/// wrote. Each file is followed once per name, and once more when a value path
/// reaches a name a type-only one reached first, so a cycle of re-exports ends.
///
/// A file asked about that declares the name uses it by scope, not by import,
/// and the scan read those lines with its parse: they are `in_file`.
///
/// Each group asked is one origin, followed as one question: a file passing on
/// the names of two of its members is followed once. `apart` says what each
/// group would answer alone, so the declarations of one name, each asked as its
/// own group, are told apart in one walk, a default export among them. In `uses`
/// a site two groups reach is one use, a value use when either reached it as
/// one; in `apart` each keeps what its own walk reached.
pub(crate) fn importers(root: &str, layers: &[Layer], configurations: &Configurations, asked: &[Vec<Asked>]) -> Importers {
    let mut origins: HashMap<String, HashMap<String, HashSet<usize>>> = HashMap::new();
    let mut by_name: HashMap<&str, Vec<String>> = HashMap::new();
    for (origin, group) in asked.iter().enumerate() {
        for one in group {
            origins.entry(one.file.clone()).or_default().entry(one.name.clone()).or_default().insert(origin);
            by_name.entry(one.name.as_str()).or_default().push(one.file.clone());
        }
    }
    let files: Vec<String> = asked.iter().flatten().map(|one| one.file.clone()).collect();
    let mut in_file: Vec<InFile> = by_name.into_iter().flat_map(|(name, files)| in_file(root, layers, &files, name)).collect();
    in_file.sort_by(|a, b| crate::order::code_unit(&a.at, &b.at).then(a.line.cmp(&b.line)));
    let walked = importers_from(root, layers, origins);
    let passing: HashSet<String> = walked.through.iter().map(|(_, file)| file.clone()).collect();
    let unresolved = unresolved_walk::unresolved(root, layers, configurations, &files, &passing, &walked.exports);
    // The walk's own site, without its origin: a use two origins reach is one.
    // Each origin that reached the site keeps its own type and default flags, for `by_file`.
    let mut merged: HashMap<(String, u32, String, String, String), (NameUse, Vec<Reached>)> = HashMap::new();
    for taken in walked.taken {
        let site = (taken.taken.at.clone(), taken.taken.line, taken.taken.name.clone(), taken.taken.key.clone(), taken.local);
        match merged.entry(site) {
            std::collections::hash_map::Entry::Occupied(mut held) => {
                let (held, origins) = held.get_mut();
                held.r#type &= taken.taken.r#type;
                held.through_default &= taken.taken.through_default;
                match origins.iter_mut().find(|reached| reached.origin == taken.origin) {
                    Some(reached) => {
                        reached.r#type &= taken.taken.r#type;
                        reached.through_default &= taken.taken.through_default;
                    }
                    None => origins.push(Reached { origin: taken.origin, r#type: taken.taken.r#type, through_default: taken.taken.through_default }),
                }
            }
            std::collections::hash_map::Entry::Vacant(free) => {
                let reached = Reached { origin: taken.origin, r#type: taken.taken.r#type, through_default: taken.taken.through_default };
                free.insert((taken.taken, vec![reached]));
            }
        }
    }
    let mut found: Vec<(NameUse, Vec<Reached>)> = merged.into_values().collect();
    found.sort_by(|(a, _), (b, _)| {
        crate::order::code_unit(&a.at, &b.at)
            .then(a.line.cmp(&b.line))
            .then_with(|| crate::order::code_unit(&a.name, &b.name))
            .then_with(|| crate::order::code_unit(&a.key, &b.key))
            // Two bindings of one name on one line differ by what they bind it to.
            .then_with(|| crate::order::code_unit(a.local.as_deref().unwrap_or(""), b.local.as_deref().unwrap_or("")))
    });
    let mut through: Vec<String> = passing.into_iter().filter(|file| !files.contains(file)).collect();
    through.sort_unstable_by(|a, b| crate::order::code_unit(a, b));
    let mut namespaces = walked.namespaces;
    namespaces.sort_unstable_by(|a, b| {
        crate::order::code_unit(&a.at, &b.at).then_with(|| crate::order::code_unit(&a.name, &b.name)).then_with(|| a.members.len().cmp(&b.members.len()))
    });
    let apart = split(asked, &found, &walked.through);
    let uses = found.into_iter().map(|(taken, _)| taken).collect();
    Importers { uses, through, in_file, namespaces, unresolved, apart }
}

/// One origin's reach of a site: whether every path it took there was type-only,
/// and whether every one passed the name on as a default.
struct Reached {
    origin: usize,
    r#type: bool,
    through_default: bool,
}

/// Each group asked, with the uses it reached, flagged as it reached them, and
/// the files it was passed on through, its own left out.
fn split(asked: &[Vec<Asked>], found: &[(NameUse, Vec<Reached>)], through_by: &HashSet<(usize, String)>) -> Vec<Apart> {
    let mut apart: Vec<Apart> = asked.iter().map(|_| Apart { uses: Vec::new(), through: Vec::new() }).collect();
    for (taken, origins) in found {
        for reached in origins {
            apart[reached.origin].uses.push(NameUse { r#type: reached.r#type, through_default: reached.through_default, ..taken.clone() });
        }
    }
    for (origin, passing) in through_by {
        if !asked[*origin].iter().any(|one| one.file == *passing) { apart[*origin].through.push(passing.clone()); }
    }
    for one in &mut apart {
        one.through.sort_unstable_by(|a, b| crate::order::code_unit(a, b));
    }
    apart
}
