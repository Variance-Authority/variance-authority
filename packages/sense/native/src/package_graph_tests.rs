//! The package graph read back from a chain published the way the scan
//! publishes one: two segments under one manifest, the second replacing a
//! record, deleting another and dropping a parse, so the answer is the fold's
//! and not the first segment's. One record has no parse at all, so its names
//! are unread and in no total.

use std::path::PathBuf;

use super::{orientation, Limits, Listed, OrientFlows};
use crate::generation::Delta;
use crate::git::Oid;
use crate::graph_index::merged;
use crate::index_chain::read_chain;

const PATHS: [&str; 12] = [
    "package.json",
    "packages/a/package.json",
    "packages/a/src/index.ts",
    "packages/a/src/util.ts",
    "packages/b/package.json",
    "packages/b/src/local.ts",
    "packages/b/src/main.ts",
    "packages/c/package.json",
    "packages/c/src/c.ts",
    "tools/run.ts",
    "tools/unnamed/package.json",
    "packages/c/src/lost.ts",
];

fn oid(path: &str) -> Oid {
    [PATHS.iter().position(|listed| *listed == path).unwrap() as u8 + 1; 20]
}

fn git(path: &str) -> String {
    crate::git::spell(&oid(path))
}

fn record(file: &str, digest: &str, targets: &[&str]) -> String {
    let targets: Vec<String> = targets.iter().map(|target| format!("\"{target}\"")).collect();
    format!(r#"["{file}", {{"record": {{"file": "{file}", "digest": "{digest}"}}, "witnesses": [], "targets": [{}]}}]"#, targets.join(", "))
}

fn parse(digest: &str, body: &str) -> String {
    format!(r#"["{digest}\u0000.ts\u0000+", {body}]"#)
}

fn request(value: &str, kind: &str, imported: &[&str]) -> String {
    let bindings: Vec<String> = imported
        .iter()
        .map(|name| format!(r#"{{"imported": "{name}", "local": "{name}", "type": false, "line": 1}}"#))
        .collect();
    format!(r#"{{"value": "{value}", "kind": "{kind}", "line": 1, "bindings": [{}]}}"#, bindings.join(", "))
}

fn layer(records: &[String], parses: &[String], deleted_records: &[&str], deleted_parses: &[String]) -> Vec<u8> {
    let quoted = |values: &[String]| values.iter().map(|value| format!("\"{value}\"")).collect::<Vec<_>>().join(", ");
    let deleted_records: Vec<String> = deleted_records.iter().map(|file| (*file).to_owned()).collect();
    let document = format!(
        r#"{{"records": [{}], "parses": [{}], "deletedRecords": [{}], "deletedParses": [{}]}}"#,
        records.join(", "),
        parses.join(", "),
        quoted(&deleted_records),
        quoted(deleted_parses),
    );
    merged(&[], &Delta::of(vec![document]).unwrap())
}

struct Fixture(PathBuf);

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn fixture(name: &str) -> Fixture {
    let root = std::env::temp_dir().join(format!("sense-package-graph-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    for (path, text) in [
        ("package.json", r#"{"private": true}"#),
        ("packages/a/package.json", r#"{"name": "@t/a"}"#),
        ("packages/b/package.json", r#"{"name": "@t/b"}"#),
        ("packages/c/package.json", r#"{"name": "@t/c"}"#),
        ("tools/unnamed/package.json", r#"{"name": 7}"#),
    ] {
        let file = root.join(path);
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(file, text).unwrap();
    }
    Fixture(root)
}

/// Two segments: the first as a cold build left it, the second a warm update.
fn publish(index: &str) {
    let (main, c_old, c_new, index_ts, run) = (git("packages/b/src/main.ts"), "git:0c0c", git("packages/c/src/c.ts"), git("packages/a/src/index.ts"), git("tools/run.ts"));
    let first = layer(
        &[
            record("packages/a/src/index.ts", &index_ts, &["packages/b/src/local.ts"]),
            record("packages/a/src/util.ts", &git("packages/a/src/util.ts"), &[]),
            record("packages/a/src/gone.ts", "git:0d0d", &["packages/b/src/main.ts"]),
            record("packages/b/src/local.ts", "git:ffff", &[]),
            record("packages/b/src/main.ts", &main, &["packages/a/src/index.ts", "packages/a/src/util.ts", "packages/b/src/local.ts"]),
            record("packages/c/src/c.ts", c_old, &["packages/a/src/index.ts"]),
            record("tools/run.ts", &run, &["packages/b/src/main.ts"]),
            record("packages/c/src/lost.ts", &git("packages/c/src/lost.ts"), &["packages/a/src/index.ts"]),
        ],
        &[
            parse(&index_ts, &format!(r#"{{"requests": [{}]}}"#, request("@t/b/local", "imports", &["helper"]))),
            parse("git:0d0d", &format!(r#"{{"requests": [{}]}}"#, request("@t/b", "imports", &["never"]))),
            parse(&main, &format!(
                r#"{{"requests": [{}, {}, {}], "members": [{{"request": 1, "name": "format", "line": 4}}]}}"#,
                request("@t/a", "imports", &["x", "y"]),
                request("@t/a/util", "imports", &["*"]),
                request("./local", "imports", &["local"]),
            )),
            parse(c_old, &format!(r#"{{"requests": [{}]}}"#, request("@t/a", "imports", &["z"]))),
            parse(&run, &format!(r#"{{"requests": [{}]}}"#, request("@t/b", "imports", &[]))),
        ],
        &[],
        &[],
    );
    let second = layer(
        &[
            record("packages/c/src/c.ts", &c_new, &["packages/a/src/index.ts", "packages/a/src/index.ts"]),
            record("packages/a/src/removed.ts", "git:0e0e", &[]),
        ],
        &[parse(&c_new, &format!(
            r#"{{"requests": [{}, {}], "exports": [{{"exported": "y", "imported": "y", "from": "@t/a", "type": false, "line": 2}}]}}"#,
            request("@t/a", "imports", &["x"]),
            request("@t/a", "reexports", &["y"]),
        ))],
        &["packages/a/src/gone.ts"],
        &[format!("{c_old}\\u0000.ts\\u0000+")],
    );
    crate::log::publish(index, &[], &[&first, &second], &[]).unwrap();
}

fn rows(flows: &OrientFlows) -> String {
    let mut lines: Vec<String> = flows
        .rows
        .iter()
        .map(|row| {
            let names: Vec<String> = row.names.iter().map(|name| format!("{} {:.2}", name.name, name.share)).collect();
            let more = if row.more_names > 0 { format!(" +{}", row.more_names) } else { String::new() };
            format!("{} {:.2} [{}]{more}", row.package.as_deref().unwrap_or("-"), row.share, names.join(", "))
        })
        .collect();
    if flows.more > 0 {
        lines.push(format!("+{} {:.2}", flows.more, flows.more_share));
    }
    format!("{} units, {} unread: {}", flows.units, flows.unread, lines.join("; "))
}

fn read(name: &str, limits: Limits) -> super::Orientation {
    let files = ["packages/a/src/index.ts", "packages/b/src/main.ts", "tools/run.ts", "packages/a/src/util.ts", "packages/b/package.json"];
    asking(name, limits, &files)
}

fn asking(name: &str, limits: Limits, files: &[&str]) -> super::Orientation {
    let root = fixture(name);
    let index = root.0.join("source-index.bin").to_string_lossy().into_owned();
    publish(&index);
    let chain = read_chain(&index).unwrap().expect("a published chain");
    assert_eq!(chain.segments.len(), 2);
    let paths: Vec<String> = PATHS.iter().map(|path| (*path).to_owned()).collect();
    let oids: Vec<Oid> = PATHS.iter().map(|path| oid(path)).collect();
    let files: Vec<String> = files.iter().map(|file| (*file).to_owned()).collect();
    orientation(&root.0.to_string_lossy(), &chain, &Listed { paths: &paths, oids: &oids }, &files, limits).unwrap()
}

#[test]
fn a_published_chain_reads_back_as_shares_between_packages() {
    let answer = read("shares", Limits { rows: 5, names: 5 });
    let owners: Vec<Option<&str>> = answer.owners.iter().map(|owner| owner.package.as_deref()).collect();
    assert_eq!(owners, [Some("@t/a"), Some("@t/b"), None, Some("@t/a"), Some("@t/b")]);
    assert_eq!(answer.owners[0].directory.as_deref(), Some("packages/a"));
    // A tracked file the scan published no record for belongs to its package all the same.
    let indexed: Vec<bool> = answer.owners.iter().map(|owner| owner.indexed).collect();
    assert_eq!(indexed, [true, true, true, true, false]);
    let packages: Vec<&str> = answer.packages.iter().map(|package| package.package.as_str()).collect();
    assert_eq!(packages, ["@t/a", "@t/b"]);

    let [a, b] = &answer.packages[..] else { unreachable!() };
    // The deleted record is not a file of the package, and neither is one git does not list.
    assert_eq!((a.indexed, b.indexed), (2, 2));
    // `helper` is all `@t/a` takes, and half of what `@t/b` gives outside it.
    assert_eq!(rows(&a.takes), "1 units, 0 unread: @t/b 1.00 [helper 0.50]");
    // The replaced record's `z` and the deleted record's `never` are gone; the
    // republished `y` is read from the exports, and the namespace from its member.
    // The record with no parse is counted on the side it would have been read on.
    assert_eq!(rows(&a.taken), "5 units, 1 unread: @t/b 0.60 [format 0.20, x 0.20, y 0.20]; @t/c 0.40 [x 0.20, y 0.20]");
    assert_eq!(rows(&b.takes), "3 units, 0 unread: @t/a 1.00 [format 0.20, x 0.20, y 0.20]");
    // A file no manifest names is a party of its own, and a bare import is the whole module.
    assert_eq!(rows(&b.taken), "2 units, 0 unread: @t/a 0.50 [helper 0.50]; - 0.50 [* 0.50]");

    assert_eq!((answer.records, answer.stale, answer.unread, answer.dropped), (8, 2, 1, 0));
}

#[test]
fn a_name_is_weighed_against_everything_its_package_gives_outside() {
    // Only `@t/c` is asked, so `@t/b`'s uses of `@t/a` are read for the total alone.
    let answer = asking("provider", Limits { rows: 5, names: 5 }, &["packages/c/src/c.ts"]);
    let [c] = &answer.packages[..] else { unreachable!() };
    assert_eq!(c.indexed, 2);
    assert_eq!(rows(&c.takes), "2 units, 1 unread: @t/a 1.00 [x 0.20, y 0.20]");
    assert_eq!(rows(&c.taken), "0 units, 0 unread: ");
}

#[test]
fn what_falls_past_a_limit_is_counted_with_its_share() {
    let answer = read("limits", Limits { rows: 1, names: 2 });
    assert_eq!(rows(&answer.packages[0].taken), "5 units, 1 unread: @t/b 0.60 [format 0.20, x 0.20] +1; +1 0.40");
}

#[test]
fn a_segment_that_fails_its_digest_ends_the_chain_and_is_counted() {
    let root = fixture("dropped");
    let index = root.0.join("source-index.bin").to_string_lossy().into_owned();
    publish(&index);
    let segments = root.0.join("source-index.bin.segments");
    let mut names: Vec<PathBuf> = std::fs::read_dir(&segments).unwrap().map(|entry| entry.unwrap().path()).collect();
    names.sort();
    let chain = read_chain(&index).unwrap().unwrap();
    // Whichever segment is second in the manifest is the one to spoil.
    let second = names.iter().find(|name| std::fs::read(name).unwrap() == chain.segments[1]).unwrap();
    std::fs::write(second, b"spoiled").unwrap();
    let chain = read_chain(&index).unwrap().unwrap();
    assert_eq!((chain.segments.len(), chain.dropped), (1, 1));
    assert!(read_chain(&root.0.join("nothing.bin").to_string_lossy()).unwrap().is_none());
}
