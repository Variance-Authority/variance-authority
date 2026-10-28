//! Which imports `outside_importers` reads as imports of a name from outside
//! the workspace, over records written the way the scan writes them: a
//! binding, an `export … from`, a member read off a module held whole, an
//! import of another name, a request that resolved to a file, a module the
//! runtime owns, and a file whose imports did not read.

use std::collections::HashSet;
use std::path::PathBuf;

use super::outside_importers;
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
    let root = std::env::temp_dir().join(format!("sense-third-party-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("package.json"), r#"{"name": "@t/w"}"#).unwrap();
    Fixture(root)
}

/// One file: its record, with the packages it imports, each request's target
/// (`None` where the scan resolved it to no file), the reason its imports did
/// not read when they did not, and its parse.
fn file(path: &str, packages: &[&str], targets: &[Option<&str>], unknown: Option<&str>, requests: &[String]) -> (String, String) {
    held(path, packages, targets, unknown, requests, "", "")
}

/// [`file`], with the members read off a module the file holds whole and the
/// file's uses of its own top-level bindings, as the parse writes them.
fn held(path: &str, packages: &[&str], targets: &[Option<&str>], unknown: Option<&str>, requests: &[String], members: &str, own_uses: &str) -> (String, String) {
    let digest = format!("git:{:04x}", path.bytes().map(u32::from).sum::<u32>());
    let packages: Vec<String> = packages.iter().map(|package| format!(r#"{{"to": "{package}", "kind": "imports"}}"#)).collect();
    let targets: Vec<String> = targets.iter().map(|target| target.map_or("null".to_owned(), |to| format!("\"{to}\""))).collect();
    let unknown = unknown.map_or(String::new(), |why| format!(r#", "unknown": "{why}""#));
    let record = format!(
        r#"["{path}", {{"record": {{"file": "{path}", "digest": "{digest}", "packages": [{}]{unknown}}}, "witnesses": [], "targets": [{}]}}]"#,
        packages.join(", "),
        targets.join(", "),
    );
    let members = if members.is_empty() { String::new() } else { format!(r#", "members": [{members}]"#) };
    let own_uses = if own_uses.is_empty() { String::new() } else { format!(r#", "ownUses": [{own_uses}]"#) };
    let parse = format!(r#"["{digest}\u0000.ts\u0000+", {{"requests": [{}], "exports": []{members}{own_uses}}}]"#, requests.join(", "));
    (record, parse)
}

/// A request binding `imported` on `line`; an `export … from` when `republishes`.
fn request(value: &str, kind: &str, line: u32, imported: &str, republishes: bool) -> String {
    format!(
        r#"{{"value": "{value}", "kind": "{kind}", "line": {line}, "bindings": [{{"imported": "{imported}", "local": "{imported}", "type": false, "line": {line}}}], "republishes": {republishes}}}"#,
    )
}

/// A request that binds no name: an `import()`, or an `import * as` binding `*` to `local`.
fn whole(value: &str, kind: &str, line: u32, local: Option<&str>) -> String {
    let bindings = local.map_or(String::new(), |local| format!(r#"{{"imported": "*", "local": "{local}", "type": false, "line": {line}}}"#));
    format!(r#"{{"value": "{value}", "kind": "{kind}", "line": {line}, "bindings": [{bindings}], "republishes": false}}"#)
}

/// The runtime's modules, as the scan hands them over: each with and without its scheme.
fn builtins() -> HashSet<String> {
    ["path", "node:path", "fs/promises", "node:fs/promises", "node:test"].into_iter().map(str::to_owned).collect()
}

fn layer(files: &[(String, String)]) -> Vec<u8> {
    let records: Vec<&str> = files.iter().map(|(record, _)| record.as_str()).collect();
    let parses: Vec<&str> = files.iter().map(|(_, parse)| parse.as_str()).collect();
    let document = format!(
        r#"{{"records": [{}], "parses": [{}], "deletedRecords": [], "deletedParses": []}}"#,
        records.join(", "),
        parses.join(", "),
    );
    merged(&[], &Delta::of(vec![document]).unwrap())
}

#[test]
fn reads_each_unresolved_request_of_an_outside_package_that_binds_the_name() {
    let root = fixture("binds");
    let bytes = layer(&[
        file("src/a.ts", &["thirdp"], &[None], None, &[request("thirdp", "imports", 1, "parseSync", false)]),
        file("src/b.ts", &["thirdp"], &[None], None, &[request("thirdp", "reexports", 2, "parseSync", true)]),
        file("src/c.ts", &["thirdp"], &[None], None, &[request("thirdp", "imports", 1, "render", false)]),
        file("src/d.ts", &[], &[Some("src/local.ts")], None, &[request("./local", "imports", 1, "parseSync", false)]),
        file("src/e.ts", &["thirdp"], &[None], Some("src/e.ts — import(x)"), &[request("thirdp", "imports", 1, "parseSync", false)]),
        file("src/local.ts", &[], &[], None, &[]),
    ]);
    let layer = Layer::open(&bytes).unwrap();

    let read = outside_importers(root.0.to_str().unwrap(), std::slice::from_ref(&layer), "parseSync", &builtins());

    let uses: Vec<(&str, u32, &str, bool)> = read.uses.iter().map(|one| (one.site.at.as_str(), one.site.line, one.package.as_str(), one.passes_on)).collect();
    assert_eq!(uses, [("src/a.ts", 1, "thirdp", false), ("src/b.ts", 2, "thirdp", true)], "a resolved request, and an import of another name, are not imports of this one");
    assert_eq!(read.unread, ["src/e.ts"], "a file whose imports did not read is named, not passed over");
}

#[test]
fn a_package_of_the_workspace_is_no_outside_package() {
    let root = fixture("internal");
    let bytes = layer(&[file("src/a.ts", &["@t/w"], &[None], None, &[request("@t/w", "imports", 1, "parseSync", false)])]);
    let layer = Layer::open(&bytes).unwrap();

    let read = outside_importers(root.0.to_str().unwrap(), std::slice::from_ref(&layer), "parseSync", &builtins());

    assert!(read.uses.is_empty(), "the workspace's own package declares the name in the checkout");
    assert!(read.unread.is_empty());
}

#[test]
fn a_record_its_parse_does_not_line_up_with_is_unread_only_when_it_names_an_outside_package() {
    let root = fixture("unaligned");
    let bytes = layer(&[
        file("src/a.ts", &["thirdp"], &[], None, &[request("thirdp", "imports", 1, "parseSync", false)]),
        file("src/b.ts", &["@t/w"], &[], None, &[request("@t/w", "imports", 1, "parseSync", false)]),
        file("src/c.ts", &["thirdp"], &[None], None, &[request("thirdp", "imports", 3, "parseSync", false)]),
    ]);
    let layer = Layer::open(&bytes).unwrap();

    let read = outside_importers(root.0.to_str().unwrap(), std::slice::from_ref(&layer), "parseSync", &builtins());

    assert_eq!(read.unread, ["src/a.ts"], "b.ts names only the workspace's own package, so nothing it imports is outside");
    let by: Vec<(&str, &str)> = read.uses.iter().map(|one| (one.site.at.as_str(), one.site.by.as_str())).collect();
    assert_eq!(by, [("src/c.ts", "@t/w")], "a use names the workspace package that imports it");
}

#[test]
fn reads_a_member_off_a_module_held_whole_by_an_import_star_or_an_import_call() {
    let root = fixture("members");
    let bytes = layer(&[
        held("src/a.ts", &["thirdp"], &[None], None, &[whole("thirdp", "imports", 1, Some("tp"))], r#"{"request": 0, "name": "parseSync", "line": 4}"#, ""),
        held("src/b.ts", &["thirdp"], &[None], None, &[whole("thirdp", "dynamic", 2, None)], r#"{"request": 0, "name": "parseSync", "line": 3}, {"request": 0, "name": "render", "line": 5}"#, ""),
    ]);
    let layer = Layer::open(&bytes).unwrap();

    let read = outside_importers(root.0.to_str().unwrap(), std::slice::from_ref(&layer), "parseSync", &builtins());

    let uses: Vec<(&str, u32, Option<&str>, u32)> = read.uses.iter().map(|one| (one.site.at.as_str(), one.site.line, one.site.through.as_deref(), one.site.through_line)).collect();
    assert_eq!(uses, [("src/a.ts", 4, Some("namespace"), 1), ("src/b.ts", 3, Some("dynamic"), 2)], "each read of the name is a use on its own line, marked by how the module is held");
}

#[test]
fn reads_an_import_of_a_module_the_runtime_owns_with_or_without_its_scheme() {
    let root = fixture("runtime");
    let bytes = layer(&[
        file("src/a.ts", &[], &[None], None, &[request("node:path", "imports", 1, "resolve", false)]),
        file("src/b.ts", &[], &[None], None, &[request("path", "imports", 2, "resolve", false)]),
        file("src/c.ts", &[], &[Some("src/path.ts")], None, &[request("path", "imports", 1, "resolve", false)]),
        file("src/d.ts", &[], &[], None, &[request("node:fs/promises", "imports", 1, "resolve", false)]),
        file("src/e.ts", &[], &[None], None, &[request("node:test", "imports", 1, "describe", false)]),
        file("src/path.ts", &[], &[], None, &[]),
    ]);
    let layer = Layer::open(&bytes).unwrap();

    let read = outside_importers(root.0.to_str().unwrap(), std::slice::from_ref(&layer), "resolve", &builtins());

    let uses: Vec<(&str, &str, bool, &str)> = read.uses.iter().map(|one| (one.site.at.as_str(), one.package.as_str(), one.runtime, one.site.by.as_str())).collect();
    assert_eq!(
        uses,
        [("src/a.ts", "node:path", true, "@t/w"), ("src/b.ts", "node:path", true, "@t/w"), ("src/d.ts", "node:fs/promises", true, "@t/w")],
        "a request the scan resolved to a file is that file's; one whose targets do not line up is counted, never passed over",
    );
    assert!(read.unread.is_empty(), "a module the runtime owns is told by its specifier, so no record is unread for it");
}

#[test]
fn reads_an_import_of_a_module_the_runtime_owns_in_a_file_whose_other_imports_did_not_read() {
    let root = fixture("runtime-unknown");
    let bytes = layer(&[file(
        "src/a.ts",
        &[],
        &[None, None],
        Some("src/a.ts — import(x)"),
        &[request("node:path", "imports", 1, "resolve", false), whole("x", "dynamic", 2, None)],
    )]);
    let layer = Layer::open(&bytes).unwrap();

    let read = outside_importers(root.0.to_str().unwrap(), std::slice::from_ref(&layer), "resolve", &builtins());

    let uses: Vec<(&str, &str)> = read.uses.iter().map(|one| (one.site.at.as_str(), one.package.as_str())).collect();
    assert_eq!(uses, [("src/a.ts", "node:path")]);
    assert_eq!(read.unread, ["src/a.ts"], "the import that did not read may still import the name");
}

#[test]
fn a_name_passed_on_binds_nothing_so_the_files_own_uses_of_that_name_are_not_its() {
    let root = fixture("passes-on");
    let own = r#"{"name": "resolve", "line": 7}, {"name": "parseSync", "line": 9}"#;
    let bytes = layer(&[
        held("src/a.ts", &[], &[None], None, &[request("node:path", "reexports", 1, "resolve", true)], "", own),
        held("src/b.ts", &[], &[None], None, &[request("node:path", "imports", 1, "resolve", false)], "", own),
        held("src/c.ts", &["thirdp"], &[None], None, &[request("thirdp", "reexports", 1, "parseSync", true)], "", own),
    ]);
    let layer = Layer::open(&bytes).unwrap();
    let root = root.0.to_str().unwrap();

    let resolve = outside_importers(root, std::slice::from_ref(&layer), "resolve", &builtins());
    let parse_sync = outside_importers(root, std::slice::from_ref(&layer), "parseSync", &builtins());

    let lines: Vec<(&str, bool, Option<Vec<u32>>)> = resolve.uses.iter().chain(&parse_sync.uses).map(|one| (one.site.at.as_str(), one.passes_on, one.site.lines.clone())).collect();
    assert_eq!(
        lines,
        [("src/a.ts", true, None), ("src/b.ts", false, Some(vec![7])), ("src/c.ts", true, None)],
        "a.ts and c.ts declare their own `resolve` and `parseSync`; an `export … from` binds no local, so those lines are not the import's",
    );
}
