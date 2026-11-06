//! What a shipped file runs of a module it holds whole: a name read off it is
//! that name, a name read off its `default` is the default's, and the module
//! going on whole runs every name of it.

use std::collections::HashSet;

use super::check;
use crate::compact::Layer;
use crate::generation::Delta;
use crate::graph_index::merged;

/// `src/a.ts` publishes `make` and a test-only `helper`; each shipped file
/// holds `./a` whole as `ns` and reads the members given.
fn findings(members: &str) -> Vec<(String, String, u32)> {
    let a = r#"["src/a.ts", {"record": {"file": "src/a.ts", "digest": "da"}, "witnesses": [], "targets": []}]"#;
    let b = r#"["src/b.ts", {"record": {"file": "src/b.ts", "digest": "db"}, "witnesses": [], "targets": ["src/a.ts"]}]"#;
    let exports = r#"[{"exported": "make", "local": "make", "line": 1}, {"exported": "helper", "local": "helper", "line": 3, "roles": ["testOnly"]}]"#;
    let request = r#"{"value": "./a", "kind": "imports", "line": 1, "bindings": [{"imported": "*", "local": "ns", "type": false, "line": 1}]}"#;
    let document = format!(
        r#"{{"records": [{a}, {b}], "parses": [["da\u0000.ts\u0000+", {{"requests": [], "exports": {exports}}}], ["db\u0000.ts\u0000+", {{"requests": [{request}], "members": {members}}}]], "deletedRecords": [], "deletedParses": []}}"#
    );
    let segment = merged(&[], &Delta::of(vec![document]).unwrap());
    let layers = [Layer::open(&segment).unwrap()];
    let shipped: HashSet<&str> = ["src/b.ts"].into_iter().collect();
    let (declared, findings) = check(&layers, Some(&shipped));
    assert_eq!(declared, 1);
    findings.into_iter().map(|finding| (finding.kind, finding.name, finding.line)).collect()
}

#[test]
fn a_name_read_off_the_default_of_a_held_module_is_not_a_name_of_the_module() {
    // `ns.make; ns.default.helper`: the default's `helper` is not the module's.
    let members = r#"[{"request": 0, "name": "make", "line": 2}, {"request": 0, "name": "default", "line": 3}, {"request": 0, "name": "helper", "line": 3, "throughDefault": true}]"#;
    assert_eq!(findings(members), []);
}

#[test]
fn a_held_module_going_on_whole_runs_every_name_of_it() {
    // `run(ns)`: whatever `run` reads of it, `helper` is among what it may.
    let members = r#"[{"request": 0, "name": "make", "line": 2}, {"request": 0, "name": "*", "line": 4}]"#;
    assert_eq!(findings(members), [("test-only-shipped".to_owned(), "helper".to_owned(), 4)]);
}
