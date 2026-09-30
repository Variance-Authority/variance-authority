//! `aliasesIn` in `packages/sense/src/witness.ts`: the `paths` and `baseUrl`
//! every `tsconfig` and `jsconfig` the tree tracks declares, placed as
//! repository paths, or nothing when one of them cannot be read.
//!
//! The module comment of `witness.ts` states the rule; this is its one
//! implementation. A large workspace holds thousands of configurations, and
//! reading them one at a time was a sixth of a warm update, so they are read
//! here in parallel and folded in the order the tree lists them.

// compass: variance-authority.reach.source-index

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::LazyLock;

use napi_derive::napi;
use oxc_resolver::{ResolveOptions, Resolver};
use rayon::prelude::*;
use regex::Regex;
use serde_json::{Map, Value};

use crate::witness::{dirname, join, normalize};

/// One `paths` pattern, placed: `Mapping` in `witness.ts`.
#[napi(object)]
pub struct AliasMapping {
    pub prefix: String,
    /// Absent when the pattern is exact.
    pub suffix: Option<String>,
    pub targets: Vec<String>,
}

/// `AliasTable` in `witness.ts`.
#[napi(object)]
pub struct AliasesRead {
    pub bases: Vec<String>,
    pub mappings: Vec<AliasMapping>,
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
    let mut extended = Extended { root, parsed: &parsed, resolver: None, real: None, answers: HashMap::new() };

    let mut mappings = Vec::new();
    let mut bases: Vec<String> = Vec::new();
    let mut already = HashSet::new();
    // The `paths` one file declares, placed against one directory, is one
    // table however many configurations inherit it.
    let mut placed_from = HashSet::new();
    for &path in &configs {
        let options = compiler_options(path, &mut extended, &HashSet::new())?;
        let declared = options.values.get("paths").copied();
        let base_url = options.values.get("baseUrl").and_then(|value| value.as_str());
        // Each option is placed against the file that wrote it rather than
        // the file that inherited it, which is what TypeScript does.
        let base = match base_url {
            Some(base_url) => within(&join(&[dirname(options.from.get("baseUrl").copied().unwrap_or(path)), base_url])),
            None => within(dirname(options.from.get("paths").copied().unwrap_or(path))),
        };
        let Some(base) = base else { continue };
        if base_url.is_some() && !bases.contains(&base) {
            bases.push(base.clone());
        }
        if !matches!(declared, Some(Value::Object(_) | Value::Array(_))) {
            continue;
        }
        if !placed_from.insert(format!("{}\u{0}{base}", options.from.get("paths").copied().unwrap_or(path))) {
            continue;
        }
        let entries: Vec<(String, &Value)> = match declared {
            Some(Value::Object(map)) => map.iter().map(|(key, value)| (key.clone(), value)).collect(),
            Some(Value::Array(items)) => items.iter().enumerate().map(|(at, value)| (at.to_string(), value)).collect(),
            _ => continue,
        };
        for (pattern, targets) in entries {
            let Value::Array(targets) = targets else { return None };
            let placed: Vec<String> =
                targets.iter().filter_map(Value::as_str).filter_map(|target| within(&join(&[&base, target]))).collect();
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
    Some(AliasesRead { bases, mappings })
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

/// One configuration's options, and which file in its chain wrote each.
struct Options<'a> {
    values: HashMap<&'a str, &'a Value>,
    from: HashMap<&'a str, &'a str>,
}

/// One configuration's options with everything it extends folded in; an
/// `extends` entry not answered as a tracked configuration abandons the chain.
fn compiler_options<'a>(path: &'a str, extended: &mut Extended<'a>, seen: &HashSet<&'a str>) -> Option<Options<'a>> {
    if seen.contains(path) {
        return Some(Options { values: HashMap::new(), from: HashMap::new() });
    }
    let config = extended.parsed.get(path)?;
    let named: Vec<&Value> = match config.get("extends") {
        None => Vec::new(),
        Some(Value::Array(items)) => items.iter().collect(),
        Some(one) => vec![one],
    };
    let mut values = HashMap::new();
    let mut from = HashMap::new();
    for one in named {
        let resolved = one.as_str().and_then(|specifier| extended.answer(path, specifier))?;
        let mut deeper = seen.clone();
        deeper.insert(path);
        let base = compiler_options(resolved, extended, &deeper)?;
        values.extend(base.values);
        from.extend(base.from);
    }
    // `paths` and `baseUrl` are read together, so an inherited `paths` under
    // an overridden `baseUrl` is the overriding file's answer.
    if let Some(Value::Object(own)) = config.get("compilerOptions") {
        for (key, value) in own {
            from.insert(key.as_str(), path);
            values.insert(key.as_str(), value);
        }
    }
    Some(Options { values, from })
}

/// Every `extends` entry answered as a configuration this read holds:
/// `extendedIn` in `witness.ts`.
struct Extended<'a> {
    root: &'a str,
    parsed: &'a HashMap<&'a str, Map<String, Value>>,
    resolver: Option<Resolver>,
    real: Option<Option<std::path::PathBuf>>,
    answers: HashMap<(String, String), Option<&'a str>>,
}

impl<'a> Extended<'a> {
    fn answer(&mut self, config: &str, specifier: &str) -> Option<&'a str> {
        let from = dirname(config);
        if specifier.starts_with("./") || specifier.starts_with("../") {
            let at = normalize(&join(&[from, specifier]));
            let held = |key: &str| self.parsed.get_key_value(key).map(|(key, _)| *key);
            return held(&at).or_else(|| held(&format!("{at}.json")));
        }
        if specifier.is_empty() || specifier.starts_with('.') || specifier.starts_with('/') {
            return None;
        }
        let key = (from.to_owned(), specifier.to_owned());
        if let Some(answer) = self.answers.get(&key) {
            return *answer;
        }
        let anchor = self.real.get_or_insert_with(|| std::fs::canonicalize(self.root).ok()).clone();
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
        let answer = anchor.and_then(|anchor| {
            let found = resolver.resolve(Path::new(&join(&[self.root, from])), specifier).ok()?;
            let tracked = found.path().strip_prefix(&anchor).ok()?.to_str()?.replace(std::path::MAIN_SEPARATOR, "/");
            self.parsed.get_key_value(tracked.as_str()).map(|(key, _)| *key)
        });
        self.answers.insert(key, answer);
        answer
    }
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
