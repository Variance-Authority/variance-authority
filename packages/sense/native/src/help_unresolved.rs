//! The imports the index resolved to no file, read for a name: the files
//! `importers` cannot answer for, and the places outside the workspace a name
//! no file here declares comes from.

// compass: variance-authority.reach.relations

use std::collections::{HashMap, HashSet};

use crate::compact::Layer;
use crate::orient_map_read::beside;
use crate::package_graph::{fold, join_parses, passed_on, At, Crossing};
use crate::package_owners::{owners, parent, NO_OWNER};
use crate::specifier::{is_relative, package_of};
use crate::witness_aliases::AliasesRead;

/// One import the index resolved to no file: the importing file, the parse
/// it is read from, the request's place in it and the specifier as written.
struct Unresolved<'a> {
    file: &'a str,
    layer: usize,
    row: usize,
    request: usize,
    written: &'a str,
}

/// Every import, by importing file in code-unit order, whose specifier the
/// record lists as resolved to no file and `keep` lets through. Only a file
/// whose record lists one has its parse read.
fn unresolved_imports<'a>(layers: &'a [Layer], folded: &HashMap<&'a str, At>, keep: &dyn Fn(&str) -> bool) -> Vec<Unresolved<'a>> {
    let mut crossings: Vec<Crossing> = folded
        .iter()
        .filter(|&(_, &(layer, row))| {
            let (stored, records) = (&layers[layer].stored, &layers[layer].records);
            records.unresolved_of(stored, row).is_some_and(|mut written| written.any(keep))
        })
        .map(|(&file, &at)| Crossing { file, owner: NO_OWNER, others: Vec::new(), at, parse: None })
        .collect();
    crossings.sort_unstable_by(|a, b| crate::order::code_unit(a.file, b.file));
    join_parses(layers, &mut crossings);
    let mut found = Vec::new();
    for crossing in &crossings {
        let Some((layer, row)) = crossing.parse else { continue };
        let (stored, records) = (&layers[crossing.at.0].stored, &layers[crossing.at.0].records);
        if records.targets_present[crossing.at.1] != 1 { continue; }
        let targets = records.targets.range(crossing.at.1);
        let (text, parses) = (&layers[layer].stored, &layers[layer].parses);
        // A record that does not line up with its parse names no request.
        if targets.len() != parses.requests.range(row).len() { continue; }
        for (target, request) in targets.zip(parses.requests.range(row)) {
            if stored.optional(records.target_path.at(target)).is_some() { continue; }
            let written = text.text(parses.request_value.at(request));
            if keep(written) { found.push(Unresolved { file: crossing.file, layer, row, request, written }); }
        }
    }
    found
}

/// Whether the import could take one of `exports`: it binds one, reads one
/// off the module, holds the module whole, or passes one on.
fn takes(layers: &[Layer], import: &Unresolved, exports: &HashSet<String>) -> bool {
    let layer = &layers[import.layer];
    if layer.parses.request_republishes[import.request] == 1 {
        return match passed_on(layer, import.row, import.request) {
            None => true,
            Some(listed) => listed.iter().any(|one| one.imported == "*" || exports.contains(one.imported)),
        };
    }
    super::taken(layer, import.row, import.request, "", "", "", "").iter().any(|(one, _)| one.whole || exports.contains(&one.name))
}

/// Every file, in code-unit order, with an import that resolved to no file
/// and could take one of `exports`: a relative specifier, a path alias or a
/// `#` subpath import, which could have meant any file, or one naming a
/// package that holds one of `files` or `through`, the files the name is
/// declared in or passed on through.
pub(super) fn unresolved(
    root: &str,
    layers: &[Layer],
    folded: &HashMap<&str, At>,
    files: &[String],
    through: &HashSet<String>,
    exports: &HashSet<String>,
) -> Vec<String> {
    let holding = files.iter().map(String::as_str).chain(through.iter().map(String::as_str));
    let paths = beside(root, holding.clone());
    let packages: HashSet<String> = {
        let owners = owners(root, &paths);
        holding.map(|file| owners.package_of(file)).filter(|name| !name.is_empty()).map(str::to_owned).collect()
    };
    let none = HashSet::new();
    let mapped = configured(root, folded);
    // A path alias, a `#` subpath import or a configuration's mapping names a file of this workspace, so it could have meant any.
    let meant = |written: &str| {
        is_relative(written)
            || written.starts_with('#')
            || mapped(written)
            || package_of(written, &none).is_some_and(|package| !named_like_a_package(package) || packages.contains(package))
    };
    let mut found: Vec<String> =
        unresolved_imports(layers, folded, &meant).iter().filter(|import| takes(layers, import, exports)).map(|import| import.file.to_owned()).collect();
    found.dedup();
    found
}

/// Whether a specifier names a file of this workspace through the `paths` or
/// `baseUrl` a `tsconfig` or `jsconfig` beside an indexed file declares: it
/// matches a mapping's pattern, or its first segment is a file or directory
/// the index holds under a `baseUrl`. A configuration that cannot be read maps
/// nothing.
fn configured(root: &str, folded: &HashMap<&str, At>) -> impl Fn(&str) -> bool {
    let mut directories: HashSet<&str> = HashSet::new();
    for &file in folded.keys() {
        let mut directory = parent(file);
        while directories.insert(directory) && !directory.is_empty() {
            directory = parent(directory);
        }
    }
    let configs: Vec<String> = directories
        .iter()
        .flat_map(|directory| ["tsconfig.json", "jsconfig.json"].map(|name| if directory.is_empty() { name.to_owned() } else { format!("{directory}/{name}") }))
        .filter(|config| std::path::Path::new(root).join(config).is_file())
        .collect();
    let AliasesRead { bases, mappings } = crate::witness_aliases::read(root, &configs).unwrap_or(AliasesRead { bases: Vec::new(), mappings: Vec::new() });
    // The first segment of every indexed path under a `baseUrl`, with its extension and without.
    let mut under: HashSet<String> = HashSet::new();
    for base in &bases {
        let prefix = if base.is_empty() { String::new() } else { format!("{base}/") };
        for &file in folded.keys() {
            let Some(rest) = file.strip_prefix(prefix.as_str()) else { continue };
            let first = rest.split('/').next().unwrap_or(rest);
            under.insert(format!("{base}\0{first}"));
            if let Some((stem, _)) = first.rsplit_once('.') {
                under.insert(format!("{base}\0{stem}"));
            }
        }
    }
    move |written: &str| {
        let first = written.split('/').next().unwrap_or(written);
        bases.iter().any(|base| under.contains(&format!("{base}\0{first}")))
            || mappings.iter().any(|mapping| match &mapping.suffix {
                None => written == mapping.prefix,
                Some(suffix) => {
                    written.len() >= mapping.prefix.len() + suffix.len() && written.starts_with(&mapping.prefix) && written.ends_with(suffix.as_str())
                }
            })
    }
}

/// Whether `package` could be a package's name as npm spells one: a scope
/// holds a name, and no name starts with `.`, `_` or `~`. A path alias such
/// as `@/lib` or `~/lib` is not one.
fn named_like_a_package(package: &str) -> bool {
    let bare = match package.strip_prefix('@') {
        Some(scoped) => scoped,
        None => package,
    };
    !bare.starts_with(['/', '.', '_', '~'])
}

/// Every specifier, as written and in code-unit order, that names a package
/// or a runtime module, none of the workspace's own, that the index resolved
/// to no file and that an import binds `name` out of or reads it off: where a
/// name no file here declares comes from, for `discover --imports` to list the
/// files.
pub(crate) fn sources(root: &str, layers: &[Layer], name: &str) -> Vec<String> {
    let folded = fold(layers);
    let paths = beside(root, folded.keys().copied());
    let workspace: HashSet<String> = owners(root, &paths).packages.into_iter().map(|package| package.name).collect();
    let none = HashSet::new();
    let mapped = configured(root, &folded);
    let outside = |written: &str| {
        !mapped(written) && package_of(written, &none).is_some_and(|package| named_like_a_package(package) && !workspace.contains(package))
    };
    let wanted = HashSet::from([name.to_owned()]);
    let mut found: Vec<String> = unresolved_imports(layers, &folded, &outside)
        .iter()
        .filter(|import| layers[import.layer].parses.request_republishes[import.request] != 1)
        .filter(|import| {
            super::taken(&layers[import.layer], import.row, import.request, "", "", "", "").iter().any(|(one, _)| !one.whole && !one.through_default && wanted.contains(&one.name))
        })
        .map(|import| import.written.to_owned())
        .collect();
    found.sort_unstable_by(|a, b| crate::order::code_unit(a, b));
    found.dedup();
    found
}
