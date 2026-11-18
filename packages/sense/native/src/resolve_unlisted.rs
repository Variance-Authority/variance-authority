//! An unresolved explicit relative import can name a file Git ignores.
//! Probe only that written path; parent components keep the resolver's answer.

// compass: variance-authority.reach.source-scan

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};

pub(super) fn explicit(root: &Path, from: &Path, request: &str, known: Option<&HashMap<String, u32>>,
    is_file: impl FnOnce(&Path) -> bool,
) -> Option<PathBuf> {
    if !(request.starts_with("./") || request.starts_with("../")) || !crate::seed::readable(request) { return None; }
    // A parent after a symbolic directory cannot be reduced lexically: OXC
    // owns that request, including a refusal, rather than a direct OS probe.
    if Path::new(request).components().any(|part| part == Component::ParentDir) { return None; }
    let path: PathBuf = from.parent()?.join(request).components().collect();
    let relative = path.strip_prefix(root).ok()?.to_str()?;
    if known.is_none_or(|known| known.contains_key(relative)) { return None; }
    is_file(&path).then_some(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn only_the_exact_unlisted_relative_file_is_probed() {
        let root = Path::new("/repo");
        let from = root.join("src/a.ts");
        let known = HashMap::from([("src/known.ts".into(), 0)]);
        let count = Cell::new(0);
        for request in ["package/file.js", "./missing", "./known.ts", "../ignored.js", "./symbolic/../actual.ts"] {
            assert!(explicit(root, &from, request, Some(&known), |_| { count.set(count.get() + 1); true }).is_none());
        }
        assert_eq!(count.get(), 0);
        assert!(explicit(root, &from, "./missing.js", Some(&known), |path| {
            count.set(count.get() + 1); assert_eq!(path, Path::new("/repo/src/missing.js")); false
        }).is_none());
        assert_eq!(count.get(), 1, "a missing import probes only its exact written file");
    }
}
