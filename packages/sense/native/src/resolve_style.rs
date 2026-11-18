//! Where a stylesheet's specifier lands. Each form [`style_requests`] spells is
//! asked of the
//! stylesheet resolver first and the importer's module resolver after, and a
//! stylesheet never falls back to a declaration.

// compass: variance-authority.reach.source-index

use std::collections::HashMap;
use std::path::Path;

use super::{request_of, Landing, Resolvers};
use crate::style::style_requests;

impl Resolvers {
    /// The repository file a stylesheet's specifier names, or nothing.
    pub fn resolve_style(&self, root: &Path, from: &Path, written: &str, known: Option<&HashMap<String, u32>>) -> Option<String> {
        let request = request_of(written)?;
        let attempts = style_requests(request);
        let modules = self.modules_for(from);
        for resolver in [&self.styles, modules.as_ref()] {
            for attempt in &attempts {
                let Ok(answer) = resolver.resolve_file(from, attempt) else {
                    continue;
                };
                if let Landing::File(file) = self.land(root, attempt, answer.path(), known) {
                    return Some(file);
                }
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::resolve::Tsconfig;

    /// A checkout of `files`, canonical so a resolved path strips its root.
    fn checkout(name: &str, files: &[(&str, &str)]) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("sense-style-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        for (path, text) in files {
            std::fs::create_dir_all(root.join(path).parent().unwrap()).unwrap();
            std::fs::write(root.join(path), text).unwrap();
        }
        std::fs::canonicalize(root).unwrap()
    }

    fn listed(files: &[&str]) -> HashMap<String, u32> {
        files.iter().zip(0..).map(|(file, at)| ((*file).to_owned(), at)).collect()
    }

    /// `sense.test.ts`: a stylesheet's `@import` lands on its sibling, and
    /// one whose sibling is missing lands nowhere.
    #[test]
    fn an_import_lands_on_the_sheet_beside_it() {
        let root = checkout("import", &[("design/tokens.css", ":root {}"), ("design/button.css", "@import './tokens.css';")]);
        let resolvers = Resolvers::new(Tsconfig::Auto, None);
        let from = root.join("design/button.css");
        assert_eq!(resolvers.resolve_style(&root, &from, "./tokens.css", None), Some("design/tokens.css".to_owned()));
        assert_eq!(resolvers.resolve_style(&root, &from, "./missing.css", None), None);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// `scan-tracked-build.test.ts`: `@use './build/d'` lands on the partial
    /// `_d.scss`, under a `build/` Git lists.
    #[test]
    fn a_use_lands_on_its_partial_under_a_listed_build() {
        let root = checkout("partial", &[("src/c.scss", "@use './build/d';\n"), ("src/build/_d.scss", "a {}\n")]);
        let resolvers = Resolvers::new(Tsconfig::Auto, None);
        let from = root.join("src/c.scss");
        let known = listed(&["src/c.scss", "src/build/_d.scss"]);
        assert_eq!(resolvers.resolve_style(&root, &from, "./build/d", Some(&known)), Some("src/build/_d.scss".to_owned()));
        assert_eq!(resolvers.resolve_style(&root, &from, "./build/d", None), None);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The `~` of the webpack era is dropped first, and an extension the
    /// stylesheet resolver does not try is the module resolver's to find.
    #[test]
    fn a_tilde_and_a_module_extension_still_land() {
        let root = checkout("tilde", &[("a/b.scss", ""), ("a/theme.scss", ""), ("a/vars.json", "{}")]);
        let resolvers = Resolvers::new(Tsconfig::Auto, None);
        let from = root.join("a/b.scss");
        assert_eq!(resolvers.resolve_style(&root, &from, "~./theme", None), Some("a/theme.scss".to_owned()));
        assert_eq!(resolvers.resolve_style(&root, &from, "./vars", None), Some("a/vars.json".to_owned()));
        let _ = std::fs::remove_dir_all(&root);
    }
}
