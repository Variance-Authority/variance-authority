//! The record rule against `builtFromBatch`'s branches.

use std::collections::HashSet;

use super::{built, Edge, Settling};
use crate::acquire::Outcome;
use crate::batch::Reached;
use crate::read::{Kind, Read, Request};

fn set(values: &[&str]) -> HashSet<String> {
    values.iter().map(|value| (*value).to_owned()).collect()
}

fn request(value: &str, kind: Kind) -> Request {
    Request { value: value.to_owned(), kind, bindings: Vec::new(), line: 1, republishes: false, guessed: false, item: false }
}

#[test]
fn an_unread_file_is_its_reason_alone() {
    let (builtins, code, directories) = (set(&[]), set(&[]), set(&[]));
    let settling = Settling { builtins: &builtins, code: &code, remembering: true, directories: &directories, aliases: None };
    let read = Read { unknown: Some("a.ts could not be read: EMFILE".to_owned()), ..Read::default() };
    let held = built("a.ts", "git:x", &read, Outcome::Failed, &Reached::default(), &settling);
    assert_eq!(
        serde_json::to_string(&held.record).unwrap(),
        r#"{"file":"a.ts","unknown":"a.ts could not be read: EMFILE"}"#
    );
    assert!(held.witnesses.is_empty());
    assert!(held.targets.is_none());
}

#[test]
fn a_file_declined_by_its_bytes_names_the_bytes_it_declined() {
    let (builtins, code, directories) = (set(&[]), set(&[]), set(&[]));
    let settling = Settling { builtins: &builtins, code: &code, remembering: true, directories: &directories, aliases: None };
    let read = Read { unknown: Some("too large".to_owned()), ..Read::default() };
    let held = built("a.ts", "git:x", &read, Outcome::Declined, &Reached::default(), &settling);
    assert_eq!(
        serde_json::to_string(&held.record).unwrap(),
        r#"{"file":"a.ts","digest":"git:x","unknown":"too large"}"#
    );
    assert!(held.witnesses.is_empty());
}

#[test]
fn a_read_file_settles_edges_packages_and_holes() {
    let (builtins, code, directories) = (set(&["fs"]), set(&[".ts"]), set(&["src"]));
    let settling = Settling { builtins: &builtins, code: &code, remembering: true, directories: &directories, aliases: None };
    let read = Read {
        requests: vec![
            request("./b", Kind::Imports),
            request("./b", Kind::Type),
            request("./style.css", Kind::Imports),
            request("react/jsx-runtime", Kind::Imports),
            request("fs", Kind::Imports),
            request("./gone", Kind::Imports),
            request("data:x", Kind::Imports),
        ],
        ..Read::default()
    };
    let targets: Vec<String> =
        ["src/b.ts", "src/b.ts", "src/style.css", "", "", "", ""].iter().map(|value| (*value).to_owned()).collect();
    let held = built("src/a.ts", "git:x", &read, Outcome::Parsed, &Reached { first: targets, more: Vec::new() }, &settling);
    let record = &held.record;
    assert_eq!(record.digest.as_deref(), Some("git:x"));
    let edges = record.edges.as_ref().unwrap();
    assert_eq!(
        edges,
        &[
            Edge { to: "src/b.ts".into(), kind: "imports".into() },
            Edge { to: "src/b.ts".into(), kind: "type".into() },
            Edge { to: "src/style.css".into(), kind: "asset".into() },
        ]
    );
    assert_eq!(record.packages.as_ref().unwrap(), &[Edge { to: "react".into(), kind: "imports".into() }]);
    assert_eq!(record.unresolved.as_ref().unwrap(), &["./gone", "fs", "react/jsx-runtime"]);
    assert_eq!(
        record.unknown.as_deref(),
        Some("src/a.ts — 1 relative specifier(s) that resolve to nothing: ./gone")
    );
    assert_eq!(held.witnesses, ["src"]);
    assert_eq!(held.targets.as_ref().unwrap().len(), 7);
    assert_eq!(held.targets.as_ref().unwrap()[3], None);
}

/// `record.ts`: a guess that lands is an edge, one that does not is silence,
/// and a language says by its own rule which miss is a hole.
#[test]
fn a_python_guess_that_misses_is_silent_and_a_dot_that_misses_is_a_hole() {
    let (builtins, code, directories) = (set(&[]), set(&[".py"]), set(&[]));
    let settling = Settling { builtins: &builtins, code: &code, remembering: false, directories: &directories, aliases: None };
    let guessed = Request { guessed: true, ..request("pkg.answer.VERSION", Kind::Imports) };
    let read = Read {
        requests: vec![request("pkg", Kind::Imports), guessed, request(".gone", Kind::Imports), request("./also", Kind::Imports)],
        ..Read::default()
    };
    let first = ["src/pkg/__init__.py", "", "", ""].iter().map(|value| (*value).to_owned()).collect();
    let held = built("tests/a.py", "git:x", &read, Outcome::Parsed, &Reached { first, more: Vec::new() }, &settling);
    let record = &held.record;
    assert_eq!(record.edges.as_ref().unwrap(), &[Edge { to: "src/pkg/__init__.py".into(), kind: "imports".into() }]);
    assert_eq!(record.unresolved.as_ref().unwrap(), &["./also", ".gone"]);
    assert_eq!(record.unknown.as_deref(), Some("tests/a.py — 2 relative specifier(s) that resolve to nothing: .gone, ./also"));
}

/// `record.ts`: every file a request reaches is an edge, the first its target.
#[test]
fn every_file_a_request_reaches_is_an_edge_and_the_first_is_its_target() {
    let (builtins, code, directories) = (set(&[]), set(&[".swift"]), set(&[]));
    let settling = Settling { builtins: &builtins, code: &code, remembering: false, directories: &directories, aliases: None };
    let read = Read { requests: vec![request("Kit", Kind::Imports), request("Other", Kind::Imports)], ..Read::default() };
    let first = vec!["Sources/Kit/A.swift".to_owned(), "Sources/Other/C.swift".to_owned()];
    let more = vec![(0, "Sources/Kit/B.swift".to_owned())];
    let held = built("Sources/App/main.swift", "git:x", &read, Outcome::Parsed, &Reached { first, more }, &settling);
    let to: Vec<&str> = held.record.edges.as_ref().unwrap().iter().map(|edge| edge.to.as_str()).collect();
    assert_eq!(to, ["Sources/Kit/A.swift", "Sources/Kit/B.swift", "Sources/Other/C.swift"]);
    assert_eq!(held.targets.as_ref().unwrap().len(), 2);
}
