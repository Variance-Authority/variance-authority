//! What a specifier meant to the test runner when the recording was made.
//!
//! The manifest says what an import means to a consumer; the runner's
//! `resolve.alias` can say something else under test, and the recording was
//! made under the runner. Docusaurus sends `@docusaurus/utils` to `src/` in its
//! `vitest.config.ts` and nowhere else, so an import the index leaves on built
//! output ran from source. The table is read by the repository's own Vite
//! (`runner-aliases.ts`); this module only answers from it, the way
//! `@rollup/plugin-alias` does: the first alias that matches wins, and a
//! replacement that is still a bare name is the package of that name's.

// compass: variance-authority.reach.relations

use std::collections::{HashMap, HashSet};
use std::path::Path;

use regex::Regex;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TableIn {
    configs: Vec<ConfigIn>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigIn {
    /// The config's directory, `''` at the root.
    directory: String,
    aliases: Vec<AliasIn>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AliasIn {
    /// A string alias, matched whole or as a leading path segment.
    find: Option<String>,
    /// A regular expression alias: its source and flags.
    source: Option<String>,
    flags: Option<String>,
    replacement: String,
}

enum Find {
    Text(String),
    Pattern(Regex),
}

struct Alias {
    find: Find,
    /// The replacement, in the regex crate's syntax for a pattern.
    replacement: String,
}

pub(crate) struct Runner {
    /// Config directory → its aliases, in declared order.
    configs: HashMap<String, Vec<Alias>>,
    /// Package name → directory, for a replacement that is a bare name.
    packages: HashMap<String, String>,
    tracked: HashSet<String>,
    /// Aliases the regex crate could not compile, with why: the runner's
    /// answer for them is missing, not guessed.
    pub unread: Vec<String>,
}

const EXTENSIONS: &[&str] = &["", ".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs", ".cjs", "/index.ts", "/index.tsx", "/index.js", "/index.mjs"];

/// JavaScript's `$1`, `$&` and `$$` in the regex crate's spelling, so `$1foo`
/// stays group 1 followed by text.
fn replacement(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '$' {
            out.push(c);
            continue;
        }
        match chars.peek().copied() {
            Some('$') => {
                chars.next();
                out.push_str("$$");
            }
            Some('&') => {
                chars.next();
                out.push_str("${0}");
            }
            Some(d) if d.is_ascii_digit() => {
                let mut group = String::new();
                while let Some(d) = chars.peek().copied().filter(char::is_ascii_digit).filter(|_| group.len() < 2) {
                    group.push(d);
                    chars.next();
                }
                out.push_str(&format!("${{{group}}}"));
            }
            _ => out.push_str("$$"),
        }
    }
    out
}

fn normal(path: &Path) -> Option<String> {
    let mut parts: Vec<&str> = Vec::new();
    for part in path.to_str()?.split('/') {
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

impl Runner {
    /// The table `runner-aliases.ts` read. `packages` is every named package's
    /// name and directory; `tracked` is git's listing.
    pub(crate) fn read(json: &str, packages: HashMap<String, String>, tracked: HashSet<String>) -> Result<Runner, String> {
        let table: TableIn = serde_json::from_str(json).map_err(|error| format!("the runner's alias table did not read: {error}"))?;
        let mut unread = Vec::new();
        let mut configs: HashMap<String, Vec<Alias>> = HashMap::new();
        for config in table.configs {
            let aliases = configs.entry(config.directory.clone()).or_default();
            for alias in config.aliases {
                let find = match (alias.find, alias.source) {
                    (Some(text), _) => Find::Text(text),
                    (None, Some(source)) => {
                        let flags = alias.flags.unwrap_or_default();
                        let inline = if flags.contains('i') { "(?i)" } else { "" };
                        match Regex::new(&format!("{inline}{source}")) {
                            Ok(pattern) => Find::Pattern(pattern),
                            Err(error) => {
                                let error = error.to_string();
                                let error = error.lines().last().unwrap_or_default().trim();
                                unread.push(format!("the alias /{source}/{flags} in {} does not compile as a Rust pattern, and is not read ({error})", if config.directory.is_empty() { "." } else { &config.directory }));
                                continue;
                            }
                        }
                    }
                    (None, None) => continue,
                };
                let replacement = match find {
                    Find::Pattern(_) => replacement(&alias.replacement),
                    Find::Text(_) => alias.replacement,
                };
                aliases.push(Alias { find, replacement });
            }
        }
        Ok(Runner { configs, packages, tracked, unread })
    }

    /// The aliases of the config governing `file`: the nearest one above it
    /// that declares any, else none.
    fn governing(&self, file: &str) -> &[Alias] {
        let mut directory = crate::package_owners::parent(file);
        loop {
            if let Some(aliases) = self.configs.get(directory).filter(|aliases| !aliases.is_empty()) {
                return aliases;
            }
            if directory.is_empty() {
                return &[];
            }
            directory = crate::package_owners::parent(directory);
        }
    }

    /// What `spec` written in `file` meant under the runner: `None` when no
    /// alias matches, `Some(None)` when one does and names no file of the
    /// checkout.
    pub(crate) fn resolve(&self, root: &Path, file: &str, spec: &str) -> Option<Option<String>> {
        for alias in self.governing(file) {
            let out = match &alias.find {
                Find::Text(text) if spec == text || spec.strip_prefix(text.as_str()).is_some_and(|rest| rest.starts_with('/')) => {
                    format!("{}{}", alias.replacement, &spec[text.len()..])
                }
                Find::Pattern(pattern) if pattern.is_match(spec) => pattern.replace(spec, alias.replacement.as_str()).into_owned(),
                _ => continue,
            };
            return Some(self.land(root, file, &out));
        }
        None
    }

    fn land(&self, root: &Path, file: &str, out: &str) -> Option<String> {
        let base = if Path::new(out).is_absolute() {
            let relative = Path::new(out).strip_prefix(root).ok()?;
            normal(relative)?
        } else if out.starts_with('.') {
            normal(&Path::new(crate::package_owners::parent(file)).join(out))?
        } else {
            let mut split = out.splitn(if out.starts_with('@') { 3 } else { 2 }, '/');
            let name = if out.starts_with('@') {
                format!("{}/{}", split.next()?, split.next().unwrap_or(""))
            } else {
                split.next()?.to_owned()
            };
            let directory = self.packages.get(&name)?;
            let rest = split.next().unwrap_or("");
            normal(&Path::new(directory).join(rest))?
        };
        let candidates = EXTENSIONS.iter().map(|extension| format!("{base}{extension}"));
        if let Some(found) = candidates.clone().find(|candidate| self.tracked.contains(candidate)) {
            return Some(found);
        }
        candidates.into_iter().find(|candidate| root.join(candidate).is_file())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_runner_alias_sends_a_package_name_to_the_source_it_ran_from() {
        let table = r#"{"configs":[{"directory":"","aliases":[
            {"source":"^@docusaurus\\/(Link|use.*)$","flags":"","replacement":"/repo/packages/core/src/exports/$1"},
            {"source":"^@theme\\/(.*)$","flags":"","replacement":"@docusaurus/theme-classic/src/theme/$1"},
            {"find":"@docusaurus/utils","replacement":"/repo/packages/utils/src/index.ts"}
        ]}]}"#;
        let packages = HashMap::from([("@docusaurus/theme-classic".to_owned(), "packages/theme-classic".to_owned())]);
        let tracked: HashSet<String> =
            ["packages/core/src/exports/useIsBrowser.ts", "packages/theme-classic/src/theme/Tabs/index.tsx", "packages/utils/src/index.ts"]
                .into_iter()
                .map(str::to_owned)
                .collect();
        let runner = Runner::read(table, packages, tracked).unwrap();
        let root = Path::new("/repo");
        let at = |spec: &str| runner.resolve(root, "packages/theme-classic/src/a.tsx", spec);
        assert_eq!(at("@docusaurus/useIsBrowser"), Some(Some("packages/core/src/exports/useIsBrowser.ts".to_owned())));
        assert_eq!(at("@theme/Tabs"), Some(Some("packages/theme-classic/src/theme/Tabs/index.tsx".to_owned())));
        assert_eq!(at("@docusaurus/utils"), Some(Some("packages/utils/src/index.ts".to_owned())));
        assert_eq!(at("@docusaurus/Link"), Some(None));
        assert_eq!(at("@docusaurus/logger"), None);
        assert_eq!(replacement("a$1b$$c$&"), "a${1}b$$c${0}");
    }
}
