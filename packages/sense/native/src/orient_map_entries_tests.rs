//! Where a package's shipped code starts, read from a checkout of four
//! packages whose every source file a test of their own also imports.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use crate::compact::Layer;
use crate::generation::Delta;
use crate::graph_index::merged;
use crate::index_chain::read_chain;
use crate::orient_map_read::{read, Read};

struct Fixture(PathBuf);

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Each file with its text, and the files its requests resolved to.
const FILES: &[(&str, &str, &[&str])] = &[
    ("package.json", r#"{"private": true}"#, &[]),
    // Offered through its build's output, which is read as the source it is emitted from.
    ("packages/built/package.json", r#"{"name": "@t/built", "exports": {".": {"types": "./dist/index.d.ts", "default": "./dist/index.js"}}}"#, &[]),
    ("packages/built/tsconfig.json", r#"{"compilerOptions": {"outDir": "./dist", "rootDir": "./src"}}"#, &[]),
    ("packages/built/src/index.ts", "export const make = 1;\n", &[]),
    ("packages/built/src/index.test.ts", "import { make } from './index.ts';\n", &["packages/built/src/index.ts"]),
    // Offers nothing, so its entries are the files its own code never imports.
    ("packages/bare/package.json", r#"{"name": "@t/bare"}"#, &[]),
    ("packages/bare/src/index.ts", "export const make = 1;\n", &[]),
    ("packages/bare/src/index.test.ts", "import { make } from './index.ts';\n", &["packages/bare/src/index.ts"]),
    // A package named for Storybook, holding a directory of its stories' helpers.
    ("packages/storybook/package.json", r#"{"name": "@t/storybook", "main": "src/index.ts", "bin": {"sb": "./src/index.test.ts"}}"#, &[]),
    ("packages/storybook/src/index.ts", "export const make = 1;\n", &[]),
    ("packages/storybook/src/index.test.ts", "import { make } from './index.ts';\n", &["packages/storybook/src/index.ts"]),
    ("packages/storybook/storybook/decorator.ts", "import { make } from '../src/index.ts';\n", &["packages/storybook/src/index.ts"]),
    // A subpath pattern over source: each directory's index is an entry, and a file no entry loads is not in the closure.
    ("packages/patterned/package.json", r#"{"name": "@t/patterned", "exports": {"./*": "./src/*/index.ts"}}"#, &[]),
    ("packages/patterned/src/Foo/helper.ts", "export const make = 1;\n", &[]),
    ("packages/patterned/src/Foo/index.ts", "import { make } from './helper.ts';\n", &["packages/patterned/src/Foo/helper.ts"]),
    ("packages/patterned/src/orphan.ts", "export const make = 1;\n", &[]),
    // A subpath pattern over the build's output, read as the source it is emitted from.
    ("packages/emitted/package.json", r#"{"name": "@t/emitted", "exports": {"./*": {"types": "./dist/*.d.ts", "default": "./dist/*.js"}}}"#, &[]),
    ("packages/emitted/tsconfig.json", r#"{"compilerOptions": {"outDir": "./dist", "rootDir": "./src"}}"#, &[]),
    ("packages/emitted/src/a/b.ts", "export const make = 1;\n", &[]),
    // Offers files a runner's name is on, and what they load ships with them.
    ("packages/runner/package.json", r#"{"name": "@t/runner", "exports": {"./jest": "./src/jest.ts"}}"#, &[]),
    ("packages/runner/src/jest.ts", "import { make } from './jest-environment.ts';\n", &["packages/runner/src/jest-environment.ts"]),
    ("packages/runner/src/jest-environment.ts", "export const make = 1;\n", &[]),
    ("packages/runner/src/jest.test.ts", "import { make } from './jest.ts';\n", &["packages/runner/src/jest.ts"]),
    // A package inside a test's fixtures offers its file to the test, not to a consumer.
    ("packages/runner/src/__fixtures__/pkg/package.json", r#"{"name": "@t/fixture", "main": "./index.ts"}"#, &[]),
    ("packages/runner/src/__fixtures__/pkg/index.ts", "export const make = 1;\n", &[]),
];

fn publish(index: &str) {
    let (mut records, mut parses) = (Vec::new(), Vec::new());
    for (at, (file, _, targets)) in FILES.iter().enumerate().filter(|(_, (file, _, _))| file.ends_with(".ts")) {
        let digest = format!("d{at}");
        let quoted: Vec<String> = targets.iter().map(|target| format!("\"{target}\"")).collect();
        records.push(format!(
            r#"["{file}", {{"record": {{"file": "{file}", "digest": "{digest}"}}, "witnesses": [], "targets": [{}]}}]"#,
            quoted.join(", ")
        ));
        let requests: Vec<String> = targets
            .iter()
            .map(|_| r#"{"value": "./index.ts", "kind": "imports", "line": 1, "bindings": [{"imported": "make", "local": "make", "type": false, "line": 1}]}"#.to_owned())
            .collect();
        // Keyed the way the scan keys a parse, which a test file's name changes.
        let way = crate::index::way(file).replace('\0', "\\u0000");
        parses.push(format!(r#"["{digest}\u0000{way}", {{"requests": [{}], "size": {{"bytes": 30, "lines": 1}}}}]"#, requests.join(", ")));
    }
    let document = format!(r#"{{"records": [{}], "parses": [{}], "deletedRecords": [], "deletedParses": []}}"#, records.join(", "), parses.join(", "));
    let segment = merged(&[], &Delta::of(vec![document]).unwrap());
    crate::log::publish(index, &[], &[&segment], &[]).unwrap();
}

fn folded(name: &str) -> (Fixture, Read) {
    let root = std::env::temp_dir().join(format!("sense-orient-entries-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    for (path, text, _) in FILES {
        let file = root.join(path);
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(file, text).unwrap();
    }
    let index = root.join("source-index.bin").to_string_lossy().into_owned();
    publish(&index);
    let chain = read_chain(&index).unwrap().expect("a published chain");
    let layers: Vec<Layer> = chain.segments.iter().map(|bytes| Layer::open(bytes).unwrap()).collect();
    let mut paths: Vec<String> = FILES.iter().map(|(path, _, _)| (*path).to_owned()).collect();
    paths.sort_by(|a, b| crate::order::code_unit(a, b));
    let unlisted = read(&root.to_string_lossy(), &layers, Some(&paths), None, crate::resolve::Tsconfig::Auto, false, HashSet::new);
    let files = Arc::new(paths.iter().cloned().zip(0..).collect());
    let mut carried = None;
    for regular in [false, true] {
        let listing = crate::emitted::Listing::of(Arc::clone(&files), Arc::new(vec![regular; paths.len()]), &[]);
        let listed = read(&root.to_string_lossy(), &layers, Some(&paths), Some(Arc::new(listing)), crate::resolve::Tsconfig::Auto, true, HashSet::new);
        assert_eq!((&listed.shipped, &listed.catalogued, &listed.undeclared), (&unlisted.shipped, &unlisted.catalogued, &unlisted.undeclared));
        carried = Some(listed);
    }
    (Fixture(root), carried.unwrap())
}

/// A package's closure lines and files, whether its manifest offered nothing,
/// and the files of it read as shipped.
fn package(read: &Read, name: &str) -> (u64, u32, bool, Vec<String>) {
    let at = read.packages.iter().position(|package| package.name == name).unwrap();
    let directory = format!("{}/", read.packages[at].directory);
    let shipped = read.shipped.iter().filter(|file| file.starts_with(&directory)).cloned().collect();
    (read.closures[at].lines, read.closures[at].files, read.undeclared[at], shipped)
}

#[test]
fn a_file_its_manifest_offers_is_shipped_though_its_own_test_imports_it() {
    let (_root, read) = folded("offered");
    assert_eq!(package(&read, "@t/built"), (1, 1, false, vec!["packages/built/src/index.ts".to_owned()]));
}

#[test]
fn a_manifest_that_offers_nothing_starts_at_the_files_nothing_of_its_own_ships_imports_and_says_so() {
    let (_root, read) = folded("undeclared");
    // Its own test importing the file is the file under test, not a reason it is no entry.
    assert_eq!(package(&read, "@t/bare"), (1, 1, true, vec!["packages/bare/src/index.ts".to_owned()]));
}

#[test]
fn a_package_named_storybook_ships_and_its_own_storybook_directory_does_not() {
    let (_root, read) = folded("storybook");
    // A file its manifest offers as a `bin` ships whatever its name says.
    let shipped = ["packages/storybook/src/index.test.ts", "packages/storybook/src/index.ts"];
    assert_eq!(package(&read, "@t/storybook"), (2, 2, false, shipped.map(str::to_owned).to_vec()));
}

#[test]
fn a_file_its_manifest_offers_ships_with_what_it_loads_though_a_runner_is_named_on_both() {
    let (_root, read) = folded("runner");
    let shipped = ["packages/runner/src/jest-environment.ts", "packages/runner/src/jest.ts"];
    assert_eq!(package(&read, "@t/runner"), (2, 2, false, shipped.map(str::to_owned).to_vec()));
}

#[test]
fn a_package_inside_a_tests_fixtures_ships_nothing_its_manifest_offers() {
    let (_root, read) = folded("fixture");
    assert_eq!(package(&read, "@t/fixture"), (0, 0, true, Vec::new()));
}

#[test]
fn a_subpath_pattern_offers_every_file_a_substitution_reaches() {
    let (_root, read) = folded("patterned");
    let shipped = ["packages/patterned/src/Foo/helper.ts", "packages/patterned/src/Foo/index.ts", "packages/patterned/src/orphan.ts"];
    // The closure starts at the one index and loads its helper; the file nothing loads is left out of it.
    assert_eq!(package(&read, "@t/patterned"), (2, 2, false, shipped.map(str::to_owned).to_vec()));
    assert_eq!(package(&read, "@t/emitted"), (1, 1, false, vec!["packages/emitted/src/a/b.ts".to_owned()]));
}

#[test]
fn the_complete_listing_preserves_uncounted_winners_and_excludes_unlisted_sources() {
    let root = std::env::temp_dir().join(format!("sense-entry-snapshot-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("src")).unwrap();
    let fixture = Fixture(root);
    for (path, text) in [("package.json", "{}"), ("src/choice.ts", "export {};"), ("src/choice.tsx", "export {};")] {
        std::fs::write(fixture.0.join(path), text).unwrap();
    }
    let package = crate::package_owners::Package {
        directory: String::new(), name: "snapshot".to_owned(), depends: Vec::new(), develops: Vec::new(), offers: vec!["./src/choice.js".to_owned()],
    };
    let counted = std::collections::HashMap::from([("src/choice.tsx", 0)]);
    let entries = |paths: &[&str]| {
        let files = Arc::new(paths.iter().map(|path| (*path).to_owned()).zip(0..).collect());
        let listing = crate::emitted::Listing::of(files, Arc::new(vec![true; paths.len()]), &[]);
        super::declared(&fixture.0.to_string_lossy(), &[&package], &counted, &[0], Some(Arc::new(listing)), crate::resolve::Tsconfig::Off, true)
    };
    assert_eq!(entries(&["package.json", "src/choice.ts", "src/choice.tsx"]), vec![Vec::<usize>::new()], "an uncounted higher-precedence target still wins");
    assert_eq!(entries(&["package.json", "src/choice.tsx"]), vec![vec![0]], "an unlisted ordinary source does not shadow the snapshot");
}

#[test]
fn source_snapshot_resolution_keeps_root_dirs_without_a_physical_output_directory() {
    let root = std::env::temp_dir().join(format!("sense-entry-root-dirs-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("src")).unwrap();
    let fixture = Fixture(root);
    for (path, text) in [("package.json", "{}"), ("tsconfig.json", r#"{"compilerOptions":{"rootDirs":["./virtual","./src"]}}"#), ("src/a.ts", "export {};")] {
        std::fs::write(fixture.0.join(path), text).unwrap();
    }
    let package = crate::package_owners::Package {
        directory: String::new(), name: "virtual".to_owned(), depends: Vec::new(), develops: Vec::new(), offers: vec!["./virtual/a.ts".to_owned()],
    };
    let paths = ["package.json", "tsconfig.json", "src/a.ts"];
    let files = Arc::new(paths.into_iter().map(str::to_owned).zip(0..).collect());
    let listing = crate::emitted::Listing::of(files, Arc::new(vec![true; paths.len()]), &[]);
    let counted = std::collections::HashMap::from([("src/a.ts", 0)]);
    let tsconfig = crate::resolve::Tsconfig::Named(std::fs::canonicalize(fixture.0.join("tsconfig.json")).unwrap());
    assert_eq!(super::declared(&fixture.0.to_string_lossy(), &[&package], &counted, &[0], None, tsconfig.clone(), false), vec![vec![0]], "the open resolver already supports this rootDirs mapping");
    assert_eq!(super::declared(&fixture.0.to_string_lossy(), &[&package], &counted, &[0], Some(Arc::new(listing)), tsconfig, true), vec![vec![0]]);
}

#[test]
fn a_symbolic_directory_export_reaches_its_listed_source() {
    let root = std::env::temp_dir().join(format!("sense-entry-symbolic-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("src/foo")).unwrap();
    std::fs::create_dir_all(root.join("routes")).unwrap();
    let fixture = Fixture(root);
    std::fs::write(fixture.0.join("package.json"), "{}").unwrap();
    std::fs::write(fixture.0.join("src/foo/index.js"), "export {};").unwrap();
    std::os::unix::fs::symlink("../src/foo", fixture.0.join("routes/foo")).unwrap();
    let package = crate::package_owners::Package {
        directory: String::new(), name: "symbolic".to_owned(), depends: Vec::new(), develops: Vec::new(), offers: vec!["./routes/*/index.js".to_owned()],
    };
    let paths = ["package.json", "src/foo/index.js", "routes/foo"];
    let files = Arc::new(paths.into_iter().map(str::to_owned).zip(0..).collect());
    let listing = crate::emitted::Listing::of(files, Arc::new(vec![true, true, false]), &[]);
    let counted = std::collections::HashMap::from([("src/foo/index.js", 0)]);
    assert_eq!(super::declared(&fixture.0.to_string_lossy(), &[&package], &counted, &[0], Some(Arc::new(listing)), crate::resolve::Tsconfig::Off, true), vec![vec![0]]);
}

#[test]
fn wildcard_requests_capture_the_known_path_without_inventing_prefixes() {
    let root = std::env::temp_dir().join(format!("sense-entry-requests-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("src/assets")).unwrap();
    let fixture = Fixture(std::fs::canonicalize(root).unwrap());
    std::fs::write(fixture.0.join("package.json"), "{}").unwrap();
    let source = fixture.0.join("src/assets/background.ts");
    std::fs::write(&source, "export {};").unwrap();
    let resolvers = crate::resolve::Resolvers::new(crate::resolve::Tsconfig::Off, None);
    let requests = resolvers.offered_requests(&fixture.0.join("package.json"), &[source], &["./src/assets/*".to_owned()]);
    assert_eq!(requests, vec!["./src/assets/background.ts"], "the full literal prefix is matched before a wildcard is captured");
    assert_eq!(resolvers.offered_requests(&fixture.0.join("package.json"), &[fixture.0.join("src/assets/background.ts")], &["./src/*/background".to_owned()]), vec!["./src/assets/background"]);
    std::fs::write(fixture.0.join("tsconfig.json"), r#"{"compilerOptions":{"outDir":"./dist","rootDir":"./src"}}"#).unwrap();
    let emitted = crate::resolve::Resolvers::new(crate::resolve::Tsconfig::Off, None);
    assert_eq!(emitted.offered_requests(&fixture.0.join("package.json"), &[fixture.0.join("src/assets/background.ts")], &["./dist/*.js".to_owned()]), vec!["./dist/assets/background.js"]);
}
