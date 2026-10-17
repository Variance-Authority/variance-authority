//! Which imports `third_party_importers` reads as imports of a name out of an
//! installed package, over records written the way the scan writes them: a
//! binding, an `export … from`, an import of another name, a request that
//! resolved to a file, and a file whose imports did not read.

use std::path::PathBuf;

use super::third_party_importers;
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
    let digest = format!("git:{:04x}", path.bytes().map(u32::from).sum::<u32>());
    let packages: Vec<String> = packages.iter().map(|package| format!(r#"{{"to": "{package}", "kind": "imports"}}"#)).collect();
    let targets: Vec<String> = targets.iter().map(|target| target.map_or("null".to_owned(), |to| format!("\"{to}\""))).collect();
    let unknown = unknown.map_or(String::new(), |why| format!(r#", "unknown": "{why}""#));
    let record = format!(
        r#"["{path}", {{"record": {{"file": "{path}", "digest": "{digest}", "packages": [{}]{unknown}}}, "witnesses": [], "targets": [{}]}}]"#,
        packages.join(", "),
        targets.join(", "),
    );
    let parse = format!(r#"["{digest}\u0000.ts\u0000+", {{"requests": [{}], "exports": []}}]"#, requests.join(", "));
    (record, parse)
}

/// A request binding `imported` on `line`; an `export … from` when `republishes`.
fn request(value: &str, kind: &str, line: u32, imported: &str, republishes: bool) -> String {
    format!(
        r#"{{"value": "{value}", "kind": "{kind}", "line": {line}, "bindings": [{{"imported": "{imported}", "local": "{imported}", "type": false, "line": {line}}}], "republishes": {republishes}}}"#,
    )
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

    let read = third_party_importers(root.0.to_str().unwrap(), std::slice::from_ref(&layer), "parseSync");

    let uses: Vec<(&str, u32, &str, bool)> = read.uses.iter().map(|one| (one.site.at.as_str(), one.site.line, one.package.as_str(), one.passes_on)).collect();
    assert_eq!(uses, [("src/a.ts", 1, "thirdp", false), ("src/b.ts", 2, "thirdp", true)], "a resolved request, and an import of another name, are not imports of this one");
    assert_eq!(read.unread, ["src/e.ts"], "a file whose imports did not read is named, not passed over");
}

#[test]
fn a_package_of_the_workspace_is_no_outside_package() {
    let root = fixture("internal");
    let bytes = layer(&[file("src/a.ts", &["@t/w"], &[None], None, &[request("@t/w", "imports", 1, "parseSync", false)])]);
    let layer = Layer::open(&bytes).unwrap();

    let read = third_party_importers(root.0.to_str().unwrap(), std::slice::from_ref(&layer), "parseSync");

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

    let read = third_party_importers(root.0.to_str().unwrap(), std::slice::from_ref(&layer), "parseSync");

    assert_eq!(read.unread, ["src/a.ts"], "b.ts names only the workspace's own package, so nothing it imports is outside");
    let by: Vec<(&str, &str)> = read.uses.iter().map(|one| (one.site.at.as_str(), one.site.by.as_str())).collect();
    assert_eq!(by, [("src/c.ts", "@t/w")], "a use names the workspace package that imports it");
}
