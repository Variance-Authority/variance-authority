//! External package requests reached from files a reader already has.
//!
//! The source index owns the requests and their resolved targets. Walking only
//! those targets keeps an unrelated package in the same monorepo out of the
//! answer. A manifest says what was requested for installation; it cannot turn
//! a package into one this path imports.

// compass: variance-authority.reach.relations

use std::collections::{HashMap, HashSet, VecDeque};

use napi_derive::napi;
use rayon::prelude::*;

use crate::compact::Layer;
use crate::index_chain::{read_chain, Chain};
use crate::order::code_unit;
use crate::package_graph::{fold, join_parses, names_object, orientation, Crossing, Limits, Listed, Orientation};
use crate::package_owners::{declared, owners, Manifest, NO_OWNER};
use crate::specifier::{package_of, request_of};

#[napi(object)]
pub struct ExternalSite {
    pub file: String,
    pub line: u32,
    pub specifier: String,
    pub kind: String,
    pub names: Vec<String>,
    /// Number of local imports between the asked file and this importer.
    pub distance: u32,
}

#[napi(object)]
pub struct ExternalDependency {
    pub package: String,
    /// Written requests. Two requests from one file are two imports.
    pub imports: u32,
    pub files: u32,
    pub sites: Vec<ExternalSite>,
    pub more_sites: u32,
    /// Where a manifest declares this name; empty means no reached owner or
    /// root manifest declared it. Declaration is context, never use evidence.
    pub declared_in: Vec<String>,
}

#[napi(object)]
pub struct ExternalOrientation {
    pub dependencies: Vec<ExternalDependency>,
    pub more: u32,
    pub reached: u32,
    pub unread: u32,
    pub stale: u32,
    pub missing: Vec<String>,
    pub declared_only: Vec<String>,
    pub more_declared_only: u32,
    pub dropped: u32,
}

#[napi(catch_unwind)]
pub fn external_dependencies(
    root: String,
    index: String,
    files: Vec<String>,
    rows: u32,
    sites: u32,
) -> napi::Result<Option<ExternalOrientation>> {
    let (chain, snapshot) = std::thread::scope(|scope| {
        let snapshot = scope.spawn(|| crate::git::snapshot(&root));
        (read_chain(&index), snapshot.join().ok().flatten())
    });
    let fail = |error: String| napi::Error::from_reason(format!("the source index at {index} did not read: {error}"));
    let Some(chain) = chain.map_err(fail)? else { return Ok(None) };
    let snapshot = snapshot.ok_or_else(|| napi::Error::from_reason(format!("git could not list the tree at {root}")))?;
    let listed = Listed { paths: &snapshot.paths, oids: &snapshot.oids };
    inspect(&root, &chain, &listed, &files, rows as usize, sites as usize).map(Some).map_err(fail)
}

/// Both readings a question makes of the source index, from one read of the chain and one listing of
/// the working tree: `git status` is the cost of either, and asking it twice charged a question twice.
#[napi(object)]
pub struct Around {
    pub packages: Orientation,
    pub external: ExternalOrientation,
}

#[napi(catch_unwind)]
#[allow(clippy::too_many_arguments, reason = "one index reading and both outputs' bounds")]
pub fn orient_around(
    root: String,
    index: String,
    files: Vec<String>,
    package_rows: u32,
    package_names: u32,
    external_rows: u32,
    external_sites: u32,
) -> napi::Result<Option<Around>> {
    let (chain, snapshot) = std::thread::scope(|scope| {
        let snapshot = scope.spawn(|| crate::git::snapshot(&root));
        (read_chain(&index), snapshot.join().ok().flatten())
    });
    let fail = |error: String| napi::Error::from_reason(format!("the source index at {index} did not read: {error}"));
    let Some(chain) = chain.map_err(fail)? else { return Ok(None) };
    let snapshot = snapshot.ok_or_else(|| napi::Error::from_reason(format!("git could not list the tree at {root}")))?;
    let listed = Listed { paths: &snapshot.paths, oids: &snapshot.oids };
    let limits = Limits { rows: package_rows as usize, names: package_names as usize };
    let (packages, external) = rayon::join(
        || orientation(&root, &chain, &listed, &files, limits),
        || inspect(&root, &chain, &listed, &files, external_rows as usize, external_sites as usize),
    );
    Ok(Some(Around { packages: packages.map_err(fail)?, external: external.map_err(fail)? }))
}

struct Found {
    sites: Vec<ExternalSite>,
    files: HashSet<String>,
    declared_in: HashSet<String>,
}

impl Found {
    fn new() -> Self {
        Self { sites: Vec::new(), files: HashSet::new(), declared_in: HashSet::new() }
    }
}

fn root_declarations(root: &str) -> (HashSet<String>, HashSet<String>) {
    let manifest = std::fs::read(std::path::Path::new(root).join("package.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Manifest>(&bytes).ok());
    let Some(manifest) = manifest else { return (HashSet::new(), HashSet::new()) };
    let runtime = [&manifest.dependencies, &manifest.peer_dependencies, &manifest.optional_dependencies]
        .into_iter()
        .flat_map(declared)
        .collect();
    let development = declared(&manifest.dev_dependencies).collect();
    (runtime, development)
}

#[allow(clippy::too_many_arguments, reason = "one index reading and its output bounds")]
fn inspect(
    root: &str,
    chain: &Chain,
    listed: &Listed,
    files: &[String],
    row_limit: usize,
    site_limit: usize,
) -> Result<ExternalOrientation, String> {
    let (layers, owners) = rayon::join(
        || chain.segments.par_iter().enumerate().map(|(at, bytes)| {
            Layer::open(bytes).map_err(|error| format!("segment {at}: {error}"))
        }).collect::<Result<Vec<_>, _>>(),
        || owners(root, listed.paths),
    );
    let layers = layers?;
    let folded = fold(&layers);
    let internal: HashSet<&str> = owners.packages.iter().map(|package| package.name.as_str()).collect();
    let (root_runtime, root_development) = root_declarations(root);

    let mut distance: HashMap<&str, u32> = HashMap::new();
    let mut queue = VecDeque::new();
    let mut missing = Vec::new();
    for file in files {
        if let Some((&path, _)) = folded.get_key_value(file.as_str()) {
            if !distance.contains_key(path) {
                distance.insert(path, 0);
                queue.push_back(path);
            }
        } else {
            missing.push(file.clone());
        }
    }

    let mut crossings = Vec::new();
    let (mut stale, mut unread) = (0, 0);
    while let Some(file) = queue.pop_front() {
        let at = folded[file];
        let (layer, row) = at;
        let (stored, records) = (&layers[layer].stored, &layers[layer].records);
        let current = owners.files.get(file).is_some_and(|&(_, listing)| {
            stored.optional(records.digest.at(row))
                .is_some_and(|digest| names_object(digest, &listed.oids[listing as usize]))
        });
        if !current {
            stale += 1;
            continue;
        }
        if records.targets_present[row] != 1 {
            if records.indexed(stored, row).record.unknown.is_some() { unread += 1; }
            continue;
        }
        for target in records.targets.range(row) {
            let Some(path) = stored.optional(records.target_path.at(target)) else { continue };
            if let Some((&path, _)) = folded.get_key_value(path) {
                if !distance.contains_key(path) {
                    distance.insert(path, distance[file] + 1);
                    queue.push_back(path);
                }
            }
        }
        crossings.push(Crossing { file, owner: NO_OWNER, others: Vec::new(), at, parse: None });
    }
    join_parses(&layers, &mut crossings);

    let mut found: HashMap<String, Found> = HashMap::new();
    let mut declarations = HashSet::new();
    for crossing in &crossings {
        let owner = owners.files.get(crossing.file).map(|&(owner, _)| owner).unwrap_or(NO_OWNER);
        let local = owners.packages.get(owner as usize);
        if let Some(local) = local {
            declarations.extend(local.depends.iter().chain(&local.develops).filter(|name| !internal.contains(name.as_str())).cloned());
        }
        let Ok(requests) = requests_of(&layers, crossing, &internal) else {
            unread += 1;
            continue;
        };
        for request in requests {
            let package = request.package.as_str();
            let entry = found.entry(request.package.clone()).or_insert_with(Found::new);
            entry.files.insert(crossing.file.to_owned());
            entry.sites.push(ExternalSite {
                file: crossing.file.to_owned(), line: request.line, specifier: request.specifier, kind: request.kind,
                names: request.names, distance: distance[crossing.file],
            });
            if let Some(local) = local {
                if local.depends.iter().any(|name| name == package) { entry.declared_in.insert(format!("{}/package.json", local.directory).trim_start_matches('/').to_owned()); }
                if local.develops.iter().any(|name| name == package) { entry.declared_in.insert(format!("{}/package.json (development)", local.directory).trim_start_matches('/').to_owned()); }
            }
            if root_runtime.contains(package) { entry.declared_in.insert("root package.json".to_owned()); }
            if root_development.contains(package) { entry.declared_in.insert("root package.json (development)".to_owned()); }
        }
    }
    if crossings.iter().any(|crossing| owners.files.get(crossing.file).is_none_or(|&(owner, _)| {
        owner == NO_OWNER || owners.packages.get(owner as usize).is_some_and(|package| package.directory.is_empty())
    })) {
        declarations.extend(root_runtime.iter().chain(&root_development).filter(|name| !internal.contains(name.as_str())).cloned());
    }
    let seen: HashSet<&str> = found.keys().map(String::as_str).collect();
    let mut declared_only: Vec<String> = declarations.into_iter().filter(|name| !seen.contains(name.as_str())).collect();
    declared_only.sort_unstable_by(|left, right| code_unit(left, right));
    let more_declared_only = declared_only.len().saturating_sub(5) as u32;
    declared_only.truncate(5);

    let mut dependencies: Vec<ExternalDependency> = found.into_iter().map(|(package, mut found)| {
        found.sites.sort_unstable_by(|left, right| {
            left.distance.cmp(&right.distance)
                .then_with(|| code_unit(&left.file, &right.file))
                .then_with(|| left.line.cmp(&right.line))
                .then_with(|| code_unit(&left.specifier, &right.specifier))
        });
        let imports = found.sites.len() as u32;
        let more_sites = found.sites.len().saturating_sub(site_limit) as u32;
        found.sites.truncate(site_limit);
        let mut declared_in: Vec<String> = found.declared_in.into_iter().collect();
        declared_in.sort_unstable_by(|left, right| code_unit(left, right));
        ExternalDependency {
            package, imports, files: found.files.len() as u32, sites: found.sites, more_sites,
            declared_in,
        }
    }).collect();
    dependencies.sort_unstable_by(|left, right| right.files.cmp(&left.files)
        .then_with(|| right.imports.cmp(&left.imports))
        .then_with(|| code_unit(&left.package, &right.package)));
    let more = dependencies.len().saturating_sub(row_limit) as u32;
    dependencies.truncate(row_limit);
    Ok(ExternalOrientation {
        dependencies, more, reached: distance.len() as u32, unread, stale, missing,
        declared_only, more_declared_only, dropped: chain.dropped,
    })
}

/// One written request for a package outside the checkout.
pub(crate) struct Request {
    pub package: String,
    pub specifier: String,
    pub kind: String,
    pub line: u32,
    pub names: Vec<String>,
}

/// The external requests one crossing's record and parse say the file writes, in source order. `Err` is a file the
/// index holds but could not read, or whose parse is not among `layers`: the caller counts it unread, or reads
/// more layers. Both the orientation and the lexicon's incremental refresh ask this, so the two never disagree.
pub(crate) fn requests_of(layers: &[Layer], crossing: &Crossing, internal: &HashSet<&str>) -> Result<Vec<Request>, ()> {
    let (record_layer, record_row) = crossing.at;
    let (stored, records) = (&layers[record_layer].stored, &layers[record_layer].records);
    let indexed = records.indexed(stored, record_row);
    let packages: HashSet<&str> = indexed.record.packages.as_deref().unwrap_or(&[]).iter().map(|edge| edge.to.as_str()).collect();
    if indexed.record.unknown.is_some() { return Err(()); }
    if packages.is_empty() { return Ok(Vec::new()); }
    if indexed.targets.is_none() { return Err(()); }
    let Some((parse_layer, parse_row)) = crossing.parse else { return Err(()) };
    let (text, parses) = (&layers[parse_layer].stored, &layers[parse_layer].parses);
    let requests = parses.requests.range(parse_row);
    let targets = records.targets.range(record_row);
    if requests.len() != targets.len() { return Err(()); }
    let mut found = Vec::new();
    for (request, target) in requests.zip(targets) {
        if stored.optional(records.target_path.at(target)).is_some() { continue; }
        let specifier = text.text(parses.request_value.at(request));
        let Some(package) = request_of(specifier).and_then(|name| package_of(name, &HashSet::new())) else { continue };
        if !packages.contains(package) || internal.contains(package) { continue; }
        let mut names: HashSet<String> = parses.request_bindings.range(request)
            .map(|binding| text.text(parses.binding_imported.at(binding)).to_owned())
            .collect();
        if names.is_empty() { names.insert("*".to_owned()); }
        if names.contains("*") {
            for member in parses.members.range(parse_row) {
                if parses.member_request.at(member) as usize == request - parses.requests.at(parse_row) as usize {
                    names.insert(text.text(parses.member_name.at(member)).to_owned());
                }
            }
            if names.len() > 1 { names.remove("*"); }
        }
        let mut names: Vec<String> = names.into_iter().collect();
        names.sort_unstable_by(|left, right| code_unit(left, right));
        found.push(Request {
            package: package.to_owned(), specifier: specifier.to_owned(),
            kind: text.text(parses.request_kind.at(request)).to_owned(), line: parses.request_line.at(request), names,
        });
    }
    Ok(found)
}
