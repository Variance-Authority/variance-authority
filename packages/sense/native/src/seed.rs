//! Repository files under configured roots, found without serialising directory I/O.

use std::fs;
use std::path::{Component, Path, PathBuf};

use napi_derive::napi;
use rayon::prelude::*;
use rayon::ThreadPoolBuilder;

const EXTENSIONS: &[&str] = &[
    "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "css", "scss", "sass", "less",
];
const READERS: usize = 6;

struct Directory {
    absolute: PathBuf,
    prefix: String,
    seeded: bool,
}

struct Found {
    directories: Vec<Directory>,
    files: Vec<String>,
}

/// The same seed set as `files.ts`, with independent directory reads fanned over
/// the filesystem width rather than performed by one JavaScript thread.
#[napi]
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
