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

/// Who imports each name asked out of the file asked with it, told apart by
/// the group asked, and what the files asked hold of it.
#[napi(object)]
pub struct Importers {
    /// Each group asked, in the order asked, with what a question about it
    /// alone would list.
    pub groups: Vec<Group>,
    /// Every line of one of the files asked about that uses the name asked of
    /// it, declared at its top level, by file in code units, then by line.
    pub in_file: Vec<InFile>,
    /// Every namespace a file passes a name asked on inside, by file in code
    /// units, then by name: `export * as shout` passes `greet` as `shout.greet`.
    pub namespaces: Vec<Namespace>,
    /// Every file, in code-unit order, with an import the index resolved to
    /// no file that could take the name: a use there is not listed.
    pub unresolved: Vec<String>,
}

/// One file asked about, and the name it exports what is asked under.
#[napi(object)]
pub struct Asked {
    pub file: String,
    pub name: String,
}

/// What one group asked about answers alone.
#[napi(object)]
pub struct Group {
    /// Every use of its names, ordered by the importing file in code units, then by line.
    pub uses: Vec<NameUse>,
    /// Every file that passes one of its names on with `export … from`, under
    /// the name it exports, in code-unit order; none of the group's own files.
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
/// the names of two of its members is followed once. Each group's answer is
/// what it would answer alone, so the declarations of one name, each asked as
/// its own group, are told apart in one walk, a default export among them.
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
    // A site one group reaches by two paths is one use, a value use when either path is one.
    let mut found: Vec<HashMap<(String, u32, String, String, String), NameUse>> = asked.iter().map(|_| HashMap::new()).collect();
    for taken in walked.taken {
        let site = (taken.taken.at.clone(), taken.taken.line, taken.taken.name.clone(), taken.taken.key.clone(), taken.local);
        match found[taken.origin].entry(site) {
            std::collections::hash_map::Entry::Occupied(mut held) => {
                let held = held.get_mut();
                held.r#type &= taken.taken.r#type;
                held.through_default &= taken.taken.through_default;
            }
            std::collections::hash_map::Entry::Vacant(free) => {
                free.insert(taken.taken);
            }
        }
    }
    let mut through: Vec<Vec<String>> = asked.iter().map(|_| Vec::new()).collect();
    for (origin, passing) in walked.through {
        if !asked[origin].iter().any(|one| one.file == passing) { through[origin].push(passing); }
    }
    let groups = found
        .into_iter()
        .zip(through)
        .map(|(found, mut through)| {
            let mut uses: Vec<NameUse> = found.into_values().collect();
            uses.sort_by(|a, b| {
                crate::order::code_unit(&a.at, &b.at)
                    .then(a.line.cmp(&b.line))
                    .then_with(|| crate::order::code_unit(&a.name, &b.name))
                    .then_with(|| crate::order::code_unit(&a.key, &b.key))
                    // Two bindings of one name on one line differ by what they bind it to.
                    .then_with(|| crate::order::code_unit(a.local.as_deref().unwrap_or(""), b.local.as_deref().unwrap_or("")))
            });
            through.sort_unstable_by(|a, b| crate::order::code_unit(a, b));
            Group { uses, through }
        })
        .collect();
    let mut namespaces = walked.namespaces;
    namespaces.sort_unstable_by(|a, b| {
        crate::order::code_unit(&a.at, &b.at).then_with(|| crate::order::code_unit(&a.name, &b.name)).then_with(|| a.members.len().cmp(&b.members.len()))
    });
    Importers { groups, in_file, namespaces, unresolved }
}
