use super::*;

fn none() -> HashMap<String, String> {
    HashMap::new()
}

fn last(json: &str) -> Vec<u8> {
    json.as_bytes().to_vec()
}

fn folded_last(layers: &[&[u8]], renames: &[HashMap<String, String>]) -> Result<serde_json::Value, String> {
    let shards: Vec<(&str, &[u8], &HashMap<String, String>)> =
        layers.iter().zip(renames).enumerate().map(|(at, (bytes, renamed))| (["one", "two", "three"][at], *bytes, renamed)).collect();
    let bytes = fold_last(&shards)?;
    assert_eq!(bytes.last(), Some(&b'\n'));
    Ok(serde_json::from_slice(&bytes).unwrap())
}

#[test]
fn folds_last_run_layers_into_the_one_run_they_were() {
    let one = last(r#"{"commit":"c","before":"b","at":"2026-01-02","files":["b.ts"],"beforeTexts":{"src/z.ts":"t1"},"cases":["b.ts > x"]}"#);
    let two = last(r#"{"commit":"c","before":"b","at":"2026-01-03","files":["a.ts"],"unbased":["a.ts"],"beforeTexts":{"src/a.ts":"t2"},"cases":["a.ts > y"]}"#);
    let renamed = HashMap::from([("a.ts > y".to_owned(), "a.ts > y 2".to_owned())]);
    let folded = folded_last(&[&one, &two], &[none(), renamed]).unwrap();
    assert_eq!(
        folded,
        serde_json::json!({
            "commit": "c", "before": "b", "at": "2026-01-03", "files": ["a.ts", "b.ts"], "unbased": ["a.ts"],
            "beforeTexts": {"src/a.ts": "t2", "src/z.ts": "t1"}, "cases": ["a.ts > y 2", "b.ts > x"]
        })
    );
    let forward = fold_last(&[("one", &one, &none()), ("two", &two, &none())]).unwrap();
    let backward = fold_last(&[("two", &two, &none()), ("one", &one, &none())]).unwrap();
    assert_eq!(forward, backward);
    // The layer is spelled as `JSON.stringify(layer, null, 2)` spells it, its keys in `LastCaseRun`'s order.
    let text = String::from_utf8(forward).unwrap();
    assert!(text.starts_with("{\n  \"commit\": \"c\",\n  \"before\": \"b\",\n  \"at\""), "{text}");
}

#[test]
fn began_only_when_every_shard_began_and_unbased_where_some_did() {
    let began = last(r#"{"at":"1","files":["a.ts"],"began":true,"cases":[]}"#);
    let based = last(r#"{"at":"1","files":["b.ts"],"cases":[]}"#);
    let mixed = folded_last(&[&began, &based], &[none(), none()]).unwrap();
    assert_eq!((mixed.get("began"), &mixed["unbased"]), (None, &serde_json::json!(["a.ts"])));
    let all = folded_last(&[&began, &began], &[none(), none()]).unwrap();
    assert_eq!((&all["began"], all.get("unbased")), (&serde_json::json!(true), None));
}

#[test]
fn refuses_last_run_layers_of_two_runs() {
    let at = |commit: &str| last(&format!(r#"{{"commit":"{commit}","at":"1","files":[],"cases":[]}}"#));
    let message = folded_last(&[&at("c"), &at("d")], &[none(), none()]).err().unwrap();
    assert!(message.contains("one and two disagree about the commit (`c` against `d`)"), "{message}");
    let text = |value: &str| last(&format!(r#"{{"at":"1","files":[],"beforeTexts":{{"a.ts":"{value}"}},"cases":[]}}"#));
    let message = folded_last(&[&text("t1"), &text("t2")], &[none(), none()]).err().unwrap();
    assert!(message.contains("`a.ts` stood on different text"), "{message}");
    assert!(folded_last(&[b"not json"], &[none()]).err().unwrap().contains("one: its last-run layer"));
}

fn eyes(json: &str) -> Vec<u8> {
    json.as_bytes().to_vec()
}

fn cases(names: &[&str]) -> HashSet<String> {
    names.iter().map(|name| (*name).to_owned()).collect()
}

#[test]
fn folds_eyes_into_every_case_watched_and_each_attempt_once() {
    let one = eyes(r#"{"version":1,"watched":["b"],"journals":[{"case":"a","attempt":1,"journal":{"z":1}}]}"#);
    let two = eyes(r#"{"version":1,"watched":[],"journals":[{"case":"a","attempt":1,"journal":{"z":1}},{"case":"a","attempt":2,"journal":{}}]}"#);
    let renamed = HashMap::from([("b".to_owned(), "b 2".to_owned())]);
    let known = cases(&["a", "b 2"]);
    let forward = fold_eyes(&[("one", &one, &renamed), ("two", &two, &none())], &known).unwrap();
    let backward = fold_eyes(&[("two", &two, &none()), ("one", &one, &renamed)], &known).unwrap();
    assert_eq!(forward, backward);
    assert_eq!(
        String::from_utf8(forward).unwrap(),
        "{\"version\":1,\"watched\":[\"a\",\"b 2\"],\"journals\":[{\"case\":\"a\",\"attempt\":1,\"journal\":{\"z\":1}},{\"case\":\"a\",\"attempt\":2,\"journal\":{}}]}\n"
    );
}

#[test]
fn refuses_two_journals_of_one_attempt_naming_both_shards_in_path_order() {
    let one = eyes(r#"{"version":1,"watched":[],"journals":[{"case":"a","attempt":1,"journal":{"z":2}}]}"#);
    let two = eyes(r#"{"version":1,"watched":[],"journals":[{"case":"a","attempt":1,"journal":{"z":1}}]}"#);
    let empty = none();
    for shards in [[("b.bin", &one), ("a.bin", &two)], [("a.bin", &two), ("b.bin", &one)]] {
        let named: Vec<(&str, &[u8], &HashMap<String, String>)> = shards.iter().map(|(name, bytes)| (*name, bytes.as_slice(), &empty)).collect();
        let message = fold_eyes(&named, &cases(&["a"])).err().unwrap();
        assert!(message.contains("a.bin and b.bin hold different Eyes journals for `a` attempt 1"), "{message}");
    }
}

#[test]
fn refuses_a_journal_of_a_case_the_index_does_not_record() {
    let one = eyes(r#"{"version":1,"watched":[],"journals":[{"case":"gone","attempt":1,"journal":{}}]}"#);
    let message = fold_eyes(&[("one", &one, &none())], &cases(&["a"])).err().unwrap();
    assert!(message.contains("one: its eyes section holds a journal of `gone`, a case the combined index does not record"), "{message}");
}

#[test]
fn refuses_an_eyes_section_this_build_does_not_read() {
    for section in [
        r#"{"version":2,"watched":[],"journals":[]}"#,
        r#"{"version":1,"watched":[],"journals":[{"case":"","attempt":1,"journal":{}}]}"#,
        r#"{"version":1,"watched":[],"journals":[{"case":"a","attempt":0,"journal":{}}]}"#,
        r#"{"version":1,"watched":[],"journals":[{"case":"a","attempt":1,"journal":3}]}"#,
        "[",
    ] {
        assert!(fold_eyes(&[("one", section.as_bytes(), &none())], &cases(&["a"])).is_err(), "{section}");
    }
}
