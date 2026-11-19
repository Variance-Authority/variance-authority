//! `aliasesIn` in `packages/sense/src/witness.ts`: the `paths` and `baseUrl`
//! every `tsconfig` and `jsconfig` the tree tracks declares, placed as
//! repository paths, with every base their `extends` chains read past the
//! listing and its digest, and every one they reach no file at; or nothing
//! when one of them cannot be read.
//!
//! The module comment of `witness.ts` states the rule; this is its one
//! implementation. A large workspace holds thousands of configurations, and
//! reading them one at a time was a sixth of a warm update, so they are read
//! here in parallel and folded in the order the tree lists them.

// compass: variance-authority.reach.source-index

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use napi_derive::napi;
use oxc_resolver::{ResolveError, ResolveOptions, Resolver};
use rayon::prelude::*;
use regex::Regex;
use serde_json::{Map, Value};
use sha2::{Digest as _, Sha256};

use crate::conditions::{config_file, normalize as normalize_path};
use crate::digest;
use crate::order::code_unit;
use crate::witness::{dirname, join, normalize};

/// One `paths` pattern, placed: `Mapping` in `witness.ts`.
#[napi(object)]
pub struct AliasMapping {
    pub prefix: String,
    /// Absent when the pattern is exact.
    pub suffix: Option<String>,
    pub targets: Vec<String>,
}

/// A configuration an `extends` reached that the listing passed in does not
/// hold, named from the root, and the digest of the bytes read.
#[napi(object)]
pub struct ConfigRead {
    pub path: String,
    pub digest: String,
}

/// `AliasTable` in `witness.ts`, and every configuration read past the listing.
#[napi(object)]
pub struct AliasesRead {
    pub bases: Vec<String>,
    pub mappings: Vec<AliasMapping>,
    /// In code-unit order of their paths.
    pub read: Vec<ConfigRead>,
    /// Every `extends` entry that reached no file, as the configuration that
    /// names it and the name as written, joined by a space, in code-unit order.
    pub missing: Vec<String>,
}

/// The alias table the configurations among `paths` declare, read from
/// `root`; `None` when one of them cannot be read.
#[napi(catch_unwind)]
pub fn aliases_in(root: String, paths: Vec<String>) -> Option<AliasesRead> {
    read(&root, &paths)
}

pub(crate) fn read(root: &str, paths: &[String]) -> Option<AliasesRead> {
    let configs: Vec<&str> = paths.iter().map(String::as_str).filter(|path| is_config(path)).collect();
    let read: Vec<Option<Map<String, Value>>> = configs
        .par_iter()
        .map(|path| std::fs::read(join(&[root, path])).ok().and_then(|bytes| parse_config(&String::from_utf8_lossy(&bytes))))
        .collect();
    let mut parsed: HashMap<&str, Map<String, Value>> = HashMap::with_capacity(configs.len());
    for (path, value) in configs.iter().zip(read) {
        parsed.insert(path, value?);
    }
    let mut extended =
        Extended { root, parsed: &parsed, beyond: HashMap::new(), resolver: None, real: None, answers: HashMap::new(), missing: Vec::new() };

    let mut mappings = Vec::new();
    let mut bases: Vec<String> = Vec::new();
    let mut already = HashSet::new();
    // The `paths` one file declares, placed against one directory, is one
    // table however many configurations inherit it.
    let mut placed_from = HashSet::new();
    for &path in &configs {
        let options = compiler_options(path, &mut extended, &HashSet::new())?;
        let declared = options.values.get("paths");
        let base_url = options.values.get("baseUrl").and_then(|value| value.as_str());
        let paths_from = options.from.get("paths").map_or(path, String::as_str);
        // Each option is placed against the file that wrote it rather than
        // the file that inherited it, which is what TypeScript does; only
        // `${configDir}` names the inheriting file's directory.
        let at = normalize(&match base_url {
            Some(base_url) => configured(path, options.from.get("baseUrl").map_or(path, String::as_str), base_url),
            None => dirname(paths_from).to_owned(),
        });
        if base_url.is_some() {
            if let Some(base) = extended.place(&at, ".").filter(|base| !bases.contains(base)) {
                bases.push(base);
            }
        }
        if !matches!(declared, Some(Value::Object(_) | Value::Array(_))) {
            continue;
        }
        // A `${configDir}` target lands per inheriting file, so it is not shared.
        let per_file = if declared.is_some_and(|value| value.to_string().contains(CONFIG_DIR)) { path } else { "" };
        if !placed_from.insert(format!("{paths_from}\u{0}{at}\u{0}{per_file}")) {
            continue;
        }
        let entries: Vec<(String, &Value)> = match declared {
            Some(Value::Object(map)) => map.iter().map(|(key, value)| (key.clone(), value)).collect(),
            Some(Value::Array(items)) => items.iter().enumerate().map(|(at, value)| (at.to_string(), value)).collect(),
            _ => continue,
        };
        for (pattern, targets) in entries {
            let Value::Array(targets) = targets else { return None };
            let placed =
                targets.iter().filter_map(Value::as_str).filter_map(|target| match target.strip_prefix(CONFIG_DIR) {
                    Some(rest) => extended.place(dirname(path), rest.trim_start_matches('/')),
                    None => extended.place(&at, target),
                });
            let placed: Vec<String> = placed.collect();
            // Two files declaring one pattern with the same targets are one mapping.
            if !already.insert(format!("{pattern}\u{0}{}", placed.join("\u{0}"))) {
                continue;
            }
            mappings.push(match pattern.find('*') {
                None => AliasMapping { prefix: pattern, suffix: None, targets: placed },
                Some(star) => {
                    AliasMapping { prefix: pattern[..star].to_owned(), suffix: Some(pattern[star + 1..].to_owned()), targets: placed }
                }
            });
        }
    }
    let mut read: Vec<ConfigRead> = extended
        .beyond
        .into_iter()
        .filter_map(|(path, held)| held.map(|(_, digest)| ConfigRead { path, digest }))
        .collect();
    read.sort_unstable_by(|a, b| code_unit(&a.path, &b.path));
    let mut missing = extended.missing;
    missing.sort_unstable_by(|a, b| code_unit(a, b));
    missing.dedup();
    Some(AliasesRead { bases, mappings, read, missing })
}

/// The placeholder TypeScript reads as the inheriting configuration's directory.
const CONFIG_DIR: &str = "${configDir}";

/// `value`, an option `from` wrote, as a path from the root: against `from`'s
/// directory, or against `config`'s where it opens with `${configDir}`.
fn configured(config: &str, from: &str, value: &str) -> String {
    match value.strip_prefix(CONFIG_DIR) {
        Some(rest) => join(&[dirname(config), rest.trim_start_matches('/')]),
        None => join(&[dirname(from), value]),
    }
}

/// Configuration files whose `paths` decide where a bare specifier can land.
fn is_config(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    name == "jsconfig.json" || (name.starts_with("tsconfig") && name.ends_with(".json"))
}

/// A repository-relative path, or nothing when it names something outside.
fn within(path: &str) -> Option<String> {
    let normalized = normalize(path);
    if normalized == "." || normalized.is_empty() {
        return Some(String::new());
    }
    (!(normalized.starts_with("../") || normalized == "..")).then_some(normalized)
}

/// The two options that place an alias, and which file in a chain wrote each.
const PLACING: [&str; 2] = ["paths", "baseUrl"];

/// One configuration's placing options, and which file in its chain wrote each.
#[derive(Default)]
struct Options {
    values: HashMap<&'static str, Value>,
    from: HashMap<&'static str, String>,
}

/// One configuration's options with everything it extends folded in. An
/// `extends` entry that reaches no file declares nothing, and is named in
/// `missing`; one that reaches a file that cannot be read abandons the chain.
fn compiler_options(path: &str, extended: &mut Extended<'_>, seen: &HashSet<String>) -> Option<Options> {
    if seen.contains(path) {
        return Some(Options::default());
    }
    let (named, own) = {
        let config = extended.config(path)?;
        let named: Vec<String> = match config.get("extends") {
            None => Vec::new(),
            Some(Value::Array(items)) => items.iter().map(|item| item.as_str().map(str::to_owned)).collect::<Option<_>>()?,
            Some(one) => vec![one.as_str()?.to_owned()],
        };
        let own: Vec<(&'static str, Value)> = match config.get("compilerOptions") {
            Some(Value::Object(own)) => {
                PLACING.iter().filter_map(|&key| own.get(key).map(|value| (key, value.clone()))).collect()
            }
            _ => Vec::new(),
        };
        (named, own)
    };
    let mut options = Options::default();
    for specifier in named {
        let Some(resolved) = extended.answer(path, &specifier)? else {
            extended.missing.push(format!("{path} {specifier}"));
            continue;
        };
        let mut deeper = seen.clone();
        deeper.insert(path.to_owned());
        let base = compiler_options(&resolved, extended, &deeper)?;
        options.values.extend(base.values);
        options.from.extend(base.from);
    }
    // `paths` and `baseUrl` are read together, so an inherited `paths` under
    // an overridden `baseUrl` is the overriding file's answer.
    for (key, value) in own {
        options.from.insert(key, path.to_owned());
        options.values.insert(key, value);
    }
    Some(options)
}

/// A configuration read from disk past the listing, and the digest of its bytes.
type Beyond = Option<(Map<String, Value>, String)>;

/// Every `extends` entry answered as a configuration this read can open:
/// `aliasesIn` in `witness.ts`.
struct Extended<'a> {
    root: &'a str,
    parsed: &'a HashMap<&'a str, Map<String, Value>>,
    /// What an `extends` reached that `parsed` does not hold, by its path from
    /// the root; `None` for a file that is there and is not a configuration.
    beyond: HashMap<String, Beyond>,
    resolver: Option<Resolver>,
    real: Option<Option<PathBuf>>,
    answers: HashMap<(String, String), Option<Option<String>>>,
    missing: Vec<String>,
}

impl Extended<'_> {
    /// The configuration at `path`, read and digested on first ask when the
    /// listing did not hold it.
    fn config(&mut self, path: &str) -> Option<&Map<String, Value>> {
        if let Some(held) = self.parsed.get(path) {
            return Some(held);
        }
        let root = self.root;
        self.beyond
            .entry(path.to_owned())
            .or_insert_with(|| {
                let bytes = std::fs::read(Path::new(root).join(path)).ok()?;
                let parsed = parse_config(&String::from_utf8_lossy(&bytes))?;
                Some((parsed, digest::of_sha256(Sha256::digest(&bytes).as_slice())))
            })
            .as_ref()
            .map(|(parsed, _)| parsed)
    }

    /// The root as the resolver names it, which `relative` measures from.
    fn anchor(&mut self) -> Option<PathBuf> {
        self.real.get_or_insert_with(|| std::fs::canonicalize(self.root).ok()).clone()
    }

    /// Where `target` lands placed against the directory `at`, from the root,
    /// or nothing outside it. A directory outside places a target as
    /// TypeScript does, so one that climbs back into the checkout lands there.
    fn place(&mut self, at: &str, target: &str) -> Option<String> {
        let joined = join(&[at, target]);
        if within(at).is_some() {
            return within(&joined);
        }
        let anchor = self.anchor()?;
        within(normalize_path(&anchor.join(&joined)).strip_prefix(&anchor).ok()?.to_str()?)
    }

    /// The file an `extends` entry reaches: `Some(None)` when it reaches no
    /// file, and `None` when this read cannot tell.
    fn answer(&mut self, config: &str, specifier: &str) -> Option<Option<String>> {
        let from = dirname(config);
        if specifier.starts_with("./") || specifier.starts_with("../") {
            // `oxc_resolver`'s order, which `conditions.rs` reads a chain by too.
            let at = normalize(&join(&[from, specifier]));
            return Some(match config_file(&Path::new(self.root).join(&at)) {
                None => None,
                Some(file) => Some(normalize(file.strip_prefix(self.root).ok()?.to_str()?)),
            });
        }
        if specifier.is_empty() || specifier.starts_with('.') || specifier.starts_with('/') {
            return None;
        }
        let key = (from.to_owned(), specifier.to_owned());
        if let Some(answer) = self.answers.get(&key) {
            return answer.clone();
        }
        let anchor = self.anchor();
        // The rule `oxc_resolver` follows an `extends` by, which is not the
        // one it resolves a module by.
        let resolver = self.resolver.get_or_insert_with(|| {
            Resolver::new(ResolveOptions {
                condition_names: vec!["node".to_owned(), "import".to_owned()],
                extensions: vec![".json".to_owned()],
                main_files: vec!["tsconfig".to_owned()],
                ..ResolveOptions::default()
            })
        });
        let answer = anchor.and_then(|anchor| match resolver.resolve(Path::new(&join(&[self.root, from])), specifier) {
            Ok(found) => relative(&anchor, found.path()).map(Some),
            Err(ResolveError::NotFound(_)) => Some(None),
            Err(_) => None,
        });
        self.answers.insert(key, answer.clone());
        answer
    }
}

/// `to` from the directory `from`, in `/` segments, climbing with `..` where
/// it lies outside: a name `within` refuses, so only `place` lands from there.
fn relative(from: &Path, to: &Path) -> Option<String> {
    let from: Vec<_> = from.components().collect();
    let to: Vec<_> = to.components().collect();
    let common = from.iter().zip(&to).take_while(|(a, b)| a == b).count();
    let mut segments: Vec<&str> = vec![".."; from.len() - common];
    for segment in &to[common..] {
        segments.push(segment.as_os_str().to_str()?);
    }
    Some(segments.join("/"))
}

/// A configuration file's text as an object, with the comments and trailing
/// commas the TypeScript family permits: `parseConfig` in `witness.ts`. An
/// array reads as an object that declares nothing.
pub(crate) fn parse_config(text: &str) -> Option<Map<String, Value>> {
    static TRAILING: LazyLock<Regex> = LazyLock::new(|| Regex::new(r",(\s*[}\]])").expect("a valid pattern"));
    let stripped = strip_comments(text.strip_prefix('\u{feff}').unwrap_or(text));
    match serde_json::from_str::<Value>(&TRAILING.replace_all(&stripped, "$1")).ok()? {
        Value::Object(map) => Some(map),
        Value::Array(_) => Some(Map::new()),
        _ => None,
    }
}

fn strip_comments(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.char_indices().peekable();
    let mut in_string = false;
    while let Some((at, char)) = chars.next() {
        if in_string {
            out.push(char);
            if char == '\\' {
                if let Some((_, next)) = chars.next() {
                    out.push(next);
                }
            } else if char == '"' {
                in_string = false;
            }
            continue;
        }
        let next = chars.peek().map(|&(_, next)| next);
        match (char, next) {
            ('"', _) => {
                in_string = true;
                out.push(char);
            }
            ('/', Some('/')) => {
                let end = text[at..].find('\n').map_or(text.len(), |end| at + end);
                while chars.peek().is_some_and(|&(next, _)| next < end) {
                    chars.next();
                }
            }
            ('/', Some('*')) => {
                let end = text[at + 2..].find("*/").map_or(text.len(), |end| at + 2 + end + 2);
                while chars.peek().is_some_and(|&(next, _)| next < end) {
                    chars.next();
                }
            }
            _ => out.push(char),
        }
    }
    out
}
