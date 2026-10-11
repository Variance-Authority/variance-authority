//! The walk `importers` takes through `export … from`, over a chain written the
//! way the scan writes one: a barrel two re-exports deep, a type-only
//! re-export, a namespace re-export, and two files that re-export each other.

use std::path::PathBuf;

use super::{importers, Importers};
use crate::compact::Layer;
use crate::generation::Delta;
use crate::graph_index::merged;

struct Fixture(PathBuf);

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn fixture(name: &str) -> Fixture {
    let root = std::env::temp_dir().join(format!("sense-help-usage-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("package.json"), r#"{"name": "@t/w"}"#).unwrap();
    Fixture(root)
}

/// One file: its record, resolving each of its requests to `targets` in order, and its parse.
fn file(path: &str, targets: &[&str], requests: &[String], exports: &[String]) -> (String, String) {
    let digest = format!("git:{:04x}", path.bytes().map(u32::from).sum::<u32>());
    let targets: Vec<String> = targets.iter().map(|target| format!("\"{target}\"")).collect();
    let record = format!(
        r#"["{path}", {{"record": {{"file": "{path}", "digest": "{digest}"}}, "witnesses": [], "targets": [{}]}}]"#,
        targets.join(", "),
    );
    let parse = format!(r#"["{digest}\u0000.ts\u0000+", {{"requests": [{}], "exports": [{}]}}]"#, requests.join(", "), exports.join(", "));
    (record, parse)
}

/// A request and its bindings, each `(imported, type, line)`.
fn request(value: &str, kind: &str, line: u32, bindings: &[(&str, bool, u32)]) -> String {
    let bindings: Vec<String> = bindings
        .iter()
        .map(|(name, typed, at)| format!(r#"{{"imported": "{name}", "local": "{name}", "type": {typed}, "line": {at}}}"#))
        .collect();
    format!(r#"{{"value": "{value}", "kind": "{kind}", "line": {line}, "bindings": [{}]}}"#, bindings.join(", "))
}

/// `export { imported as exported } from 'from'`; `export *` when `imported` is `*` and `exported` is `None`.
fn passes(imported: &str, exported: Option<&str>, from: &str, typed: bool) -> String {
    let exported = exported.map_or(String::new(), |name| format!(r#""exported": "{name}", "#));
    format!(r#"{{{exported}"imported": "{imported}", "from": "{from}", "type": {typed}, "line": 1}}"#)
}

fn chain(files: &[(String, String)]) -> Vec<u8> {
    let records: Vec<&str> = files.iter().map(|(record, _)| record.as_str()).collect();
    let parses: Vec<&str> = files.iter().map(|(_, parse)| parse.as_str()).collect();
    let document = format!(
        r#"{{"records": [{}], "parses": [{}], "deletedRecords": [], "deletedParses": []}}"#,
        records.join(", "),
        parses.join(", "),
    );
    merged(&[], &Delta::of(vec![document]).unwrap())
}

fn read(root: &PathBuf, bytes: &[u8], files: &[&str], name: &str) -> Importers {
    let layer = Layer::open(bytes).unwrap();
    let files: Vec<String> = files.iter().map(|file| (*file).to_owned()).collect();
    importers(root.to_str().unwrap(), std::slice::from_ref(&layer), &files, name)
}

fn uses(read: &Importers) -> Vec<String> {
    read.uses.iter().map(|one| format!("{}:{} {} via {}{}", one.at, one.line, one.name, one.key, if one.r#type { " type" } else { "" })).collect()
}

#[test]
fn follows_a_barrel_two_re_exports_deep_and_lists_its_imports_by_file_then_line() {
    let root = fixture("barrel");
    let bytes = chain(&[
        file("src/greet.ts", &[], &[], &[]),
        // `export { greet } from './greet'`
        file("src/a.ts", &["src/greet.ts"], &[request("./greet", "reexports", 1, &[("greet", false, 1)])], &[passes("greet", Some("greet"), "./greet", false)]),
        // `export * from './a'`
        file("src/b.ts", &["src/a.ts"], &[request("./a", "reexports", 1, &[])], &[passes("*", None, "./a", false)]),
        // Written line 4 first, then line 2.
        file(
            "src/use_b.ts",
            &["src/b.ts", "src/b.ts"],
            &[request("./b", "imports", 4, &[("greet", false, 4)]), request("./b", "imports", 2, &[("greet", false, 2)])],
            &[],
        ),
        file("src/direct.ts", &["src/greet.ts"], &[request("./greet", "imports", 1, &[("greet", false, 1)])], &[]),
    ]);

    let read = read(&root.0, &bytes, &["src/greet.ts"], "greet");

    assert_eq!(uses(&read), ["src/direct.ts:1 greet via ./greet", "src/use_b.ts:2 greet via ./b", "src/use_b.ts:4 greet via ./b"]);
    assert_eq!(read.through, ["src/a.ts", "src/b.ts"]);
    assert!(read.uses.iter().all(|one| one.by == "@t/w"));
}

#[test]
fn follows_a_renamed_re_export_under_the_name_it_passes() {
    let root = fixture("renamed");
    let bytes = chain(&[
        file("src/greet.ts", &[], &[], &[]),
        // `export { greet as salute } from './greet'`
        file("src/alias.ts", &["src/greet.ts"], &[request("./greet", "reexports", 1, &[("greet", false, 1)])], &[passes("greet", Some("salute"), "./greet", false)]),
        file("src/saluted.ts", &["src/alias.ts"], &[request("./alias", "imports", 1, &[("salute", false, 1)])], &[]),
    ]);

    let read = read(&root.0, &bytes, &["src/greet.ts"], "greet");

    assert_eq!(uses(&read), ["src/saluted.ts:1 salute via ./alias"]);
    assert_eq!(read.through, ["src/alias.ts"]);
}

#[test]
fn passes_nothing_on_through_a_type_only_re_export_or_a_namespace_and_lists_the_type_where_it_is_written() {
    let root = fixture("typed");
    let bytes = chain(&[
        file("src/greet.ts", &[], &[], &[]),
        // `export { type greet, other } from './greet'`
        file(
            "src/typed.ts",
            &["src/greet.ts"],
            &[request("./greet", "reexports", 1, &[("greet", true, 1), ("other", false, 1)])],
            &[passes("greet", Some("greet"), "./greet", true), passes("other", Some("other"), "./greet", false)],
        ),
        file("src/typeuse.ts", &["src/typed.ts"], &[request("./typed", "imports", 1, &[("greet", false, 1)])], &[]),
        // `export * as ns from './greet'`
        file("src/ns.ts", &["src/greet.ts"], &[request("./greet", "reexports", 1, &[])], &[passes("*", Some("ns"), "./greet", false)]),
        file("src/nsuse.ts", &["src/ns.ts"], &[request("./ns", "imports", 1, &[("greet", false, 1)])], &[]),
    ]);

    let read = read(&root.0, &bytes, &["src/greet.ts"], "greet");

    assert_eq!(uses(&read), ["src/typed.ts:1 greet via ./greet type"]);
    assert!(read.through.is_empty());
}

#[test]
fn ends_a_cycle_of_re_exports_and_follows_each_file_once() {
    let root = fixture("cycle");
    let bytes = chain(&[
        file("src/greet.ts", &[], &[], &[]),
        // `export { greet } from './greet'; export * from './c2'`
        file(
            "src/c1.ts",
            &["src/greet.ts", "src/c2.ts"],
            &[request("./greet", "reexports", 1, &[("greet", false, 1)]), request("./c2", "reexports", 2, &[])],
            &[passes("greet", Some("greet"), "./greet", false), passes("*", None, "./c2", false)],
        ),
        // `export * from './c1'`
        file("src/c2.ts", &["src/c1.ts"], &[request("./c1", "reexports", 1, &[])], &[passes("*", None, "./c1", false)]),
        file("src/use_c2.ts", &["src/c2.ts"], &[request("./c2", "imports", 1, &[("greet", false, 1)])], &[]),
    ]);

    let read = read(&root.0, &bytes, &["src/greet.ts"], "greet");

    assert_eq!(uses(&read), ["src/use_c2.ts:1 greet via ./c2"]);
    assert_eq!(read.through, ["src/c1.ts", "src/c2.ts"]);
}
