//! Keep declaration traversal within the selected installed package.

// compass: variance-authority.reach.relations

use std::borrow::Cow;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// The selected package's canonical identity, proved on its first declaration edge.
pub(super) struct Selected {
    manifest: Option<PathBuf>,
    canonical: OnceLock<Option<PathBuf>>,
}

impl Selected {
    pub(super) fn new(manifest: Option<&Path>) -> Self {
        Self { manifest: manifest.map(Path::to_path_buf), canonical: OnceLock::new() }
    }

    /// The declaration resolver already followed the target's symlinks; retain
    /// that engine answer while independently proving the selected install.
    pub(super) fn permits(&self, answer: &oxc_resolver::Resolution, specifier: &str) -> bool {
        let package = self.canonical.get_or_init(|| self.manifest.as_ref()?.canonicalize().ok());
        let Some(package) = package.as_deref() else { return false };
        if let Some(other) = answer.package_json() {
            if other.path().canonicalize().ok().as_deref() != Some(package) { return false; }
        } else if !specifier.starts_with('.') { return false; }
        let Some(directory) = package.parent() else { return false };
        // OS realpath restores casing the engine does not record. Only an
        // ambiguous boundary or nested-install spelling needs that extra proof.
        let target = match answer.path().strip_prefix(directory) {
            Ok(relative) if !relative.components().any(|component|
                component.as_os_str().as_encoded_bytes().eq_ignore_ascii_case(b"node_modules")) => Cow::Borrowed(answer.path()),
            _ => {
                let Ok(path) = answer.path().canonicalize() else { return false };
                Cow::Owned(path)
            }
        };
        let Ok(relative) = target.strip_prefix(directory) else { return false };
        !relative.components().any(|component| component.as_os_str() == "node_modules")
    }
}

#[cfg(test)]
mod tests {
    use crate::resolve::{Resolvers, Tsconfig};

    #[test]
    fn selected_boundary_is_lazy_and_reuses_only_its_selected_manifest_proof() {
        let root = std::env::temp_dir().join(format!("sense-lexicon-boundary-lazy-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let manifest = root.join("package.json");
        let target = root.join("index.d.ts");
        let from = root.join("consumer.ts");
        std::fs::write(&target, "export {};").unwrap();
        let resolver = Resolvers::new(Tsconfig::Off, None);
        let answer = resolver.declaration_resolution(&from, "./index").unwrap();
        assert!(answer.package_json().is_none());
        let selected = super::Selected::new(Some(&manifest));
        std::fs::write(&manifest, "{}").unwrap();
        assert!(selected.permits(&answer, "./index"), "construction did no filesystem work");
        std::fs::remove_file(&manifest).unwrap();
        assert!(selected.permits(&answer, "./index"));
        assert!(!selected.permits(&answer, "kit"));
        assert!(!super::Selected::new(None).permits(&answer, "./index"));
        let absent = super::Selected::new(Some(&manifest));
        assert!(!absent.permits(&answer, "./index"));
        std::fs::write(&manifest, "{}").unwrap();
        assert!(!absent.permits(&answer, "./index"));
        let current = Resolvers::new(Tsconfig::Off, None).declaration_resolution(&from, "./index").unwrap();
        let selected = super::Selected::new(Some(&manifest));
        assert!(selected.permits(&current, "./index"));
        std::fs::remove_file(&manifest).unwrap();
        assert!(!selected.permits(&current, "./index"), "resolved manifest is still proved per edge");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn selected_boundary_keeps_realpath_containment_and_rejects_other_installs() {
        use std::os::unix::fs::symlink;
        let root = std::env::temp_dir().join(format!("sense-lexicon-boundary-realpath-{}", std::process::id()));
        let package = root.join("kit");
        let nested = package.join("node_modules/other");
        let sibling = root.join("other");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::create_dir_all(&sibling).unwrap();
        let manifest = package.join("package.json");
        let target = package.join("index.d.ts");
        let other_manifest = sibling.join("package.json");
        let outside = sibling.join("index.d.ts");
        for path in [&manifest, &target, &other_manifest, &outside, &nested.join("index.d.ts")] {
            std::fs::write(path, "{}").unwrap();
        }
        let alias = root.join("alias");
        symlink(&package, &alias).unwrap();
        let resolver = Resolvers::new(Tsconfig::Off, None);
        let from = alias.join("consumer.ts");
        let resolve = |request| resolver.declaration_resolution(&from, request).unwrap();
        let selected = super::Selected::new(Some(&alias.join("package.json")));
        let answer = resolve("./index");
        assert_eq!(answer.path(), target.canonicalize().unwrap());
        assert!(selected.permits(&answer, "./index"));
        assert!(!selected.permits(&resolve("../other/index"), "../other/index"));
        assert!(!selected.permits(&resolve("./node_modules/other/index"), "./node_modules/other/index"));
        let escaped = package.join("escaped.d.ts");
        symlink(&outside, &escaped).unwrap();
        let answer = resolve("./escaped");
        assert_eq!(answer.path(), outside.canonicalize().unwrap(), "the engine owns the physical target");
        assert!(!selected.permits(&answer, "./escaped"));
        symlink(&target, package.join("inside.d.ts")).unwrap();
        assert!(selected.permits(&resolve("./inside"), "./inside"));
        assert!(resolver.declaration_resolution(&from, "./missing").is_none(), "a missing target supplies no boundary proof");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_case_alias_of_an_installed_package_keeps_its_canonical_boundary() {
        let root = std::env::temp_dir().join(format!("sense-lexicon-boundary-package-case-{}", std::process::id()));
        let package = root.join("node_modules/kit");
        std::fs::create_dir_all(&package).unwrap();
        let manifest = package.join("package.json");
        std::fs::write(&manifest, r#"{"name":"kit","types":"index.d.ts"}"#).unwrap();
        std::fs::write(package.join("index.d.ts"), "export {};").unwrap();
        if root.join("node_modules/KIT").is_dir() {
            let resolver = Resolvers::new(Tsconfig::Off, None);
            let answer = resolver.declaration_resolution(&root.join("consumer.ts"), "KIT").unwrap();
            let selected = super::Selected::new(answer.package_json().map(|manifest| manifest.path()));
            assert!(selected.permits(&answer, "KIT"), "the physical package remains inside its selected install");
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_case_alias_does_not_hide_a_nested_node_modules_component() {
        let root = std::env::temp_dir().join(format!("sense-lexicon-boundary-nested-case-{}", std::process::id()));
        let nested = root.join("node_modules/other");
        std::fs::create_dir_all(&nested).unwrap();
        let manifest = root.join("package.json");
        std::fs::write(&manifest, "{}").unwrap();
        std::fs::write(nested.join("index.d.ts"), "export {};").unwrap();
        if root.join("NODE_MODULES").is_dir() {
            let resolver = Resolvers::new(Tsconfig::Off, None);
            let request = "./NODE_MODULES/other/index";
            let answer = resolver.declaration_resolution(&root.join("consumer.ts"), request).unwrap();
            let selected = super::Selected::new(Some(&manifest));
            assert!(!selected.permits(&answer, request), "physical node_modules stays outside declaration traversal");
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
