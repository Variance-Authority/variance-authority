//! What the path set says, without the path set crossing the boundary.
//!
//! `reuse.ts` asks a repository's paths three questions before a file is opened:
//! which of them decide how resolution is configured, what each directory holds,
//! and — when no configuration bounds where a bare specifier could land — the
//! digest of the whole listing. All three are folds over strings, and a fold
//! whose input is four hundred thousand paths is a fold that should happen where
//! the paths already are.

use rayon::prelude::*;
use sha2::{Digest as _, Sha256};
use std::collections::HashMap;

use crate::digest;
use crate::order;

/// Whether a path's name decides where other files resolve to.
///
/// The `tsconfig*.json` half is a pattern rather than a list and lives here; the
/// literal names are the caller's, because `reuse.ts` owns that list and a
/// second copy of it is a copy that drifts.
pub fn named(path: &str, names: &[String]) -> bool {
    let base = basename(path);
    if names.iter().any(|name| name == base) {
        return true;
    }

    base.starts_with("tsconfig") && base.ends_with(".json")
}

fn basename(path: &str) -> &str {
    match path.rfind('/') {
        Some(at) => &path[at + 1..],
        None => path,
    }
}

/// Every directory in the tree, named by the entries it holds.
///
/// The repository root is the empty string, which is what `witness.ts` spells it
/// as and what a record's witnesses are compared against.
pub fn directories(paths: &[String]) -> HashMap<String, String> {
    let mut members: HashMap<&str, Vec<&str>> = HashMap::with_capacity(paths.len() / 4 + 16);

    for path in paths {
        let mut at = 0;
        loop {
            let parent = if at == 0 { "" } else { &path[..at - 1] };
            match path[at..].find('/') {
                None => {
                    members.entry(parent).or_default().push(&path[at..]);
                    break;
                }
                Some(offset) => {
                    let slash = at + offset;
                    members.entry(parent).or_default().push(&path[at..slash]);
                    at = slash + 1;
                }
            }
        }
    }

    // A directory's entries arrive once per path that passes through it, so a
    // directory of a hundred files collects its own name a hundred times. The
    // set is taken here rather than during the walk: a `HashSet` per directory
    // costs an allocation per directory and a hash per segment of every path,
    // and sorting is what the digest wanted anyway.
    members
        .into_par_iter()
        .map(|(directory, mut held)| {
            held.sort_unstable_by(|a, b| order::code_unit(a, b));
            held.dedup();
            (directory.to_string(), digest::of_string(&held.join("\n")))
        })
        .collect()
}

/// The configuration digest, over lines that never become JavaScript strings.
///
/// The header is the caller's — version, root, the resolver options — because
/// those are its decisions. What is folded here is the part that is the size of
/// the repository: the digest of every path whose name decides configuration,
/// and, when aliases are unknown, every path there is.
pub fn config_digest(
    header: &[String],
    paths: &[String],
    mut digest_at: impl FnMut(usize) -> String,
    names: &[String],
    aliases_unknown: bool,
) -> String {
    let mut hasher = Sha256::new();
    let mut first = true;
    let mut line = |hasher: &mut Sha256, text: &str| {
        if !first {
            hasher.update(b"\n");
        }
        first = false;
        hasher.update(text.as_bytes());
    };

    for entry in header {
        line(&mut hasher, entry);
    }
    for (at, path) in paths.iter().enumerate() {
        if named(path, names) {
            line(&mut hasher, &format!("{path} {}", digest_at(at)));
        }
    }
    if aliases_unknown {
        line(&mut hasher, "aliases unknown");
        for path in paths {
            line(&mut hasher, path);
        }
    }

    digest::of_sha256(hasher.finalize().as_slice())
}

#[cfg(test)]
mod tests {
    use super::config_digest;

    #[test]
    fn configuration_digests_only_ask_for_named_entries_and_keep_their_bytes() {
        let header = ["version 11", "conditions node,import"].map(str::to_owned);
        let paths = [
            "package.json",
            "packages/kit/tsconfig.build.json",
            "src/source.ts",
            "unmatched.txt",
            "web/jsconfig.json",
        ].map(str::to_owned);
        let names = ["package.json", "jsconfig.json"].map(str::to_owned);
        let digests = ["git:manifest", "git:typescript", "git:source", "git:text", "git:javascript"];
        let selected = "version 11\nconditions node,import\npackage.json git:manifest\npackages/kit/tsconfig.build.json git:typescript\nweb/jsconfig.json git:javascript";
        for aliases_unknown in [false, true] {
            let mut asked = Vec::new();
            let found = config_digest(&header, &paths, |at: usize| {
                asked.push(at);
                digests[at].to_owned()
            }, &names, aliases_unknown);
            assert_eq!(asked, [0, 1, 4], "unselected paths do not ask their owner for a digest");
            let expected = if aliases_unknown {
                format!("{selected}\naliases unknown\n{}", paths.join("\n"))
            } else {
                selected.to_owned()
            };
            assert_eq!(found, crate::digest::of_string(&expected));
        }
    }
}
