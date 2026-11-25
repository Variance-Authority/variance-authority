//! The native half spells what `spelling.ts` spells.

use super::{CLI, Surface, Value};

#[derive(serde::Deserialize)]
struct Case {
    verb: String,
    input: serde_json::Map<String, serde_json::Value>,
    shell: String,
    wire: String,
}

#[test]
fn a_question_is_spelled_as_the_wire_and_the_shell_take_it() {
    let cases: Vec<Case> = serde_json::from_str(include_str!("spelling-cases.json")).expect("the cases read");
    assert!(!cases.is_empty());
    for case in &cases {
        let lists: Vec<Vec<&str>> = case.input.values().map(|value| value.as_array().into_iter().flatten().filter_map(|one| one.as_str()).collect()).collect();
        let inputs: Vec<(&str, Value)> = case.input.iter().zip(&lists).map(|((name, value), list)| (name.as_str(), value.as_str().map_or(Value::List(list), Value::Text))).collect();
        assert_eq!(Surface(Some(CLI)).question(&case.verb, &inputs), case.shell);
        assert_eq!(Surface(None).question(&case.verb, &inputs), case.wire);
    }
}
