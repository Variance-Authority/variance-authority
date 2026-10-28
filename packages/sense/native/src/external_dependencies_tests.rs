//! The names a file reads of a package it holds whole.

use std::collections::HashSet;

use super::requests_of;
use crate::compact::Layer;
use crate::generation::Delta;
use crate::graph_index::merged;
use crate::package_graph::{fold, join_parses, Crossing};
use crate::package_owners::NO_OWNER;

/// `import * as _ from 'lodash'` and `import * as React from 'react'`, with
/// the members given read off them: the names each request is said to take.
fn names(members: &str) -> Vec<(String, Vec<String>)> {
    let record = r#"["src/main.ts", {"record": {"file": "src/main.ts", "digest": "dm", "packages": [{"to": "lodash", "kind": "imports"}, {"to": "react", "kind": "imports"}]}, "witnesses": [], "targets": [null, null]}]"#;
    let request = |value: &str, local: &str| {
        format!(r#"{{"value": "{value}", "kind": "imports", "line": 1, "bindings": [{{"imported": "*", "local": "{local}", "type": false, "line": 1}}]}}"#)
    };
    let document = format!(
        r#"{{"records": [{record}], "parses": [["dm\u0000.ts\u0000+", {{"requests": [{}, {}], "members": {members}}}]], "deletedRecords": [], "deletedParses": []}}"#,
        request("lodash", "_"),
        request("react", "React"),
    );
    let segment = merged(&[], &Delta::of(vec![document]).unwrap());
    let layers = [Layer::open(&segment).unwrap()];
    let mut crossings: Vec<Crossing> =
        fold(&layers).into_iter().map(|(file, at)| Crossing { file, owner: NO_OWNER, others: Vec::new(), at, parse: None }).collect();
    join_parses(&layers, &mut crossings);
    let requests = requests_of(&layers, &crossings[0], &HashSet::new()).ok().expect("a read file");
    requests.into_iter().map(|request| (request.package, request.names)).collect()
}

fn taken(package: &str, names: &[&str]) -> (String, Vec<String>) {
    (package.to_owned(), names.iter().map(|name| (*name).to_owned()).collect())
}

#[test]
fn a_name_read_off_the_default_of_a_held_package_is_not_a_name_the_package_is_taken_for() {
    // `_.map; _.default.chunk`: `chunk` is the default's, and `React.useState`.
    let members = r#"[{"request": 0, "name": "map", "line": 2}, {"request": 0, "name": "default", "line": 3}, {"request": 0, "name": "chunk", "line": 3, "throughDefault": true}, {"request": 1, "name": "useState", "line": 4}]"#;
    assert_eq!(names(members), [taken("lodash", &["default", "map"]), taken("react", &["useState"])]);
}

#[test]
fn a_held_package_going_on_whole_is_taken_whole_beside_the_names_read_off_it() {
    // `React.useState; render(React)`.
    let members = r#"[{"request": 1, "name": "useState", "line": 4}, {"request": 1, "name": "*", "line": 5}]"#;
    assert_eq!(names(members), [taken("lodash", &["*"]), taken("react", &["*", "useState"])]);
}
