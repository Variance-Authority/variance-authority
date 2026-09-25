//! Repository files under configured roots, selected from Git identity when available.

use std::fs;
use std::path::{Component, Path, PathBuf};

use napi_derive::napi;
use rayon::prelude::*;
use rayon::ThreadPoolBuilder;

/// Every extension some reader claims, mirroring `READABLE` in `language.ts`.
///
/// Seeding is where a language enters the graph at all: a file whose extension
/// is missing here is never opened, never resolved and never reported, and the
/// scan says nothing about it — the one failure this package exists to refuse.
/// It is the only seeder, so it has to claim the set the readers claim rather
/// than the set they claimed when this list was written.
/// `native-readable.check.ts` holds the two lists to each other.
const EXTENSIONS: &[&str] = &[
    "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "css", "scss", "sass", "less", "py",
    "pyi", "rs", "java", "kt", "kts", "swift",
];
const READERS: usize = 6;

/// Select readable paths from the snapshot that supplies their content identity.
pub(crate) fn seed_paths(root: &str, dirs: &[String], paths: &[String]) -> Vec<String> {
    let root = PathBuf::from(root);
    let prefixes: Vec<String> = dirs
        .iter()
        .filter_map(|dir| {
            let absolute = if Path::new(dir).is_absolute() {
                PathBuf::from(dir)
            } else {
                root.join(dir)
            };
            repo_path(&root, &absolute)
        })
        .collect();

    paths
        .iter()
        .filter(|path| readable(path) && prefixes.iter().any(|prefix| below(path, prefix)))
        .cloned()
        .collect()
}

fn readable(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|part| part.to_str())
        .is_some_and(|extension| EXTENSIONS.contains(&extension))
}

fn below(path: &str, prefix: &str) -> bool {
    let relative = if prefix.is_empty() {
        path
    } else if let Some(relative) = path
        .strip_prefix(prefix)
        .and_then(|path| path.strip_prefix('/'))
    {
        relative
    } else {
        return false;
    };
    let mut components = relative.split('/').peekable();
    while let Some(component) = components.next() {
        // A tracked `build/` can itself be source (large monorepos use it for
        // build tooling). Filesystem discovery still declines generated build
        // output; Git identity is the evidence that this path is intentional.
        if components.peek().is_some() && component != "build" && crate::path::excluded(component) {
            return false;
        }
    }
    !relative.is_empty()
}

struct Directory {
    absolute: PathBuf,
    prefix: String,
    seeded: bool,
}

struct Found {
    directories: Vec<Directory>,
    files: Vec<String>,
}

/// Every readable file under the configured roots, for a scan Git does not
/// describe, with independent directory reads fanned over the filesystem width.
#[napi(catch_unwind)]
pub fn seed_files(root: String, dirs: Vec<String>) -> Vec<String> {
    let root = PathBuf::from(root);
    let mut pending: Vec<Directory> = dirs
        .into_iter()
        .filter_map(|dir| {
            let absolute = if Path::new(&dir).is_absolute() {
                PathBuf::from(dir)
            } else {
                root.join(dir)
            };
            let prefix = repo_path(&root, &absolute)?;
            Some(Directory {
                absolute,
                prefix,
                seeded: true,
            })
        })
        .collect();
    let mut files = Vec::new();
    let pool = ThreadPoolBuilder::new().num_threads(READERS).build();

    while !pending.is_empty() {
        let work = || pending.par_iter().map(read).collect::<Vec<_>>();
        let found = match &pool {
            Ok(pool) => pool.install(work),
            Err(_) => work(),
        };
        pending = Vec::new();
        for mut batch in found.into_iter().flatten() {
            pending.append(&mut batch.directories);
            files.append(&mut batch.files);
        }
    }

    files.sort_unstable_by(|left, right| crate::order::code_unit(left, right));
    files
}

/// Every readable file in one directory, unless it is a repository of its own.
///
/// A checkout inside a checkout — a worktree, a vendored clone — is a different
/// repository that happens to sit at this path. Git tracks none of its files, so
/// every one misses the digest lookup and is opened and parsed on every run; and
/// its files are another repository's copies of these ones, which doubles every
/// count taken over the walk. A seed is never tested this way, only what is found
/// beneath it: a caller that points the scan at a checkout means that checkout.
///
/// A configured directory that is not there contributes nothing; the caller is
/// the one that can say whether an empty result is wrong.
fn read(directory: &Directory) -> Option<Found> {
    let entries: Vec<_> = fs::read_dir(&directory.absolute)
        .ok()?
        .filter_map(Result::ok)
        .collect();
    if !directory.seeded && entries.iter().any(|entry| entry.file_name() == ".git") {
        return None;
    }

    let mut directories = Vec::new();
    let mut files = Vec::new();
    for entry in entries {
        let name = entry.file_name();
        let name = name.to_string_lossy().into_owned();
        let path = entry.path();
        let at = if directory.prefix.is_empty() {
            name.clone()
        } else {
            format!("{}/{}", directory.prefix, name)
        };
        let kind = entry.file_type().ok()?;
        if kind.is_dir() {
            if !crate::path::excluded(&name) {
                directories.push(Directory {
                    absolute: path,
                    prefix: at,
                    seeded: false,
                });
            }
        } else if path
            .extension()
            .and_then(|part| part.to_str())
            .is_some_and(|extension| EXTENSIONS.contains(&extension))
        {
            files.push(at);
        }
    }
    Some(Found { directories, files })
}

fn repo_path(root: &Path, absolute: &Path) -> Option<String> {
    let relative = absolute.strip_prefix(root).ok()?;
    let mut parts = Vec::new();
    for component in relative.components() {
        let Component::Normal(part) = component else {
            return None;
        };
        parts.push(part.to_str()?);
    }
    Some(parts.join("/"))
}

#[cfg(test)]
mod tests {
    use super::seed_paths;

    #[test]
    fn snapshot_seeds_stay_below_roots_and_out_of_generated_directories() {
        let paths = [
            "jira/build/tooling.ts".to_owned(),
            "jira/dist/built.js".to_owned(),
            "jira/src/a.ts".to_owned(),
            "jira/src/a.css".to_owned(),
            "jira/src/readme.md".to_owned(),
            "platform/button.tsx".to_owned(),
        ];

        assert_eq!(
            seed_paths("/repo", &["jira".to_owned()], &paths),
            ["jira/build/tooling.ts", "jira/src/a.ts", "jira/src/a.css"]
        );
    }
}
