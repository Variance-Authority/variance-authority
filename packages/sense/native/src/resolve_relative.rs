//! A relative request answered from git's listing, before any resolver runs.
//!
//! Most requests a walk resolves name a file beside the one they are written
//! in. The module resolver finds it by asking for every candidate in turn, and
//! each ask builds a cached path, walks it and allocates; the listing holds
//! every candidate already, so the same order of candidates costs a hash
//! lookup each. Whatever the listing cannot settle alone — built output, a
//! directory with a `package.json`, a request no listed candidate answers — is
//! the resolver's, as before. A candidate git does not list is passed over: an
//! ignored file earlier in the order than a listed one is not the answer here,
//! where the resolver, reading the disk, would take it.

// compass: variance-authority.reach.source-scan

use std::path::Path;

use super::{Resolvers, EXTENSION_ALIASES, MODULE_EXTENSIONS, STYLE_EXTENSIONS};
use crate::emitted::Entry;

/// What the listing settled for a relative request.
pub(super) enum Listed {
    /// The file the module resolver would find, spelled from the root.
    File(String),
    /// Nothing the listing can answer alone: the resolvers decide.
    Unsettled,
}

impl Resolvers {
    /// A missing parent rules out a relative request before oxc retains all
    /// its candidate paths. Virtual outputs and links are the file system's
    /// answer; rootDirs may redirect the request elsewhere.
    pub(super) fn missing_parent(&self, root: &Path, from: &Path, request: &str, tsconfig: Option<&oxc_resolver::TsConfig>) -> bool {
        if request.contains(['?', '#']) || tsconfig.is_some_and(|config| config.compiler_options.root_dirs.is_some()) {
            return false;
        }
        if !(request.starts_with("./") || request.starts_with("../")) || request.ends_with('/') { return false; }
        let Some(directory) = from.parent() else { return false };
        let path = crate::conditions::normalize(&directory.join(request));
        if !path.starts_with(root) { return false; }
        let Some(parent) = path.parent() else { return false };
        match oxc_resolver::FileSystem::metadata(&self.emitted, parent) {
            Ok(metadata) => !metadata.is_dir(),
            Err(error) => matches!(error.kind(), std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory),
        }
    }

    /// The file a relative `request` written in `from` names, read from the
    /// listing in the order the module resolver tries candidates: the
    /// extension a `.js` stands for, the path as written, the path with each
    /// extension, then the directory's `index` with each.
    pub(super) fn listed(&self, root: &Path, from: &Path, request: &str) -> Listed {
        let Some(path) = joined(root, from, request) else {
            return Listed::Unsettled;
        };
        if path.split('/').any(|part| part == "node_modules") || self.emitted.emits(&root.join(&path)) {
            return Listed::Unsettled;
        }
        let name = path.rsplit_once('/').map_or(path.as_str(), |(_, name)| name);
        // A name that only starts with a dot, such as `.js`, has no extension.
        let extension = name.rfind('.').filter(|&at| at > 0).map(|at| &name[at..]);
        let aliased = extension.and_then(|extension| EXTENSION_ALIASES.iter().find(|(written, _)| *written == extension));
        if let Some((written, aliased)) = aliased {
            let stem = &path[..path.len() - written.len()];
            if let Some(listed) = self.first(aliased.iter().map(|alias| format!("{stem}{alias}"))) {
                return listed;
            }
            // A written `.js` that is there and none of its aliases is an
            // error the resolver words, and the next resolver may answer.
            if self.emitted.spelled(&path) != Some(Entry::Unlisted) {
                return Listed::Unsettled;
            }
        }
        let files = std::iter::once(path.clone()).chain(extensions().map(|extension| format!("{path}{extension}")));
        if let Some(listed) = self.first(files) {
            return listed;
        }
        if self.emitted.spelled(&path) != Some(Entry::Directory) {
            return Listed::Unsettled;
        }
        let inside = |name: &str| if path.is_empty() { name.to_owned() } else { format!("{path}/{name}") };
        if self.emitted.spelled(&inside("package.json")) != Some(Entry::Unlisted) {
            return Listed::Unsettled;
        }
        self.first(extensions().map(|extension| inside(&format!("index{extension}")))).unwrap_or(Listed::Unsettled)
    }

    /// The first candidate the listing settles: a regular file is the
    /// answer, and a symbolic link stops the walk, since only the disk says
    /// what it names.
    fn first(&self, candidates: impl Iterator<Item = String>) -> Option<Listed> {
        for candidate in candidates {
            match self.emitted.spelled(&candidate) {
                Some(Entry::File) => return Some(Listed::File(candidate)),
                Some(Entry::Linked) | None => return Some(Listed::Unsettled),
                Some(Entry::Directory | Entry::Unlisted) => {}
            }
        }
        None
    }
}

/// The module resolver's extensions, in the order it tries them.
pub(super) fn extensions() -> impl Iterator<Item = &'static str> {
    MODULE_EXTENSIONS.iter().chain(STYLE_EXTENSIONS).copied().chain(std::iter::once(".json"))
}

/// A relative request joined onto the directory of `from`, spelled from
/// `root` with `/` and no `.` or `..` parts, or `None` for a request the
/// listing does not answer: one naming a directory only, or leaving the root.
pub(super) fn joined(root: &Path, from: &Path, request: &str) -> Option<String> {
    if !(request.starts_with("./") || request.starts_with("../")) || request.ends_with('/') {
        return None;
    }
    let directory = from.parent()?.strip_prefix(root).ok()?.to_str()?;
    let mut parts: Vec<&str> = directory.split('/').filter(|part| !part.is_empty()).collect();
    for part in request.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            part => parts.push(part),
        }
    }
    Some(parts.join("/"))
}

#[cfg(test)]
mod tests {
    use super::{joined, Listed};
    use crate::emitted::{Emitted, Listing};
    use crate::resolve::{Resolvers, Tsconfig};
    use std::collections::HashMap;
    use std::path::Path;
    use std::sync::Arc;

    #[test]
    fn a_relative_request_is_spelled_from_the_root() {
        let root = Path::new("/repo");
        let from = Path::new("/repo/src/a/file.ts");
        assert_eq!(joined(root, from, "./b").as_deref(), Some("src/a/b"));
        assert_eq!(joined(root, from, "../c/./d.js").as_deref(), Some("src/c/d.js"));
        assert_eq!(joined(root, from, "../../../out"), None);
        assert_eq!(joined(root, from, "./dir/"), None);
        assert_eq!(joined(root, from, "pkg"), None);
    }

    #[test]
    fn a_parent_relative_request_keeps_native_directory_components() {
        let root = std::env::temp_dir().join(format!("sense-native-relative-{}", std::process::id()));
        std::fs::create_dir_all(root.join("src/nested")).unwrap();
        std::fs::create_dir_all(root.join("src/shared")).unwrap();
        std::fs::write(root.join("src/nested/from.ts"), "export {};").unwrap();
        std::fs::write(root.join("src/shared/value.ts"), "export const value = 1;").unwrap();
        let root = std::fs::canonicalize(root).unwrap();
        let resolver = Resolvers::new(Tsconfig::Off, None);
        assert_eq!(resolver.resolve(&root, &root.join("src/nested/from.ts"), "../shared/value", None).as_deref(), Some("src/shared/value.ts"));
        std::fs::remove_dir_all(root).unwrap();
    }

    /// Whether any resolver `answer` asks, run without the missing-parent
    /// guard, finds a file for the request.
    #[cfg(unix)]
    fn found(resolvers: &Resolvers, from: &Path, request: &str) -> bool {
        let (_, modules) = resolvers.governed_by(from);
        [modules.as_ref(), &resolvers.exact, resolvers.declarations_for(&modules).as_ref()]
            .iter()
            .any(|resolver| resolver.resolve_file(from, request).is_ok())
    }

    /// The guard stops a request only where no resolver would find it: a
    /// parent git does not list is still there when the emitted view holds it
    /// as unbuilt output, an ignored directory on disk, a directory reached
    /// through a link, or a `rootDirs` sibling inherited through `extends`.
    #[cfg(unix)]
    #[test]
    fn a_parent_git_does_not_list_stops_a_request_only_where_no_resolver_finds_it() {
        let root = std::env::temp_dir().join(format!("sense-missing-parent-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let listed = [
            ("from.ts", "export {};"),
            ("pkg/package.json", r#"{"name":"pkg"}"#),
            ("pkg/tsconfig.json", r#"{"compilerOptions":{"rootDir":"src","outDir":"dist"}}"#),
            ("pkg/src/from.ts", "export {};"),
            ("pkg/src/sub/value.ts", "export const value = 1;"),
            ("roots/tsconfig.json", r#"{"extends":"./base.json"}"#),
            ("roots/base.json", r#"{"compilerOptions":{"rootDirs":["virtual","src"]}}"#),
            ("roots/src/from.ts", "export {};"),
            ("roots/src/value.ts", "export const value = 1;"),
        ];
        for (path, text) in listed.iter().chain(&[("gen/out/value.ts", "export const value = 1;")]) {
            std::fs::create_dir_all(root.join(path).parent().unwrap()).unwrap();
            std::fs::write(root.join(path), text).unwrap();
        }
        std::os::unix::fs::symlink("pkg/src", root.join("linked")).unwrap();
        let root = std::fs::canonicalize(root).unwrap();
        let paths: Vec<&str> = listed.iter().map(|(path, _)| *path).chain(["linked"]).collect();
        let files: Arc<HashMap<String, u32>> = Arc::new(paths.iter().map(|path| (*path).to_owned()).zip(0..).collect());
        let regular = paths.iter().map(|path| *path != "linked").collect();
        let listing = Listing::of(Arc::clone(&files), Arc::new(regular), &[]);
        let resolvers = Resolvers::over(Tsconfig::Auto, None, Emitted::listed(&root, Some(Arc::new(listing))));
        // (from, request, whether a resolver finds it)
        let requests = [
            // Unbuilt output: `dist/sub` is a directory because `src/sub` is.
            ("pkg/src/from.ts", "../dist/sub/value.js", true),
            // A directory git ignores, which the disk holds.
            ("from.ts", "./gen/out/value", true),
            // A directory beneath a link git lists as a blob.
            ("from.ts", "./linked/sub/value", true),
            // A request written beside a link resolves lexically, not from where the link leads.
            ("linked/from.ts", "../dist/sub/value.js", false),
            // A `rootDirs` sibling with no directory of its own, declared in the config's base.
            ("roots/src/from.ts", "../virtual/value", true),
            // A case the disk may fold: found on a disk that ignores case, not on one that keeps it.
            ("pkg/src/from.ts", "./SUB/value", cfg!(target_os = "macos")),
            ("pkg/src/from.ts", "./nowhere/value", false),
            ("pkg/src/from.ts", "./sub/value.ts/inner", false),
            ("pkg/src/from.ts", "../dist/gone/value.js", false),
        ];
        for (from, request, expected) in requests {
            let from = root.join(from);
            let (tsconfig, _) = resolvers.governed_by(&from);
            let stopped = resolvers.missing_parent(&root, &from, request, tsconfig.as_deref());
            let found = found(&resolvers, &from, request);
            assert_eq!(found, expected, "{request} from {} by a resolver", from.display());
            assert!(!(stopped && found), "{request} from {} is stopped, yet a resolver finds it", from.display());
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_listing_answers_a_relative_request_as_the_resolver_does() {
        let root = std::env::temp_dir().join(format!("sense-listed-relative-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let paths = [
            "src/from.ts",
            "src/alias.ts",
            "src/alias.js",
            "src/plain.js",
            "src/module.mts",
            "src/view.tsx",
            "src/exact.ts",
            "src/both.ts",
            "src/both/index.ts",
            "src/folder/index.js",
            "src/folder/index.ts",
            "src/package/package.json",
            "src/package/main.ts",
            "src/package/index.ts",
            "src/data.json",
            "src/data/index.ts",
            "src/linked.ts",
            "src/linked.js",
            "src/.ts",
            "src/.js",
            "up/sibling.ts",
        ];
        for path in paths {
            std::fs::create_dir_all(root.join(path).parent().unwrap()).unwrap();
            let text = if path.ends_with("package.json") { r#"{"main":"main.ts"}"# } else { "export {};\n" };
            std::fs::write(root.join(path), text).unwrap();
        }
        let root = std::fs::canonicalize(root).unwrap();
        let from = root.join("src/from.ts");
        let files: Arc<HashMap<String, u32>> = Arc::new(paths.iter().map(|path| (*path).to_owned()).zip(0..).collect());
        // `src/linked.ts` is listed as a symbolic link, which only the disk reads.
        let regular = paths.iter().map(|path| *path != "src/linked.ts").collect();
        let listing = Listing::of(Arc::clone(&files), Arc::new(regular), &[]);
        let listed = Resolvers::over(Tsconfig::Auto, None, Emitted::listed(&root, Some(Arc::new(listing))));
        let disk = Resolvers::over(Tsconfig::Auto, None, Emitted::listed(&root, None));
        let requests = [
            ("./alias.js", Some("src/alias.ts")),
            ("./plain.js", Some("src/plain.js")),
            ("./module.mjs", Some("src/module.mts")),
            ("./view", Some("src/view.tsx")),
            ("./exact.ts", Some("src/exact.ts")),
            ("./both", Some("src/both.ts")),
            ("./folder", Some("src/folder/index.ts")),
            ("./package", None),
            ("./data", Some("src/data.json")),
            ("./.js", Some("src/.js")),
            ("./linked", None),
            ("../up/sibling", Some("up/sibling.ts")),
            ("./missing", None),
        ];
        for (request, settled) in requests {
            let answer = match listed.listed(&root, &from, request) {
                Listed::File(file) => Some(file),
                Listed::Unsettled => None,
            };
            assert_eq!(answer.as_deref(), settled, "{request} from the listing");
            if let Some(file) = settled {
                let resolved = disk.resolve(&root, &from, request, Some(&files));
                assert_eq!(resolved.as_deref(), Some(file), "{request} from the resolver");
            }
        }
        let _ = std::fs::remove_dir_all(&root);
    }
}
