//! What `importers` reads: the records of the files its walk reaches and of
//! the files holding a specifier that resolved to nothing, and no other, however
//! many files the chain holds.

use std::collections::BTreeSet;

use super::{chain, file, fixture, passes, read, request, uses, Configurations};
use crate::chain_lookup::{fold, newest, record};
use crate::compact::Layer;
use crate::generation::Delta;
use crate::graph_index::merged;
use crate::help_usage::{importers, READ};

/// `count` files that import one another and nothing the question reaches.
fn unrelated(count: usize) -> Vec<(String, String)> {
    (0..count)
        .map(|at| {
            let next = format!("src/other/{}.ts", (at + 1) % count);
            file(&format!("src/other/{at}.ts"), &[&next], &[request("./next", "imports", 1, &[("next", false, 1)])], &[])
        })
        .collect()
}

/// A file whose one import, of `greet` out of `./missing`, resolved to no file.
fn unresolved(path: &str) -> (String, String) {
    let digest = format!("git:{:04x}", path.bytes().map(u32::from).sum::<u32>());
    let record = format!(r#"["{path}", {{"record": {{"file": "{path}", "digest": "{digest}", "unresolved": ["./missing"]}}, "witnesses": [], "targets": [null]}}]"#);
    let parse = format!(r#"["{digest}\u0000.ts\u0000+", {{"requests": [{}], "exports": []}}]"#, request("./missing", "imports", 1, &[("greet", false, 1)]));
    (record, parse)
}

/// The declaration, two barrels and three importers, among `others`.
fn reached(others: Vec<(String, String)>) -> Vec<(String, String)> {
    let mut files = vec![
        file("src/greet.ts", &[], &[], &[]),
        // `export { greet } from './greet'`
        file("src/a.ts", &["src/greet.ts"], &[request("./greet", "reexports", 1, &[("greet", false, 1)])], &[passes("greet", Some("greet"), "./greet", false)]),
        // `export * from './a'`
        file("src/b.ts", &["src/a.ts"], &[request("./a", "reexports", 1, &[])], &[passes("*", None, "./a", false)]),
        file("src/use_a.ts", &["src/a.ts"], &[request("./a", "imports", 1, &[("greet", false, 1)])], &[]),
        file("src/use_b.ts", &["src/b.ts"], &[request("./b", "imports", 2, &[("greet", false, 2)])], &[]),
        file("src/direct.ts", &["src/greet.ts"], &[request("./greet", "imports", 3, &[("greet", false, 3)])], &[]),
    ];
    files.extend(others);
    files
}

fn records_read(run: impl FnOnce()) -> Vec<String> {
    READ.with(|read| read.borrow_mut().clear());
    run();
    READ.with(|read| read.borrow().iter().cloned().collect::<BTreeSet<_>>().into_iter().collect())
}

#[test]
fn reads_the_records_of_the_files_the_walk_reaches_and_no_other() {
    let root = fixture("reads");
    let bytes = chain(&reached(unrelated(1_000)));

    let mut answer = None;
    let records = records_read(|| answer = Some(read(&root.0, &bytes, &["src/greet.ts"], "greet")));

    let answer = answer.unwrap();
    assert_eq!(uses(&answer), ["src/direct.ts:3 greet via ./greet", "src/use_a.ts:1 greet via ./a", "src/use_b.ts:2 greet via ./b"]);
    assert_eq!(answer.through, ["src/a.ts", "src/b.ts"]);
    assert_eq!(records, ["src/a.ts", "src/b.ts", "src/direct.ts", "src/greet.ts", "src/use_a.ts", "src/use_b.ts"]);
}

#[test]
fn reads_of_the_unresolved_imports_only_the_files_that_hold_one() {
    let root = fixture("reads-unresolved");
    let mut others = unrelated(1_000);
    others.extend(["src/lost/1.ts", "src/lost/2.ts"].map(unresolved));
    let bytes = chain(&reached(others));

    let mut answer = None;
    let records = records_read(|| answer = Some(read(&root.0, &bytes, &["src/greet.ts"], "greet")));

    assert_eq!(answer.unwrap().unresolved, ["src/lost/1.ts", "src/lost/2.ts"]);
    let lost: Vec<&String> = records.iter().filter(|file| file.starts_with("src/lost/")).collect();
    assert_eq!(records.len(), 8);
    assert_eq!(lost, ["src/lost/1.ts", "src/lost/2.ts"]);
}

#[test]
fn a_record_a_later_layer_replaces_or_deletes_imports_nothing() {
    let root = fixture("reads-layers");
    let base = chain(&reached(Vec::new()));
    // `src/use_a.ts` now imports nothing, `src/direct.ts` is gone, and `src/late.ts` imports `greet`.
    let (late, late_parse) = file("src/late.ts", &["src/greet.ts"], &[request("./greet", "imports", 4, &[("greet", false, 4)])], &[]);
    let warm = merged(&[], &Delta::of(vec![format!(
        r#"{{"records": [{late}, ["src/use_a.ts", {{"record": {{"file": "src/use_a.ts", "digest": "git:new"}}, "witnesses": [], "targets": []}}]],
            "parses": [{late_parse}, ["git:new\u0000.ts\u0000+", {{"requests": [], "exports": []}}]],
            "deletedRecords": ["src/direct.ts"], "deletedParses": []}}"#
    )]).unwrap());
    let layers = [Layer::open(&base).unwrap(), Layer::open(&warm).unwrap()];
    let folded = fold(&layers);
    for (at, layer) in layers.iter().enumerate() {
        for row in 0..layer.records.file.len() {
            let file = layer.stored.text(layer.records.file.at(row));
            assert_eq!(record(&layers, file), folded.get(file).map(|&found| (file, found)), "{file}");
            assert_eq!(newest(&layers, (at, row)), folded.get(file) == Some(&(at, row)), "{file} in layer {at}");
        }
    }
    assert_eq!(record(&layers, "src/direct.ts"), None);

    let answer = importers(root.0.to_str().unwrap(), &layers, &Configurations::default(), &["src/greet.ts".to_owned()], "greet");

    assert_eq!(uses(&answer), ["src/late.ts:4 greet via ./greet", "src/use_b.ts:2 greet via ./b"]);
    assert_eq!(answer.through, ["src/a.ts", "src/b.ts"]);
}

/// One file that exports `open`, its doc and its head spanned, the text kept
/// when `kept`; the file itself is never written to the root.
fn documented(path: &str, kept: bool) -> (String, String) {
    let digest = format!("git:{:04x}", path.bytes().map(u32::from).sum::<u32>());
    let record = format!(r#"["{path}", {{"record": {{"file": "{path}", "digest": "{digest}"}}, "witnesses": [], "targets": []}}]"#);
    let text = |text: &str| if kept { format!(r#", "text": "{text}""#) } else { String::new() };
    let parse = format!(
        r#"["{digest}\u0000.ts\u0000+", {{"requests": [], "harvested": true,
            "exports": [{{"exported": "open", "local": "open", "line": 4}}],
            "symbols": [{{"name": "open", "kind": "function", "line": 4,
                "signature": {{"start": 30, "end": 60{}}},
                "doc": {{"start": 2, "end": 25{}}}}}]}}]"#,
        text("export function open(): void;  "),
        text(r"*\r\n * Opens the door.\r\n "),
    );
    (record, parse)
}

#[test]
fn usage_answers_a_doc_and_a_head_from_the_text_the_index_keeps_and_reads_no_source() {
    let root = fixture("usage-kept");
    let bytes = chain(&[documented("src/kept.ts", true), documented("src/lost.ts", false)]);
    let layer = Layer::open(&bytes).unwrap();

    let usage = crate::help_usage::usage(root.0.to_str().unwrap(), std::slice::from_ref(&layer), &[], &[], &[], &[]);

    let told: Vec<(&str, Option<&str>, Option<&str>)> =
        usage.exported.iter().map(|one| (one.at.as_str(), one.doc.as_deref(), one.signature.as_deref())).collect();
    assert_eq!(told, [("src/kept.ts", Some("Opens the door."), Some("export function open(): void")), ("src/lost.ts", None, None)]);
    assert_eq!(usage.unreadable, ["src/lost.ts"]);
}
