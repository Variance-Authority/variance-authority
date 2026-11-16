//! Rust paths resolved against the module declarations the native scan holds.
//! `mod` declares a parent; Cargo's layout answers only where no read did.

// compass: variance-authority.reach.source-index

use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::languages::shape::Read;

const ROOT_FILES: [&str; 3] = ["lib.rs", "main.rs", "mod.rs"];

#[derive(Clone)]
struct Place {
    file: String,
    inline: Vec<String>,
}

#[derive(Default)]
struct Items {
    declared: HashSet<String>,
    inline: HashSet<String>,
}

/// One scan's Rust module tree. Its reads stay native; resolution keeps no source bytes.
pub(crate) struct RustWorld {
    paths: HashSet<String>,
    parent: HashMap<String, Place>,
    children: HashMap<String, HashMap<String, String>>,
    spelled: HashSet<String>,
    items: HashMap<String, Items>,
    crates: HashMap<String, String>,
}

impl RustWorld {
    #[cfg(test)]
    pub(crate) fn new(paths: &[String], reads: &HashMap<String, Read>, root: &Path) -> Self {
        Self::from_rows(paths, reads.iter().map(|(file, read)| (file.as_str(), read)), root)
    }

    pub(crate) fn from_rows<'r>(paths: &[String], reads: impl IntoIterator<Item = (&'r str, &'r Read)>, root: &Path) -> Self {
        let reads: HashMap<&str, &Read> = reads.into_iter().collect();
        let mut sorted: Vec<&String> = paths.iter().filter(|file| file.ends_with(".rs") || file.as_str() == "Cargo.toml" || file.ends_with("/Cargo.toml")).collect();
        sorted.sort_by(|left, right| crate::order::code_unit(left, right));
        sorted.dedup();
        let mut world = Self {
            paths: paths.iter().cloned().collect(),
            parent: HashMap::new(), children: HashMap::new(), spelled: HashSet::new(),
            items: HashMap::new(), crates: HashMap::new(),
        };
        let mut declared = Vec::new();
        for file in sorted.iter().copied() {
            if !file.ends_with(".rs") { continue }
            let Some(read) = reads.get(file.as_str()) else { continue };
            world.children.insert(file.clone(), HashMap::new());
            let mut files = HashSet::new();
            for request in &read.requests {
                let Some(binding) = request.bindings.first() else { continue };
                if request.guessed || binding.imported != "*" { continue }
                declared.push((file.clone(), request.value.clone(), binding.local.clone()));
                if request.value == format!("self::{}", binding.local) || (spelled_path(&request.value) && !inline_spelled(&request.value)) {
                    files.insert(binding.local.as_str());
                }
            }
            if read.harvested {
                let mut items = Items::default();
                for symbol in read.symbols.iter().filter(|symbol| !symbol.name.contains("::")) {
                    if symbol.kind != "module" { items.declared.insert(symbol.name.clone()); }
                    else if !files.contains(symbol.name.as_str()) { items.inline.insert(symbol.name.clone()); }
                }
                world.items.insert(file.clone(), items);
            }
        }
        // A spelled module determines its children's directory, including the
        // directory an inline module's own spelled path starts from.
        for inline in [false, true] {
            for (file, value, name) in declared.iter().filter(|(_, value, _)| spelled_path(value) && inline_spelled(value) == inline) {
                let Some(child) = world.spelled_file(file, value) else { continue };
                if !world.paths.contains(&child) { continue }
                world.spelled.insert(child.clone());
                let inline = inline_of(value);
                let key = inline.iter().map(String::as_str).chain(std::iter::once(name.as_str())).collect::<Vec<_>>().join("::");
                world.place(file, key, child, inline);
            }
        }
        for (file, value, _) in declared.iter().filter(|(_, value, _)| !spelled_path(value)) {
            let path: Vec<String> = value.split("::").skip(1).map(str::to_owned).collect();
            let Some(name) = path.last() else { continue };
            let inline = &path[..path.len() - 1];
            if let Some(child) = world.declared_file(file, inline, name) {
                world.place(file, path.join("::"), child, inline.to_vec());
            }
        }
        for file in sorted.iter().copied() {
            if file != "Cargo.toml" && !file.ends_with("/Cargo.toml") { continue }
            let directory = directory_of(file);
            let text = std::fs::read_to_string(root.join(file)).ok();
            let name = text.as_deref().and_then(manifest_name).unwrap_or_else(|| directory.rsplit('/').next().unwrap_or(directory)).replace('-', "_");
            if !name.is_empty() { world.crates.insert(name, directory.to_owned()); }
        }
        world
    }

    /// The one file a Rust request reaches; a request for its own file has no edge.
    pub(crate) fn resolve(&self, from: &str, request: &str, item: bool) -> Vec<String> {
        self.landing(from, request, item).filter(|file| file != from).into_iter().collect()
    }

    fn landing(&self, from: &str, request: &str, item: bool) -> Option<String> {
        if spelled_path(request) {
            return self.spelled_file(from, request).filter(|file| self.paths.contains(file));
        }
        let written: Vec<&str> = request.split("::").filter(|part| !part.is_empty()).collect();
        let first = *written.first()?;
        let (mut at, rest) = match first {
            "crate" => (Place { file: self.root_of(from), inline: Vec::new() }, &written[1..]),
            "self" => (Place { file: from.to_owned(), inline: Vec::new() }, &written[1..]),
            "super" => {
                let mut at = Place { file: from.to_owned(), inline: Vec::new() };
                let mut climbed = 0;
                while written.get(climbed) == Some(&"super") {
                    if at.inline.pop().is_none() { at = self.parent_of(&at.file)?; }
                    climbed += 1;
                }
                (at, &written[climbed..])
            }
            name => {
                let directory = self.crates.get(name)?;
                let source = if directory.is_empty() { "src".to_owned() } else { format!("{directory}/src") };
                let file = ["lib.rs", "main.rs"].iter().map(|name| format!("{source}/{name}")).find(|file| self.paths.contains(file))?;
                (Place { file, inline: Vec::new() }, &written[1..])
            }
        };
        let mut walked = 0;
        for segment in rest {
            if let Some(child) = self.child_of(&at, segment) { at = Place { file: child, inline: Vec::new() }; }
            else if self.holds_inline(&at, segment) { at.inline.push((*segment).to_owned()); }
            else { break }
            walked += 1;
        }
        if item && (rest.len() - walked != 1 || !self.declares_item(&at, rest[walked])) { return None }
        Some(at.file)
    }

    fn place(&mut self, file: &str, key: String, child: String, inline: Vec<String>) {
        if child == file { return }
        self.parent.insert(child.clone(), Place { file: file.to_owned(), inline });
        if let Some(children) = self.children.get_mut(file) { children.insert(key, child); }
    }

    fn spelled_file(&self, file: &str, request: &str) -> Option<String> {
        if !inline_spelled(request) { return normalize(&format!("{}/{request}", directory_of(file))) }
        let directory = self.child_directories(file).into_iter().next()?;
        let inline = inline_of(request).join("/");
        normalize(&format!("{directory}/{inline}/{}", &request[request.find('/')? + 1..]))
    }

    fn declared_file(&self, file: &str, inline: &[String], name: &str) -> Option<String> {
        for directory in self.child_directories(file) {
            let at = std::iter::once(directory).chain(inline.iter().cloned()).collect::<Vec<_>>().join("/");
            for candidate in [format!("{at}/{name}.rs"), format!("{at}/{name}/mod.rs")] {
                if let Some(path) = normalize(&candidate).filter(|path| self.paths.contains(path)) { return Some(path) }
            }
        }
        None
    }

    fn child_directories(&self, file: &str) -> Vec<String> {
        let beside = directory_of(file).to_owned();
        if ROOT_FILES.contains(&file.rsplit('/').next().unwrap_or(file)) || self.spelled.contains(file) { return vec![beside] }
        vec![module_directory(file), beside]
    }

    fn child_of(&self, at: &Place, segment: &str) -> Option<String> {
        if let Some(declared) = self.children.get(&at.file) {
            let key = at.inline.iter().map(String::as_str).chain(std::iter::once(segment)).collect::<Vec<_>>().join("::");
            return declared.get(&key).cloned();
        }
        self.declared_file(&at.file, &at.inline, segment).filter(|child| child != &at.file)
    }

    fn holds_inline(&self, at: &Place, segment: &str) -> bool {
        if at.inline.is_empty() && self.items.get(&at.file).is_some_and(|items| items.inline.contains(segment)) { return true }
        let key = at.inline.iter().map(String::as_str).chain([segment, ""]).collect::<Vec<_>>().join("::");
        if let Some(declared) = self.children.get(&at.file) { return declared.keys().any(|name| name.starts_with(&key)) }
        self.child_directories(&at.file).into_iter().any(|directory| {
            let prefix = std::iter::once(directory.as_str()).chain(at.inline.iter().map(String::as_str)).chain([segment, ""]).collect::<Vec<_>>().join("/");
            self.paths.iter().any(|path| path.starts_with(&prefix))
        })
    }

    fn declares_item(&self, at: &Place, name: &str) -> bool {
        !at.inline.is_empty() || self.items.get(&at.file).is_none_or(|items| items.declared.contains(name))
    }

    fn parent_of(&self, file: &str) -> Option<Place> {
        if let Some(parent) = self.parent.get(file) { return Some(parent.clone()) }
        let name = file.rsplit('/').next().unwrap_or(file);
        if name == "lib.rs" || name == "main.rs" { return None }
        let module = if name == "mod.rs" { directory_of(file).to_owned() } else { module_directory(file) };
        let up = directory_of(&module);
        let mut candidates: Vec<String> = ROOT_FILES.iter().map(|root| if up.is_empty() { (*root).to_owned() } else { format!("{up}/{root}") }).collect();
        if !up.is_empty() { candidates.push(format!("{up}.rs")); }
        let found = candidates.into_iter().find(|path| path != file && self.paths.contains(path))?;
        if self.children.contains_key(&found) { return None }
        Some(Place { file: found, inline: Vec::new() })
    }

    fn root_of(&self, file: &str) -> String {
        let mut seen = HashSet::from([file.to_owned()]);
        let mut at = file.to_owned();
        while let Some(up) = self.parent_of(&at) {
            if !seen.insert(up.file.clone()) { break }
            at = up.file;
        }
        at
    }
}

pub(crate) fn is_relative(request: &str) -> bool {
    spelled_path(request) || matches!(request.split("::").next(), Some("self" | "super" | "crate"))
}

fn spelled_path(request: &str) -> bool { request.contains('/') || request.contains('.') }

fn inline_spelled(request: &str) -> bool { request.starts_with("self::") && request.contains('/') }

fn inline_of(request: &str) -> Vec<String> {
    if inline_spelled(request) { request["self::".len()..request.find('/').unwrap()].split("::").map(str::to_owned).collect() }
    else { Vec::new() }
}

fn directory_of(file: &str) -> &str { file.rsplit_once('/').map_or("", |(directory, _)| directory) }

fn module_directory(file: &str) -> String {
    let directory = directory_of(file);
    let name = file.rsplit('/').next().unwrap_or(file);
    if ROOT_FILES.contains(&name) { return directory.to_owned() }
    let stem = name.strip_suffix(".rs").unwrap_or(name);
    if directory.is_empty() { stem.to_owned() } else { format!("{directory}/{stem}") }
}

fn manifest_name(text: &str) -> Option<&str> {
    let mut package = false;
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            if package { return None }
            package = line == "[package]";
        } else if package {
            let Some(after) = line.strip_prefix("name").and_then(|after| after.trim_start().strip_prefix('=')) else { continue };
            let after = after.trim_start();
            let quote = after.chars().next()?;
            if quote != '\'' && quote != '"' { continue }
            let value = &after[1..];
            if let Some(end) = value.find(quote).filter(|end| *end > 0) { return Some(&value[..end]) }
        }
    }
    None
}

fn normalize(path: &str) -> Option<String> {
    let mut parts = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {},
            ".." => { parts.pop()?; },
            _ => parts.push(part),
        }
    }
    Some(parts.join("/"))
}
