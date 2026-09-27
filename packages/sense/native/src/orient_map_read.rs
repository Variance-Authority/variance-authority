//! The reading the code map is folded from: which packages there are, which
//! files are source and which are the tests' side, how many files of one
//! package import another, and what each package is taken for.
//!
//! Everything comes from owners the checkout already has. The source index
//! owns what each file requests and what each request resolved to; git owns
//! what is tracked and, through `linguist-generated` and `linguist-vendored`,
//! what is output rather than source; the manifests own what a package is
//! called and what it declares it takes. Nothing here guesses a target the
//! index did not resolve, except a bare specifier naming a package of this
//! checkout, which is that package whatever file it lands on.

// compass: variance-authority.reach.relations

use std::collections::{HashMap, HashSet};

use rayon::prelude::*;
use regex::Regex;

use crate::compact::Layer;
use crate::package_graph::{fold, join_parses, Crossing};
use crate::package_owners::{owner_of, owners, parent, shown, NO_OWNER};

/// One package: a manifest with a name. A second manifest declaring a name
/// already taken keeps its place, not its name: `name (directory)`.
pub(crate) struct Named {
    pub name: String,
    pub directory: String,
}

pub(crate) struct Read {
    /// Every package, in code-unit order of name; the root's included.
    pub packages: Vec<Named>,
    /// Package names some manifest declares under `dependencies`,
    /// `peerDependencies` or `optionalDependencies`, and under `devDependencies`.
    pub depends: HashSet<String>,
    pub develops: HashSet<String>,
    /// Importer, provider, and how many source files of the importer take
    /// something from the provider; in code-unit order of both names.
    pub edges: Vec<(u32, u32, u32)>,
    /// Source files each package holds: counted, and not the tests' side.
    pub source: Vec<u32>,
    /// Test files importing into each package, once per file.
    pub tested: Vec<u32>,
    /// The names each package is taken for most, at most four, commonest first.
    pub head: Vec<Vec<String>>,
    /// Counted files whose requests could not be read against their parse:
    /// their edges are on the map, from the targets the index resolved, but
    /// not the names they take, and a request the index left unresolved is
    /// not answered by the bare specifier it was written as.
    pub unread: u32,
    /// Files the folded chain holds a record for.
    pub records: u32,
}

/// What a path says of a file: a test, its fixtures, or the harness's config.
const TEST_BY_PATH: &str = r"(?i)\.(test|spec|stories|story)\.[cm]?[jt]sx?$|(^|/)(__tests?__|__mocks__|__fixtures?__|__jest__|__stories__|\.?storybook|fixtures|test|tests|test_helpers?|e2e|test-cases|[^/]*\.test)/|(^|/)[^/]*\.config\.[cm]?[jt]s$|(^|/)(vitest|jest|karma|playwright)[._-][^/]*$|(^|/)(setup[._-]?tests?|tests?[._-]?setup)\.[cm]?[jt]sx?$";
// TODO: a setup file is the runner's to name (`setupFiles`); the path is the
// fallback until the runner's configuration is read here, and nothing imports
// a setup file, so without it the file would read as a shipped entry.

/// One request of one counted file.
struct Request<'a> {
    to: Option<&'a str>,
    kind: &'a str,
    value: Option<&'a str>,
    /// The names it takes, by the rule in `names`.
    names: Vec<&'a str>,
}

struct File<'a> {
    path: &'a str,
    owner: u32,
    requests: Vec<Request<'a>>,
    /// Whether the requests were read against the file's parse.
    parsed: bool,
}

fn code(path: &str) -> bool {
    let extension = path.rsplit('/').next().and_then(|name| name.rsplit_once('.')).map_or("", |(_, extension)| extension);
    matches!(extension, "js" | "jsx" | "ts" | "tsx" | "cjs" | "mjs" | "cts" | "mts")
}

fn bare(value: &str) -> bool {
    !value.starts_with('.') && !value.starts_with('/')
}

/// The package a bare specifier names: its first segment, two when scoped.
fn package_of(value: &str) -> &str {
    let cut = if value.starts_with('@') { value.match_indices('/').nth(1) } else { value.match_indices('/').next() };
    cut.map_or(value, |(at, _)| &value[..at])
}

/// Every file's requests, packages and uses, read from the folded chain.
/// `listed` is what git tracks; without it the files are the ones the index
/// holds, and the manifests the ones beside them.
pub(crate) fn read(root: &str, layers: &[Layer], listed: Option<&[String]>, made: &HashSet<String>) -> Read {
    let by_path = Regex::new(TEST_BY_PATH).expect("the pattern is fixed");
    let folded = fold(layers);
    let records = folded.len() as u32;
    let beside_them;
    let paths = match listed {
        Some(paths) => paths,
        None => {
            beside_them = beside(root, folded.keys().copied());
            &beside_them[..]
        }
    };
    let owners = owners(root, paths);

    let (order, shown) = shown(&owners);
    let mut by_name: Vec<u32> = (0..owners.packages.len() as u32).collect();
    by_name.sort_by(|&a, &b| crate::order::code_unit(&shown[a as usize], &shown[b as usize]));
    let mut index = vec![0u32; owners.packages.len()];
    for (at, &owner) in by_name.iter().enumerate() {
        index[owner as usize] = at as u32;
    }
    let packages: Vec<Named> = by_name
        .iter()
        .map(|&owner| Named { name: shown[owner as usize].clone(), directory: owners.packages[owner as usize].directory.clone() })
        .collect();
    let named: HashMap<&str, u32> = order.iter().rev().map(|&at| (owners.packages[at as usize].name.as_str(), index[at as usize])).collect();
    let (mut depends, mut develops) = (HashSet::new(), HashSet::new());
    for package in &owners.packages {
        depends.extend(package.depends.iter().cloned());
        develops.extend(package.develops.iter().cloned());
    }

    // Any path's package, tracked or not: its nearest named directory.
    let directories: HashMap<&str, u32> =
        owners.packages.iter().enumerate().map(|(at, package)| (package.directory.as_str(), at as u32)).collect();
    let owner_of = |path: &str| -> Option<u32> { owner_of(&owners, &directories, path).map(|owner| index[owner as usize]) };

    // A counted file is tracked, not output, and owned.
    let mut crossings: Vec<Crossing> = folded
        .into_iter()
        .filter(|(path, _)| !made.contains(*path))
        .filter_map(|(path, at)| {
            let &(owner, _) = owners.files.get(path)?;
            (owner != NO_OWNER).then(|| Crossing { file: path, owner: index[owner as usize], others: Vec::new(), at, parse: None })
        })
        .collect();
    crossings.sort_unstable_by(|a, b| crate::order::code_unit(a.file, b.file));
    join_parses(layers, &mut crossings);
    let files: Vec<File> = crossings.par_iter().map(|crossing| requests(layers, crossing)).collect();
    let unread = files.iter().filter(|file| !file.parsed).count() as u32;
    let counted: HashMap<&str, usize> = files.iter().enumerate().map(|(at, file)| (file.path, at)).collect();

    let test = tests(&files, &counted, &by_path);
    let targets: Vec<Vec<Option<u32>>> =
        files.par_iter().map(|file| file.requests.iter().map(|request| request.to.and_then(&owner_of)).collect()).collect();

    let n = packages.len();
    let (mut source, mut tested) = (vec![0u32; n], vec![0u32; n]);
    let mut edges: HashMap<(u32, u32), u32> = HashMap::new();
    // Provider and name: the files that take it, and the packages they are in.
    let mut uses: HashMap<(u32, &str), (u32, HashSet<u32>)> = HashMap::new();
    for (at, file) in files.iter().enumerate() {
        let a = file.owner;
        if test[at] {
            let mut seen: HashSet<u32> = HashSet::new();
            for &b in targets[at].iter().flatten() {
                if b != a && !packages[b as usize].directory.is_empty() && seen.insert(b) {
                    tested[b as usize] += 1;
                }
            }
            continue;
        }
        source[a as usize] += 1;
        let mut taken: HashSet<u32> = HashSet::new();
        let mut names: HashSet<(u32, &str)> = HashSet::new();
        for (request, &target) in file.requests.iter().zip(&targets[at]) {
            let b = target.or_else(|| request.value.filter(|value| bare(value)).and_then(|value| named.get(package_of(value)).copied()));
            let Some(b) = b else { continue };
            if b == a || request.to.is_some_and(|to| !code(to)) {
                continue;
            }
            taken.insert(b);
            // What a package is taken for is read from shipped code taking
            // shipped code, through a request that takes rather than republishes.
            let Some(&provider) = request.to.and_then(|to| counted.get(to)) else { continue };
            if !code(file.path) || provider == at || test[provider] || request.kind == "reexports" || files[provider].owner != b {
                continue;
            }
            for &name in &request.names {
                if names.insert((b, name)) {
                    let entry = uses.entry((b, name)).or_default();
                    entry.0 += 1;
                    entry.1.insert(a);
                }
            }
        }
        for b in taken {
            *edges.entry((a, b)).or_default() += 1;
        }
    }
    let mut edges: Vec<(u32, u32, u32)> = edges.into_iter().map(|((a, b), files)| (a, b, files)).collect();
    edges.sort_unstable();
    Read { head: heads(n, uses), packages, depends, develops, edges, source, tested, unread, records }
}

/// A package's head: the names taken more than an equal share would give
/// them, or all of them when it is taken evenly; the first four.
fn heads(n: usize, uses: HashMap<(u32, &str), (u32, HashSet<u32>)>) -> Vec<Vec<String>> {
    let mut by: Vec<Vec<(&str, u32, usize)>> = vec![Vec::new(); n];
    for ((b, name), (files, packages)) in uses {
        by[b as usize].push((name, files, packages.len()));
    }
    by.into_iter()
        .map(|mut names| {
            names.sort_by(|x, y| y.1.cmp(&x.1).then(y.2.cmp(&x.2)).then_with(|| crate::order::code_unit(x.0, y.0)));
            let total: u64 = names.iter().map(|name| name.1 as u64).sum();
            let count = names.len() as u64;
            let over: Vec<&str> = names.iter().filter(|name| name.1 as u64 * count > total).map(|name| name.0).collect();
            let head = if over.is_empty() { names.iter().map(|name| name.0).collect() } else { over };
            head.into_iter().take(4).map(str::to_owned).collect()
        })
        .collect()
}

/// Which files are the tests' side: a test by its path, and whatever a test
/// reaches that nothing shipped does. Shipped is what the entries reach, an
/// entry being a file nothing imports that is not a test by its path.
// TODO: what a test's specifier meant is the runner's alias table to say, and a
// stub it maps to connects nothing; this walks the index's targets alone, so a
// file only an aliased import reaches can land on the wrong side.
fn tests(files: &[File], counted: &HashMap<&str, usize>, by_path: &Regex) -> Vec<bool> {
    let outgoing: Vec<Vec<usize>> = files
        .iter()
        .enumerate()
        .map(|(at, file)| file.requests.iter().filter_map(|request| counted.get(request.to?).copied()).filter(|&to| to != at).collect())
        .collect();
    let named: Vec<bool> = files.iter().map(|file| by_path.is_match(file.path)).collect();
    let mut imported = vec![false; files.len()];
    for &to in outgoing.iter().flatten() {
        imported[to] = true;
    }
    let walk = |starts: Vec<usize>, stop: &dyn Fn(usize) -> bool| {
        let mut seen = vec![false; files.len()];
        for &start in &starts {
            seen[start] = true;
        }
        let mut queue = starts;
        while let Some(at) = queue.pop() {
            for &to in &outgoing[at] {
                if !seen[to] && !stop(to) {
                    seen[to] = true;
                    queue.push(to);
                }
            }
        }
        seen
    };
    let shipped = walk((0..files.len()).filter(|&at| !named[at] && !imported[at]).collect(), &|at| named[at]);
    let reached = walk((0..files.len()).filter(|&at| named[at]).collect(), &|at| shipped[at]);
    (0..files.len()).map(|at| named[at] || reached[at]).collect()
}

/// One counted file's requests, each with its target and the names it takes:
/// a binding's imported name; a namespace's members read off it, or `*`; with
/// no binding, the members read off the request, or `*`.
fn requests<'a>(layers: &'a [Layer<'a>], crossing: &Crossing<'a>) -> File<'a> {
    let (record_layer, record_row) = crossing.at;
    let (stored, records) = (&layers[record_layer].stored, &layers[record_layer].records);
    let targets: Vec<Option<&str>> = if records.targets_present[record_row] == 1 {
        records.targets.range(record_row).map(|target| stored.optional(records.target_path.at(target))).collect()
    } else {
        Vec::new()
    };
    let file = |requests, parsed| File { path: crossing.file, owner: crossing.owner, requests, parsed };
    let unparsed = |targets: Vec<Option<&'a str>>| {
        file(targets.into_iter().map(|to| Request { to, kind: "", value: None, names: Vec::new() }).collect(), false)
    };
    let Some((parse_layer, parse_row)) = crossing.parse else { return unparsed(targets) };
    let (text, parses) = (&layers[parse_layer].stored, &layers[parse_layer].parses);
    let range = parses.requests.range(parse_row);
    if range.len() != targets.len() {
        return unparsed(targets);
    }
    let mut read: HashMap<usize, Vec<&str>> = HashMap::new();
    for member in parses.members.range(parse_row) {
        read.entry(parses.member_request.at(member) as usize).or_default().push(text.text(parses.member_name.at(member)));
    }
    let requests = range
        .zip(targets)
        .enumerate()
        .map(|(local, (request, to))| {
            let reads = read.get(&local).map(Vec::as_slice).unwrap_or(&[]);
            let bindings = parses.request_bindings.range(request);
            let mut names: Vec<&str> = Vec::new();
            if bindings.is_empty() {
                names.extend(if reads.is_empty() { &["*"][..] } else { reads });
            }
            for binding in bindings {
                match text.text(parses.binding_imported.at(binding)) {
                    "*" if !reads.is_empty() => names.extend(reads),
                    imported => names.push(imported),
                }
            }
            let kind = text.text(parses.request_kind.at(request));
            Request { to, kind, value: Some(text.text(parses.request_value.at(request))), names }
        })
        .collect();
    file(requests, true)
}

/// The files the index holds, and every `package.json` in a directory above
/// one of them, in code-unit order: what git would have listed of them.
fn beside<'a>(root: &str, indexed: impl Iterator<Item = &'a str>) -> Vec<String> {
    let mut paths: Vec<String> = Vec::new();
    let mut directories: HashSet<&str> = HashSet::new();
    for path in indexed {
        paths.push(path.to_owned());
        let mut directory = parent(path);
        while directories.insert(directory) {
            if directory.is_empty() {
                break;
            }
            directory = parent(directory);
        }
    }
    let manifests: Vec<String> = directories
        .par_iter()
        .map(|directory| if directory.is_empty() { "package.json".to_owned() } else { format!("{directory}/package.json") })
        .filter(|manifest| std::path::Path::new(root).join(manifest).is_file())
        .collect();
    paths.extend(manifests);
    paths.sort_unstable_by(|left, right| crate::order::code_unit(left, right));
    paths.dedup();
    paths
}

#[cfg(test)]
mod tests {
    use super::{code, package_of};

    #[test]
    fn a_bare_specifier_names_its_package() {
        assert_eq!(package_of("@kbn/core/server"), "@kbn/core");
        assert_eq!(package_of("lodash/get"), "lodash");
        assert_eq!(package_of("react"), "react");
    }

    #[test]
    fn code_is_a_script_extension() {
        assert!(code("a/b.tsx") && code("x.mjs") && !code("a.json") && !code("a.d/readme"));
    }
}
