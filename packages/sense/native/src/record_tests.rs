//! The record rule against `builtFromBatch`'s branches.

use std::collections::HashSet;

use super::{built, Edge, Settling};
use crate::acquire::Outcome;
use crate::read::{Kind, Read, Request};
use crate::source_read::SourceRead;

fn set(values: &[&str]) -> HashSet<String> {
    values.iter().map(|value| (*value).to_owned()).collect()
}

fn request(value: &str, kind: Kind) -> Request {
    Request { value: value.to_owned(), kind, bindings: Vec::new(), line: 1, republishes: false }
}

#[test]
fn an_unread_file_is_its_reason_alone() {
    let (builtins, code, directories) = (set(&[]), set(&[]), set(&[]));
    let settling = Settling { builtins: &builtins, code: &code, remembering: true, directories: &directories, aliases: None };
    let read = Read { unknown: Some("a.ts could not be read: EMFILE".to_owned()), ..Read::default() };
    let held = built("a.ts", "git:x", &SourceRead::Module(read), Outcome::Failed, &[], &settling);
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
    let held = built("a.ts", "git:x", &SourceRead::Module(read), Outcome::Declined, &[], &settling);
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
    let targets: Vec<Vec<String>> =
        ["src/b.ts", "src/b.ts", "src/style.css", "", "", "", ""].iter().map(|value| if value.is_empty() { vec![] } else { vec![(*value).to_owned()] }).collect();
    let held = built("src/a.ts", "git:x", &SourceRead::Module(read), Outcome::Parsed, &targets, &settling);
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

#[cfg(feature = "grammars")]
#[test]
fn a_language_request_keeps_all_edges_but_only_its_first_target_and_silences_missed_guesses() {
    use crate::languages::shape::{Kind, Read as LanguageRead, Request};
    use crate::source_read::SourceRead;
    let (builtins, code, directories) = (set(&[]), set(&[".java"]), set(&["src"]));
    let settling = Settling { builtins: &builtins, code: &code, remembering: true, directories: &directories, aliases: None };
    let read = SourceRead::Language(LanguageRead {
        requests: ["com.example.*", "java.util.List"].into_iter().map(|value| Request {
            value: value.into(), kind: Kind::Imports, bindings: vec![], line: 1, guessed: true, item: false,
        }).collect(),
        ..LanguageRead::default()
    });
    let targets = vec![vec!["src/A.java".into(), "src/B.java".into()], vec![]];
    let held = built("src/C.java", "git:x", &read, Outcome::Parsed, &targets, &settling);
    assert_eq!(held.record.edges, Some(vec![
        Edge { to: "src/A.java".into(), kind: "imports".into() },
        Edge { to: "src/B.java".into(), kind: "imports".into() },
    ]));
    assert_eq!(held.targets, Some(vec![Some("src/A.java".into()), None]));
    assert_eq!(held.record.packages, None);
    assert_eq!(held.record.unresolved, None);
    assert_eq!(held.record.unknown, None);
}
