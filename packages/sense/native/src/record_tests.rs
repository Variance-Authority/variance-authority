//! The record rule against `builtFromBatch`'s branches.

use std::collections::HashSet;

use super::{built, Edge, Settling};
use crate::read::{Kind, Read, Request};

fn set(values: &[&str]) -> HashSet<String> {
    values.iter().map(|value| (*value).to_owned()).collect()
}

fn request(value: &str, kind: Kind) -> Request {
    Request { value: value.to_owned(), kind, bindings: Vec::new(), line: 1 }
}

#[test]
fn an_unread_file_is_its_reason_alone() {
    let (builtins, code, directories) = (set(&[]), set(&[]), set(&[]));
    let settling = Settling { builtins: &builtins, code: &code, remembering: true, directories: &directories, aliases: None };
    let read = Read { unknown: Some("a.ts could not be read: EMFILE".to_owned()), ..Read::default() };
    let held = built("a.ts", "git:x", &read, false, &[], &settling);
    assert_eq!(
        serde_json::to_string(&held.record).unwrap(),
        r#"{"file":"a.ts","unknown":"a.ts could not be read: EMFILE"}"#
    );
    assert!(held.witnesses.is_empty());
    assert!(held.targets.is_none());
}

#[test]
fn a_file_declined_for_its_size_names_the_bytes_it_declined() {
    let (builtins, code, directories) = (set(&[]), set(&[]), set(&[]));
    let settling = Settling { builtins: &builtins, code: &code, remembering: true, directories: &directories, aliases: None };
    let read = Read { unknown: Some("too large".to_owned()), oversized: true, ..Read::default() };
    let held = built("a.ts", "git:x", &read, false, &[], &settling);
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
    let held = built("src/a.ts", "git:x", &read, true, &targets, &settling);
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
