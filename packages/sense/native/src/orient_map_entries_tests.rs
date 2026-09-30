//! Where a package's shipped code starts, read from a checkout of four
//! packages whose every source file a test of their own also imports.

use std::collections::HashSet;
use std::path::PathBuf;

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
        parses.push(format!(r#"["{digest}\u0000.ts\u0000+", {{"requests": [{}], "size": {{"bytes": 30, "lines": 1}}}}]"#, requests.join(", ")));
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
    let read = read(&root.to_string_lossy(), &layers, Some(&paths), HashSet::new);
    (Fixture(root), read)
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
    // A test its manifest offers as a `bin` is still a test.
    assert_eq!(package(&read, "@t/storybook"), (1, 1, false, vec!["packages/storybook/src/index.ts".to_owned()]));
}

#[test]
fn a_subpath_pattern_offers_every_file_a_substitution_reaches() {
    let (_root, read) = folded("patterned");
    let shipped = ["packages/patterned/src/Foo/helper.ts", "packages/patterned/src/Foo/index.ts", "packages/patterned/src/orphan.ts"];
    // The closure starts at the one index and loads its helper; the file nothing loads is left out of it.
    assert_eq!(package(&read, "@t/patterned"), (2, 2, false, shipped.map(str::to_owned).to_vec()));
    assert_eq!(package(&read, "@t/emitted"), (1, 1, false, vec!["packages/emitted/src/a/b.ts".to_owned()]));
}
