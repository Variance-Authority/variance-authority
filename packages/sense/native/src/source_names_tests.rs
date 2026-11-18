use super::*;
use crate::compact::Layer;
use crate::generation::Delta;
use serde_json::{json, Value};

fn segment(rows: Value) -> Vec<u8> {
    let delta: Delta = serde_json::from_value(rows).unwrap();
    crate::graph_index::merged(&[], &delta)
}

fn declared(pattern: &str) -> NamesOperand {
    NamesOperand { kind: "declares".to_owned(), pattern: Some(pattern.to_owned()), specifier: None, name: None }
}

fn imported(specifier: &str, name: Option<&str>) -> NamesOperand {
    NamesOperand { kind: "imports".to_owned(), pattern: None, specifier: Some(specifier.to_owned()), name: name.map(str::to_owned) }
}

fn file<'a>(answer: &'a NamesAnswer, group: usize, path: &str) -> &'a NamesFile {
    answer.groups[group].files.iter().find(|row| row.file == path).expect("a matching file")
}

#[test]
fn batches_declarations_and_imports_without_exporting_every_files_names() {
    let bytes = segment(json!({
        "parses": [["git:a\u{0}.ts\u{0}+", {
            "harvested": true,
            "requests": [
                {"value":"react", "kind":"imports", "line":1, "bindings":[
                    {"imported":"createContext", "local":"createContext", "line":1},
                    {"imported":"useContext", "local":"read", "line":1}]},
                {"value":"./theme", "kind":"imports", "line":2, "bindings":[{"imported":"*", "local":"theme", "line":2}]},
                {"value":"./side.css", "kind":"imports", "line":3, "bindings":[]},
                {"value":"./store", "kind":"imports", "line":4, "bindings":[{"imported":"selected", "local":"selected", "line":4}]}
            ],
            "symbols":[{"name":"ThemeContext", "kind":"const", "line":5},{"name":"useTheme", "kind":"function", "line":7}],
            "exports":[{"exported":"ThemeContext","local":"ThemeContext","line":5},{"exported":"Palette","line":8},
                {"exported":"Forwarded","from":"./forwarded","line":9},{"exported":"default","local":"selected","line":10}],
            "members":[{"request":1,"name":"dark","line":6}],
            "nested":[{"name":"hidden","kind":"function","line":12,"signature":{"start":0,"end":0},"holderLine":7}]
        }]],
        "records":[["src/a.ts",{"record":{"file":"src/a.ts","digest":"git:a"},"witnesses":[],
            "targets":["node_modules/react/index.js","src/theme.ts","src/side.css","src/store.ts"]}]]
    }));
    let layers = [Layer::open(&bytes).unwrap()];
    let answer = query(&layers, vec![declared("theme|palette|forwarded|default|hidden"), imported("react", Some("useContext")),
        imported("src/theme.ts", Some("dark")), imported("./side.css", None)], &["src/a.ts"]).unwrap();
    assert_eq!(answer.unread, 0);
    let own = &file(&answer, 0, "src/a.ts").evidence;
    assert_eq!(own.iter().map(|row| (row.name.as_deref(), row.line)).collect::<Vec<_>>(),
        [(Some("ThemeContext"),5),(Some("useTheme"),7),(Some("Palette"),8)]);
    let alias = &file(&answer, 1, "src/a.ts").evidence[0];
    assert_eq!((alias.name.as_deref(),alias.from.as_deref(),alias.local.as_deref(),alias.line),
        (Some("useContext"),Some("react"),Some("read"),1));
    let namespace = &file(&answer, 2, "src/a.ts").evidence[0];
    assert_eq!((namespace.name.as_deref(),namespace.through.as_deref(),namespace.line), (Some("dark"),Some("theme"),6));
    let side = &file(&answer, 3, "src/a.ts").evidence[0];
    assert_eq!((side.name.as_deref(),side.from.as_deref(),side.line),(None,Some("./side.css"),3));
}

#[test]
fn named_defaults_belong_to_their_own_identifier_and_first_declarations_win() {
    let bytes = segment(json!({
        "parses":[["git:a\u{0}.ts\u{0}+",{"harvested":true,"requests":[],
            "symbols":[{"name":"make","kind":"function","line":1},{"name":"default","kind":"function","line":1},
                {"name":"make","kind":"function","line":9}],
            "exports":[{"exported":"default","local":"make","line":1},{"exported":"make","local":"make","line":4}]}]],
        "records":[["made.ts",{"record":{"file":"made.ts","digest":"git:a"},"witnesses":[],"targets":[]}]]
    }));
    let layers = [Layer::open(&bytes).unwrap()];
    let answer = query(&layers, vec![declared(".")], &["made.ts"]).unwrap();
    let evidence = &file(&answer, 0, "made.ts").evidence;
    assert_eq!(evidence.len(), 1);
    assert_eq!((evidence[0].name.as_deref(),evidence[0].line),(Some("make"),1));
}

#[test]
fn bare_package_subpaths_match_but_relative_prefixes_do_not() {
    let bytes = segment(json!({
        "parses":[["git:a\u{0}.ts\u{0}+",{"harvested":true,"requests":[
            {"value":"@scope/package/sub", "kind":"imports", "line":1, "bindings":[]},
            {"value":"./store/selectors", "kind":"imports", "line":2, "bindings":[]},
            {"value":"reactive", "kind":"imports", "line":3, "bindings":[]}]}]],
        "records":[["a.ts",{"record":{"file":"a.ts","digest":"git:a"},"witnesses":[],"targets":[null,null,null]}]]
    }));
    let layers = [Layer::open(&bytes).unwrap()];
    let answer = query(&layers,vec![imported("@scope/package",None),imported("./store",None),imported("react",None)], &["a.ts"]).unwrap();
    assert_eq!(answer.groups[0].files.len(),1);
    assert!(answer.groups[1].files.is_empty());
    assert!(answer.groups[2].files.is_empty());
}

#[test]
fn unread_counts_graph_source_paths_but_not_harvested_empty_files_or_non_source() {
    let bytes = segment(json!({
        "parses":[["git:empty\u{0}.ts\u{0}+",{"harvested":true,"requests":[]}],
            ["git:minimal\u{0}.ts\u{0}+",{"requests":[]}]],
        "records":[["empty.ts",{"record":{"file":"empty.ts","digest":"git:empty"},"witnesses":[],"targets":[]}],
            ["minimal.ts",{"record":{"file":"minimal.ts","digest":"git:minimal"},"witnesses":[],"targets":[]}],
            ["missing.ts",{"record":{"file":"missing.ts"},"witnesses":[]}]]
    }));
    let layers = [Layer::open(&bytes).unwrap()];
    let answer = query(&layers,vec![declared(".")], &["empty.ts","minimal.ts","missing.ts","mock-added.ts","README.md"]).unwrap();
    assert_eq!(answer.unread,3);
    assert!(answer.groups[0].files.is_empty());
}

#[test]
fn newest_records_and_parses_decide_the_names_and_deleted_rows_do_not_return() {
    let bytes = [segment(json!({
        "parses":[["git:a\u{0}.ts\u{0}+",{"harvested":true,"requests":[],"symbols":[{"name":"old","kind":"const","line":1}]}]],
        "records":[["a.ts",{"record":{"file":"a.ts","digest":"git:a"},"witnesses":[],"targets":[]}],
            ["gone.ts",{"record":{"file":"gone.ts","digest":"git:a"},"witnesses":[],"targets":[]}]]
    })),segment(json!({
        "parses":[["git:a\u{0}.ts\u{0}+",{"harvested":true,"requests":[],"symbols":[{"name":"new","kind":"const","line":2}]}]],
        "deletedRecords":["gone.ts"]
    }))];
    let layers: Vec<_> = bytes.iter().map(|bytes|Layer::open(bytes).unwrap()).collect();
    let answer = query(&layers,vec![declared("old|new")], &["a.ts"]).unwrap();
    assert_eq!(answer.groups[0].files.len(),1);
    assert_eq!(file(&answer,0,"a.ts").evidence[0].name.as_deref(),Some("new"));
}

#[test]
fn malformed_and_incomplete_operands_are_refused_contextually() {
    assert!(query(&[],vec![declared("[")],&[]).unwrap_err().contains("`declares` is not a regular expression"));
    assert!(query(&[],vec![NamesOperand{kind:"imports".to_owned(),pattern:None,specifier:None,name:None}],&[]).unwrap_err().contains("specifier"));
    assert!(query(&[],vec![NamesOperand{kind:"other".to_owned(),pattern:None,specifier:None,name:None}],&[]).unwrap_err().contains("other"));
}
