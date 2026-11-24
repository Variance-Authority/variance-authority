//! The workspace manifests the standalone Help publisher joins to the index.

// compass: variance-authority.report.agent-surface

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{Map, Value};

use crate::conditions::{normalize, Configs};
use crate::help_names::HelpEntry;
use crate::help_publish::{PublishOpening, PublishPackage};
use crate::help_usage::requested;

#[path = "cli_workspace_members.rs"]
mod workspace;

const OFFERED: [&str; 8] = ["type", "main", "types", "exports", "files", "bin", "engines", "sideEffects"];

pub(super) struct Manifests {
    pub(super) workspaces: bool,
    pub(super) packages: Vec<PublishPackage>,
    pub(super) entries: Vec<HelpEntry>,
    pub(super) targets: [Vec<String>; 3],
    pub(super) digest: String,
    pub(super) unreadable: Vec<String>,
}

#[derive(Serialize)]
struct Shape<'a> {
    name: &'a str,
    declared: Map<String, Value>,
    entry: bool,
    openings: Vec<Opening<'a>>,
}

#[derive(Serialize)]
struct Opening<'a> {
    subpath: &'a str,
    source: &'a str,
}

pub(super) fn read(root: &Path) -> Option<Manifests> {
    let (workspaces, members) = workspace::members(root)?;
    let mut packages = Vec::new();
    let mut declarations = Vec::new();
    let mut entries = Vec::new();
    let [mut published, mut unentered, mut declared] = std::array::from_fn(|_| HashSet::new());
    let mut unreadable = Vec::new();
    let configs = Configs::default();
    for (path, manifest) in members {
        let Some(name) = manifest.get("name").and_then(Value::as_str) else { continue };
        let entry = ["exports", "main", "types", "typings"]
            .into_iter()
            .any(|key| manifest.get(key).is_some_and(|value| !value.is_null()));
        if !entry {
            unentered.insert(name.to_owned());
        }
        if manifest.get("private") == Some(&Value::Bool(true)) {
            continue;
        }
        published.insert(name.to_owned());
        let directory = path.parent()?;
        let custom = configs.custom_conditions(&directory.join("tsconfig.json")).unwrap_or_default();
        let mut openings = Vec::new();
        match subpaths(&manifest) {
            Ok(subpaths) => {
                for (subpath, value) in subpaths {
                    let rest = subpath.strip_prefix('.')?;
                    let spec = format!("{name}{rest}");
                    if value.is_null() {
                        continue;
                    }
                    if !subpath.contains('*') {
                        declared.insert(requested(&spec).1);
                    }
                    let Some(condition) = followed(directory, value, &custom, &configs) else { continue };
                    if rest.contains('*') || condition.as_str().is_some_and(|value| value.contains('*')) {
                        return None;
                    }
                    let source = if let Some(authored) = beside(directory, condition, &configs) {
                        authored
                    } else if let Some(types) = declarations_of(condition) {
                        if types.contains('*') {
                            return None;
                        }
                        match source_of(directory, types, &configs) {
                            Ok(source) => source,
                            Err(why) => {
                                unreadable.push(format!("{name} {subpath} — {why}"));
                                continue;
                            }
                        }
                    } else {
                        continue;
                    };
                    let source = normalize(&source);
                    let spelling = near(root, &source)?;
                    let read_from = super::physical(&source);
                    entries.push(HelpEntry { key: format!("{name} {subpath}"), file: near(root, &read_from)? });
                    openings.push(PublishOpening { subpath: subpath.to_owned(), source: spelling, spec });
                }
            }
            Err(conditions) => {
                let named = conditions.iter().map(|key| format!("`{key}`")).collect::<Vec<_>>().join(", ");
                unreadable.push(format!(
                    "{name} — {} mixes subpaths with the conditions {named} in `exports`, which Node refuses to load",
                    path.display()
                ));
            }
        }
        declarations
            .push(OFFERED.into_iter().filter_map(|key| Some((key.to_owned(), manifest.get(key)?.clone()))).collect());
        packages.push(PublishPackage { name: name.to_owned(), entry, openings });
    }
    let shape: Vec<_> = packages
        .iter()
        .zip(declarations)
        .map(|(package, declared)| Shape {
            name: &package.name,
            declared,
            entry: package.entry,
            openings: package
                .openings
                .iter()
                .map(|opening| Opening { subpath: &opening.subpath, source: &opening.source })
                .collect(),
        })
        .collect();
    let digest = crate::digest::of_string(&serde_json::to_string(&shape).ok()?);
    let targets = [published, unentered, declared].map(|set| set.into_iter().collect());
    Some(Manifests { workspaces, packages, entries, targets, digest, unreadable })
}

fn near(root: &Path, path: &Path) -> Option<String> {
    Some(path.strip_prefix(root).ok()?.to_str()?.replace(std::path::MAIN_SEPARATOR, "/"))
}

fn subpaths(manifest: &Value) -> Result<Vec<(&str, &Value)>, Vec<&str>> {
    let Some(exports) = manifest.get("exports").filter(|value| !value.is_null()) else {
        let entry = ["types", "typings", "main"]
            .into_iter()
            .find_map(|key| manifest.get(key).filter(|value| value.is_string()));
        return Ok(entry.into_iter().map(|value| (".", value)).collect());
    };
    let Some(map) = exports.as_object() else { return Ok(vec![(".", exports)]) };
    let conditions: Vec<_> = map.keys().filter(|key| !key.starts_with('.')).map(String::as_str).collect();
    if conditions.is_empty() {
        Ok(map.iter().map(|(key, value)| (key.as_str(), value)).collect())
    } else if conditions.len() == map.len() {
        Ok(vec![(".", exports)])
    } else {
        Err(conditions)
    }
}

fn followed<'a>(dir: &Path, condition: &'a Value, custom: &[String], configs: &Configs) -> Option<&'a Value> {
    match condition {
        Value::Array(entries) => entries
            .iter()
            .filter_map(|entry| followed(dir, entry, custom, configs))
            .find(|entry| beside(dir, entry, configs).is_some() || declarations_of(entry).is_some()),
        Value::Object(map) => {
            for (key, value) in map {
                if key == "types" {
                    break;
                }
                if custom.contains(key) {
                    return followed(dir, value, custom, configs);
                }
            }
            Some(condition)
        }
        _ => Some(condition),
    }
}

fn declarations_of(condition: &Value) -> Option<&str> {
    if let Some(target) = condition.as_str() {
        return [".ts", ".tsx", ".mts", ".cts"].into_iter().any(|ext| target.ends_with(ext)).then_some(target);
    }
    let map = condition.as_object()?;
    map.get("types").and_then(Value::as_str).or_else(|| map.values().find_map(declarations_of))
}

fn own_setting(configs: &Configs, config: &Path, key: &str) -> Option<String> {
    let (value, directory) = configs.setting(config, key)?;
    (directory == config.parent()?).then(|| value.as_str().map(str::to_owned)).flatten()
}

fn under_output<'a>(target: &'a Path, output: &str) -> Option<&'a Path> {
    let out = normalize(Path::new(output));
    if out.as_os_str().is_empty() {
        return None;
    }
    target.strip_prefix(out).ok().filter(|rest| !rest.as_os_str().is_empty())
}

fn beside(dir: &Path, condition: &Value, configs: &Configs) -> Option<PathBuf> {
    let target = condition.as_str()?;
    let (stem, suffix) = target.rsplit_once('.')?;
    let extensions: &[&str] = match suffix {
        "js" => &["d.ts", "ts", "tsx"],
        "mjs" => &["d.mts", "mts"],
        "cjs" => &["d.cts", "cts"],
        _ => return None,
    };
    if own_setting(configs, &dir.join("tsconfig.json"), "outDir")
        .is_some_and(|out| under_output(&normalize(Path::new(target)), &out).is_some())
    {
        return None;
    }
    extensions.iter().map(|ext| dir.join(format!("{stem}.{ext}"))).find(|path| path.exists())
}

fn source_of(dir: &Path, types: &str, configs: &Configs) -> Result<PathBuf, String> {
    let emitted = dir.join(types);
    if !types.ends_with(".d.ts") && emitted.exists() {
        return Ok(emitted);
    }
    let config = dir.join("tsconfig.json");
    if !config.exists() {
        return Err(format!(
            "`{types}` is not a source file, and `{}` is not there to say what produced it",
            config.display()
        ));
    }
    let over_emitted = |why| if emitted.exists() { Ok(emitted.clone()) } else { Err(why) };
    let (Some(out), Some(source)) = (own_setting(configs, &config, "outDir"), own_setting(configs, &config, "rootDir"))
    else {
        return over_emitted(format!(
            "`{}` declares no `rootDir`/`outDir` pair, so `{types}` cannot be mapped back",
            config.display()
        ));
    };
    let target = normalize(Path::new(types));
    let Some(relative) = under_output(&target, &out) else {
        return over_emitted(format!("`{types}` is not under this package's outDir `{out}`"));
    };
    let relative = relative.to_string_lossy();
    let stem = dir.join(source).join(relative.strip_suffix(".d.ts").unwrap_or(&relative));
    let typed = PathBuf::from(format!("{}.ts", stem.display()));
    for path in [typed.clone(), PathBuf::from(format!("{}.tsx", stem.display()))] {
        if path.exists() {
            return Ok(path);
        }
    }
    over_emitted(format!("`{types}` maps to `{}`, which is not there", typed.display()))
}
