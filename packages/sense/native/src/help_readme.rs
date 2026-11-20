//! The READMEs a mention is looked for in: which are above each asked file,
//! the nearest that is there, and its text, read once however many names
//! under it are asked about, probed and read on every core at once. What a
//! README's text says of a name is `help_mention`'s rule.

// compass: variance-authority.report.agent-surface

use std::collections::{HashMap, HashSet};
use std::path::Path;

use napi_derive::napi;
use rayon::prelude::*;

use crate::help_mention::{mention, Mention, Readme};

/// The READMEs above `files`, every directory from each file's own up to the
/// root inclusive, each probed once: by the README path it is named by, `None`
/// where there is none. Only the nearest README above some file is read, once,
/// as the walk reads only the nearest; one of those that is there and does not
/// read refuses the publish, naming it, as it refuses the walk.
pub(crate) fn readmes<'a>(root: &Path, files: impl Iterator<Item = &'a str>) -> Result<HashMap<String, Option<Readme>>, String> {
    let files: Vec<&str> = files.collect();
    let mut asked: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for file in &files {
        for from in candidates(file) {
            if !seen.insert(from.clone()) {
                // A directory already asked about had its parents asked about with it.
                break;
            }
            asked.push(from);
        }
    }
    // `existsSync`: anything there, a directory included, is the README the walk then reads.
    let there: HashSet<String> = asked.into_par_iter().filter(|from| readme_path(root, from).exists()).collect();
    let mut nearest_ones: HashSet<String> = HashSet::new();
    for file in &files {
        if let Some(from) = candidates(file).find(|from| there.contains(from)) {
            nearest_ones.insert(from);
        }
    }
    let read: HashMap<String, Option<Readme>> = nearest_ones
        .into_par_iter()
        .map(|from| match std::fs::read(readme_path(root, &from)) {
            Ok(bytes) => {
                let readme = Readme { from: from.clone(), text: String::from_utf8_lossy(&bytes).encode_utf16().collect() };
                Ok((from, Some(readme)))
            }
            Err(refused) => Err(format!("{from} is there and could not be read: {refused}")),
        })
        .collect::<Result<_, String>>()?;
    let mut held = read;
    for from in seen {
        if !there.contains(&from) {
            held.insert(from, None);
        }
    }
    Ok(held)
}

/// Where the nearest README above `at`, under `root`, names `name`; `None`
/// when no README is above it or the nearest does not name it. Refused when
/// the nearest is there and does not read.
#[napi(catch_unwind)]
pub fn readme_mention(root: String, at: String, name: String) -> napi::Result<Option<Mention>> {
    let held = readmes(Path::new(&root), std::iter::once(at.as_str())).map_err(napi::Error::from_reason)?;
    Ok(nearest(&held, &at).and_then(|readme| mention(readme, &name)))
}

/// The README paths above `at`, nearest first: `nearest`'s walk.
fn candidates(at: &str) -> impl Iterator<Item = String> + '_ {
    let parts: Vec<&str> = at.split('/').collect();
    let dirs = parts.len() - 1;
    (0..=dirs).rev().map(move |depth| {
        let mut from = parts[..depth].join("/");
        if depth > 0 {
            from.push('/');
        }
        from.push_str("README.md");
        from
    })
}

/// Where the README named `from` is on disk: `path.join`'s, empty parts dropped.
fn readme_path(root: &Path, from: &str) -> std::path::PathBuf {
    from.split('/').filter(|part| !part.is_empty()).fold(root.to_path_buf(), |path, part| path.join(part))
}

/// The nearest README above `at` that exists, out of `held`.
pub(crate) fn nearest<'h>(held: &'h HashMap<String, Option<Readme>>, at: &str) -> Option<&'h Readme> {
    candidates(at).find_map(|from| held.get(&from).and_then(Option::as_ref))
}

#[cfg(test)]
#[path = "help_readme_tests.rs"]
mod tests;
