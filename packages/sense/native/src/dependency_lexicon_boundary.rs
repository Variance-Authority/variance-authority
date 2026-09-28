//! Keep declaration traversal within the selected installed package.

// compass: variance-authority.reach.relations

use std::path::Path;

pub(super) fn permits(manifest: Option<&Path>, resolved_manifest: Option<&Path>, target: &Path, specifier: &str) -> bool {
    let Some(manifest) = manifest else { return false };
    let Ok(package) = manifest.canonicalize() else { return false };
    if let Some(other) = resolved_manifest {
        if other.canonicalize().ok().as_deref() != Some(package.as_path()) { return false; }
    } else if !specifier.starts_with('.') { return false; }
    let Some(directory) = package.parent() else { return false };
    let Ok(target) = target.canonicalize() else { return false };
    let Ok(relative) = target.strip_prefix(directory) else { return false };
    !relative.components().any(|component| component.as_os_str() == "node_modules")
}
