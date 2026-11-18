//! The tree itself, as the languages that resolve against it see it. Python
//! looks for a file under its source roots, Rust walks a module tree, Java and
//! Kotlin read a package's directory, and Swift takes a target's whole
//! directory. Each is a question about the paths the walk already holds, so
//! each is a lookup and never a syscall: a Python namespace package spread over
//! nineteen roots asks whether a path exists seventy-six times per specifier.
//!
//! A language's index over the tree is built at most once per world, before
//! the resolve pool asks it anything ([`World::prewarm`]): built inside the
//! pool, one thread would wait on a `OnceLock` another thread's work-stealing
//! may be running the initialiser of.

// compass: variance-authority.reach.source-scan

use std::collections::HashMap;
use std::sync::OnceLock;

use crate::order::code_unit;
use crate::read::Read;
use crate::read_any::Language;

/// What files of the tree say, read together:
/// nothing for a file that was not parsed.
pub(crate) type Parsing<'a> = &'a (dyn Fn(&[&str]) -> Vec<Option<Read>> + Sync);

/// A file's text: nothing for one that cannot be read.
pub(crate) type Texting<'a> = &'a (dyn Fn(&str) -> Option<String> + Sync);

/// What every resolver over the tree may ask about it.
pub(crate) struct World<'a> {
    known: Option<&'a HashMap<String, u32>>,
    listed: Option<&'a [String]>,
    parsing: Option<Parsing<'a>>,
    texting: Option<Texting<'a>>,
    sorted: OnceLock<Vec<&'a str>>,
    python: OnceLock<Vec<String>>,
    rust: OnceLock<crate::resolve_rust::Index>,
    swift: OnceLock<crate::resolve_swift::Index>,
    jvm: OnceLock<Vec<String>>,
}

impl<'a> World<'a> {
    /// A world over Git's listing: `known` answers whether a path is held,
    /// and `listed`, when the caller has them, are the same paths in the
    /// order a sorted walk of the tree needs.
    pub(crate) fn new(known: Option<&'a HashMap<String, u32>>, listed: Option<&'a [String]>) -> Self {
        Self { known, listed, parsing: None, texting: None, sorted: OnceLock::new(), python: OnceLock::new(), rust: OnceLock::new(), swift: OnceLock::new(), jvm: OnceLock::new() }
    }

    /// The same world, able to say what its files hold. A world over a bare
    /// list of paths cannot, and a language that reads its neighbours falls
    /// back to the layout their paths alone give.
    pub(crate) fn reading(self, parsing: Parsing<'a>, texting: Texting<'a>) -> Self {
        Self { parsing: Some(parsing), texting: Some(texting), ..self }
    }

    /// What each of `paths` says, in their order.
    pub(crate) fn parsed(&self, paths: &[&str]) -> Vec<Option<Read>> {
        match self.parsing {
            Some(parsing) => parsing(paths),
            None => paths.iter().map(|_| None).collect(),
        }
    }

    /// The text of one file.
    pub(crate) fn text(&self, path: &str) -> Option<String> {
        self.texting.and_then(|texting| texting(path))
    }

    /// The module tree the crates' `mod` lines declare, and the crates by name.
    pub(crate) fn rust_index(&self) -> &crate::resolve_rust::Index {
        self.rust.get_or_init(|| crate::resolve_rust::Index::of(self))
    }

    /// The targets every `Package.swift` declares, by module name.
    pub(crate) fn swift_index(&self) -> &crate::resolve_swift::Index {
        self.swift.get_or_init(|| crate::resolve_swift::Index::of(self))
    }

    /// The JVM source roots, derived from the package each directory declares.
    pub(crate) fn jvm_roots(&self) -> &[String] {
        self.jvm.get_or_init(|| crate::resolve_jvm::roots(self))
    }

    /// Whether the tree holds this repository path.
    pub(crate) fn has(&self, path: &str) -> bool {
        self.known.is_some_and(|known| known.contains_key(path))
    }

    /// Every path, sorted by code unit.
    fn sorted(&self) -> &[&'a str] {
        self.sorted.get_or_init(|| {
            let mut paths: Vec<&'a str> = match self.listed {
                Some(listed) => listed.iter().map(String::as_str).collect(),
                None => self.known.map(|known| known.keys().map(String::as_str).collect()).unwrap_or_default(),
            };
            if self.listed.is_none() {
                paths.sort_unstable_by(|left, right| code_unit(left, right));
            }
            paths
        })
    }

    /// Every path at any depth below a directory, sorted: the run between the
    /// first path not less than `dir/` and the first not less than `dir0`.
    pub(crate) fn below(&self, directory: &str) -> &[&'a str] {
        let sorted = self.sorted();
        if directory.is_empty() {
            return sorted;
        }
        let (prefix, next) = (format!("{directory}/"), format!("{directory}0"));
        let from = sorted.partition_point(|path| code_unit(path, &prefix).is_lt());
        let to = sorted.partition_point(|path| code_unit(path, &next).is_lt());
        &sorted[from..to.max(from)]
    }

    /// Every path directly inside a directory, sorted.
    pub(crate) fn under(&self, directory: &str) -> impl Iterator<Item = &'a str> + '_ {
        let depth = if directory.is_empty() { 0 } else { directory.split('/').count() };
        self.below(directory).iter().copied().filter(move |path| path.split('/').count() == depth + 1)
    }

    /// The importing file as the tree spells it: `toRepoPath` in
    /// `repo-path.ts`, for a path already relative to the root.
    pub(crate) fn importer<'f>(&self, file: &'f str) -> Option<&'f str> {
        if file.is_empty() {
            return None;
        }
        let mut only_listed = false;
        for part in file.split('/') {
            if part.is_empty() || part == "." || part == ".." || crate::path::excluded_when_listed(part) {
                return None;
            }
            only_listed |= crate::path::excluded(part);
        }
        (!only_listed || self.has(file)).then_some(file)
    }

    /// The source roots Python looks for a top-level module under.
    pub(crate) fn python_roots(&self) -> &[String] {
        self.python.get_or_init(|| crate::resolve_python::roots_in(self.below(""), self.below("")))
    }

    /// Builds the indexes `languages` resolve through, here rather than in
    /// the resolve pool.
    pub(crate) fn prewarm(&self, languages: impl IntoIterator<Item = Language>) {
        for language in languages {
            match language {
                Language::Python => {
                    self.python_roots();
                }
                Language::Rust => {
                    self.rust_index();
                }
                Language::Swift => {
                    self.swift_index();
                }
                Language::Java | Language::Kotlin => {
                    self.jvm_roots();
                }
                _ => {}
            }
        }
    }

    /// Where `request`, written in a `language` file at `file`, lands.
    /// Every file it reaches, the first of them the request's target.
    pub(crate) fn resolve(&self, language: Language, file: &str, written: &str, item: bool) -> Vec<String> {
        let (Some(request), Some(from)) = (crate::specifier::request_of(written), self.importer(file)) else {
            return Vec::new();
        };
        match language {
            Language::Python => crate::resolve_python::resolve(self, from, request),
            Language::Rust => crate::resolve_rust::resolve(self, from, request, item),
            Language::Swift => crate::resolve_swift::resolve(self, from, request),
            Language::Java | Language::Kotlin => crate::resolve_jvm::resolve(self, from, request),
            _ => Vec::new(),
        }
    }
}

/// `world.test.ts`'s questions every language but JavaScript asks the tree.
#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::World;

    const PATHS: [&str; 5] = ["a/b.java", "a/b/c.java", "a/b/deep/d.java", "ab/e.java", "z.java"];

    fn asked<R>(ask: impl FnOnce(&World) -> R) -> R {
        let known: HashMap<String, u32> = PATHS.iter().map(|path| (*path).to_owned()).zip(0..).collect();
        ask(&World::new(Some(&known), None))
    }

    #[test]
    fn tells_what_is_directly_inside_a_directory_from_what_is_anywhere_below_it() {
        // A Java package is a directory, not a subtree; a Swift target is a subtree.
        asked(|world| {
            assert_eq!(world.under("a/b").collect::<Vec<_>>(), ["a/b/c.java"]);
            assert_eq!(world.below("a/b"), ["a/b/c.java", "a/b/deep/d.java"]);
        });
    }

    #[test]
    fn does_not_let_a_directory_reach_a_sibling_whose_name_it_prefixes() {
        // `ab` sorts between `a/…` entries and would fall inside a plain prefix scan of `a`.
        asked(|world| assert_eq!(world.below("a"), ["a/b.java", "a/b/c.java", "a/b/deep/d.java"]));
    }

    #[test]
    fn answers_for_the_root_as_the_whole_tree() {
        asked(|world| {
            assert_eq!(world.below(""), PATHS);
            assert_eq!(world.under("").collect::<Vec<_>>(), ["z.java"]);
        });
    }

    #[test]
    fn has_no_text_for_a_world_built_from_paths_alone() {
        asked(|world| assert_eq!(world.text("a/b.java"), None));
    }
}
