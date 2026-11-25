//! The package manifests selected by a workspace's npm, Yarn or pnpm globs.

// compass: variance-authority.report.agent-surface

use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};

use serde_json::Value;

const NPM: &[&str] = &["package.json"];
const PNPM: &[&str] = &["package.json", "package.yaml"];

pub(super) fn members(root: &Path) -> Option<(bool, Vec<(PathBuf, Value)>)> {
    let path = root.join("package.json");
    if !path.try_exists().ok()? {
        return Some((false, Vec::new()));
    }
    let first = manifest(&path)?;
    let globs =
        first.get("workspaces").and_then(|value| if value.is_object() { value.get("packages") } else { Some(value) });
    let listed = list(globs)?;
    let mut pnpm = None;
    let (listed, names) = if listed.is_empty() {
        let file = root.join("pnpm-workspace.yaml");
        if file.try_exists().ok()? {
            pnpm = Some(manifest(&file)?);
        }
        (list(pnpm.as_ref().and_then(|value| value.get("packages")))?, PNPM)
    } else {
        (listed, NPM)
    };
    let patterns = listed.iter().map(Value::as_str).collect::<Option<Vec<_>>>()?;
    let mut excluded = HashSet::new();
    for pattern in patterns.iter().filter_map(|pattern| pattern.strip_prefix('!')) {
        excluded.extend(matches(root, pattern, names, true)?);
    }
    let mut seen = HashSet::from([root.to_owned()]);
    let mut found = Vec::new();
    for pattern in patterns.iter().filter(|pattern| !pattern.starts_with('!')) {
        for path in matches(root, pattern, names, false)? {
            if excluded.contains(&path) {
                continue;
            }
            let real = super::super::physical(path.parent()?);
            if !real.starts_with(root) {
                return None;
            }
            if seen.insert(real) {
                found.push((path.clone(), manifest(&path)?));
            }
        }
    }
    let workspaces = !listed.is_empty();
    found.insert(0, (path, first));
    Some((workspaces, found))
}

fn list(raw: Option<&Value>) -> Option<&[Value]> {
    match raw {
        None | Some(Value::Null) => Some(&[]),
        Some(raw) => Some(raw.as_array()?.as_slice()),
    }
}

fn manifest(path: &Path) -> Option<Value> {
    let bytes = fs::read(path).ok()?;
    let value: Value = if path.extension().is_some_and(|ext| ext == "yaml") {
        if bytes.iter().all(u8::is_ascii_whitespace) {
            Value::Null
        } else {
            yaml_serde::from_slice(&bytes).ok()?
        }
    } else {
        serde_json::from_slice(&bytes).ok()?
    };
    (value.is_object() || value.is_null()).then_some(value)
}

fn matches(root: &Path, pattern: &str, names: &[&str], dot: bool) -> Option<Vec<PathBuf>> {
    // Workspace roots outside the source index need a scoped index of their own.
    if pattern.is_empty() || pattern.contains(['{', '}', '(', ')', '\\']) {
        return None;
    }
    let mut directories = vec![root.to_owned()];
    for component in Path::new(pattern).components() {
        let name = match component {
            Component::CurDir => continue,
            Component::Normal(name) => name.to_str()?,
            _ => return None,
        };
        if never(name) {
            return Some(Vec::new());
        }
        if name == "**" {
            let mut expanded = Vec::new();
            for dir in directories {
                descendants(dir, root, dot, &mut expanded)?;
            }
            directories = expanded;
        } else if name.contains(['*', '?', '[']) {
            let mut next = Vec::new();
            for at in directories {
                next.extend(children(&at, name, dot)?);
            }
            directories = next;
        } else {
            for path in &mut directories {
                path.push(name);
            }
        }
    }
    directories.sort_unstable_by(|a, b| crate::order::code_unit(&a.to_string_lossy(), &b.to_string_lossy()));
    directories.dedup();
    let mut out = Vec::new();
    for dir in directories {
        // Keep preference per directory. A manifest at another casing does not
        // count for a spelling the member list can reach.
        let candidates = names.iter().any(|name| dir.join(name).is_file());
        if !candidates {
            continue;
        }
        let held = fs::read_dir(&dir)
            .ok()?
            .map(|entry| entry.map(|one| one.file_name()))
            .collect::<Result<HashSet<_>, _>>()
            .ok()?;
        if let Some(name) = names.iter().find(|name| held.contains(std::ffi::OsStr::new(name))) {
            out.push(dir.join(name));
        }
    }
    Some(out)
}

fn never(name: &str) -> bool {
    matches!(name, "node_modules" | "bower_components")
}

fn children(at: &Path, name: &str, dot: bool) -> Option<Vec<PathBuf>> {
    let listing = match fs::read_dir(at) {
        Ok(listing) => listing,
        Err(error) if matches!(error.kind(), std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory) => {
            return Some(Vec::new())
        }
        Err(_) => return None,
    };
    let mut found = Vec::new();
    for entry in listing {
        let entry = entry.ok()?;
        let file_name = entry.file_name();
        let candidate = file_name.to_str()?;
        if never(candidate) || (!dot && candidate.starts_with('.') && !name.starts_with('.')) {
            continue;
        }
        if fast_glob::glob_match(name.as_bytes(), candidate.as_bytes()) && entry.path().is_dir() {
            found.push(entry.path());
        }
    }
    Some(found)
}

fn descendants(dir: PathBuf, root: &Path, dot: bool, found: &mut Vec<PathBuf>) -> Option<()> {
    // Follow directory links within the same workspace. Remember the ancestors
    // of each spelling to stop cycles while preserving distinct member globs.
    let mut pending = vec![(dir, Vec::new())];
    while let Some((at, mut ancestors)) = pending.pop() {
        if !at.is_dir() {
            continue;
        }
        let real = super::super::physical(&at);
        if ancestors.contains(&real) {
            continue;
        }
        if !real.starts_with(root) {
            return None;
        }
        ancestors.push(real);
        pending.extend(children(&at, "*", dot)?.into_iter().map(|child| (child, ancestors.clone())));
        found.push(at);
    }
    Some(())
}
