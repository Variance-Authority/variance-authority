//! The walk `importers` takes through `export … from`, over a chain written the
//! way the scan writes one: a barrel two re-exports deep, a type-only
//! re-export in each of its three spellings, a namespace re-export, and two
//! files that re-export each other.

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

/// A request and its bindings, each `(imported, type, line)`. Every
/// `reexports` request is an `export … from`; a `type` one is an `import type`.
fn request(value: &str, kind: &str, line: u32, bindings: &[(&str, bool, u32)]) -> String {
    held(value, kind, line, bindings, kind == "reexports")
}

/// `export type { … } from`: a request of kind `type` that republishes.
fn republished_types(value: &str, line: u32, bindings: &[(&str, bool, u32)]) -> String {
    held(value, "type", line, bindings, true)
}

fn held(value: &str, kind: &str, line: u32, bindings: &[(&str, bool, u32)], republishes: bool) -> String {
    let bindings: Vec<String> = bindings
        .iter()
        .map(|(name, typed, at)| format!(r#"{{"imported": "{name}", "local": "{name}", "type": {typed}, "line": {at}}}"#))
        .collect();
    format!(r#"{{"value": "{value}", "kind": "{kind}", "line": {line}, "bindings": [{}], "republishes": {republishes}}}"#, bindings.join(", "))
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
fn passes_an_inline_type_re_export_on_as_a_type_and_a_namespace_on_only_as_its_members() {
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

    // Whatever the importer wrote, a name that came through a type-only hop is a type.
    assert_eq!(uses(&read), ["src/typeuse.ts:1 greet via ./typed type"]);
    // `ns.ts` passes `greet` on as `ns.greet`, so a binding of `greet` out of it is no use.
    assert_eq!(read.through, ["src/ns.ts", "src/typed.ts"]);
}

#[test]
fn passes_on_what_export_type_re_exports_and_keeps_an_import_type_of_the_same_file_a_use() {
    let root = fixture("export-type");
    let bytes = chain(&[
        file("src/greet.ts", &[], &[], &[]),
        // `import type { greet } from './greet'; export type { greet as Greet } from './greet'`
        file(
            "src/types.ts",
            &["src/greet.ts", "src/greet.ts"],
            &[request("./greet", "type", 1, &[("greet", true, 1)]), republished_types("./greet", 2, &[("greet", true, 2)])],
            &[passes("greet", Some("Greet"), "./greet", true)],
        ),
        // `export type * from './types'`
        file("src/all.ts", &["src/types.ts"], &[republished_types("./types", 1, &[])], &[passes("*", None, "./types", true)]),
        file("src/typeuse.ts", &["src/all.ts"], &[request("./all", "imports", 3, &[("Greet", false, 3)])], &[]),
    ]);

    let read = read(&root.0, &bytes, &["src/greet.ts"], "greet");

    assert_eq!(uses(&read), ["src/types.ts:1 greet via ./greet type", "src/typeuse.ts:3 Greet via ./all type"]);
    assert_eq!(read.through, ["src/all.ts", "src/types.ts"]);
}

#[test]
fn a_name_a_type_only_path_reached_first_is_a_value_once_a_longer_value_path_reaches_it() {
    let root = fixture("diamond");
    let bytes = chain(&[
        file("src/greet.ts", &[], &[], &[]),
        // `export { type greet } from './greet'`
        file("src/typed.ts", &["src/greet.ts"], &[request("./greet", "reexports", 1, &[("greet", true, 1)])], &[passes("greet", Some("greet"), "./greet", true)]),
        // `export { greet } from './greet'`
        file("src/value.ts", &["src/greet.ts"], &[request("./greet", "reexports", 1, &[("greet", false, 1)])], &[passes("greet", Some("greet"), "./greet", false)]),
        // `export * from './value'`: one hop more, so the value path reaches the barrel a step later.
        file("src/hop.ts", &["src/value.ts"], &[request("./value", "reexports", 1, &[])], &[passes("*", None, "./value", false)]),
        // `export * from './typed'; export * from './hop'`
        file(
            "src/barrel.ts",
            &["src/typed.ts", "src/hop.ts"],
            &[request("./typed", "reexports", 1, &[]), request("./hop", "reexports", 2, &[])],
            &[passes("*", None, "./typed", false), passes("*", None, "./hop", false)],
        ),
        file("src/use.ts", &["src/barrel.ts"], &[request("./barrel", "imports", 1, &[("greet", false, 1)])], &[]),
    ]);

    let read = read(&root.0, &bytes, &["src/greet.ts"], "greet");

    assert_eq!(uses(&read), ["src/use.ts:1 greet via ./barrel"]);
    assert_eq!(read.through, ["src/barrel.ts", "src/hop.ts", "src/typed.ts", "src/value.ts"]);
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

#[test]
fn orders_two_bindings_of_one_name_on_one_line_by_what_they_bind_it_to() {
    let root = fixture("two-locals");
    // `import { greet as quiet, greet as loud } from './greet'`
    let both = r#"{"value": "./greet", "kind": "imports", "line": 1, "bindings": [{"imported": "greet", "local": "quiet", "type": false, "line": 1}, {"imported": "greet", "local": "loud", "type": false, "line": 1}]}"#;
    let bytes = chain(&[file("src/greet.ts", &[], &[], &[]), file("src/both.ts", &["src/greet.ts"], &[both.to_owned()], &[])]);

    let read = read(&root.0, &bytes, &["src/greet.ts"], "greet");

    let locals: Vec<Option<&str>> = read.uses.iter().map(|one| one.local.as_deref()).collect();
    assert_eq!(locals, [Some("loud"), Some("quiet")]);
}
