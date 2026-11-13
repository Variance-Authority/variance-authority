use super::*;

fn none() -> HashMap<String, String> {
    HashMap::new()
}

fn cases(names: &[&str]) -> HashSet<String> {
    names.iter().map(|name| (*name).to_owned()).collect()
}

fn ran(shards: &[(&str, &[&str])]) -> HashMap<String, Ran> {
    shards.iter().map(|(name, ids)| ((*name).to_owned(), Ran { cases: cases(ids), files: HashSet::new() })).collect()
}

#[test]
fn folds_attempts_from_the_shard_that_ran_each_case_in_any_order() {
    // `one` ran `a` and retried it; `two` ran `b` once and carries its seed's rows of `a`, of `b` and of `c`, which nobody ran.
    let one = br#"{"version":1,"attempts":[{"case":"a","attempt":1,"ended":"failed","duration":3,"message":"no","frame":"t.ts:4"},{"case":"a","attempt":2,"ended":"passed","duration":1}]}"#;
    let two = br#"{"version":1,"attempts":[{"case":"a","attempt":1,"ended":"failed"},{"case":"b","attempt":1,"ended":"failed"},{"case":"b","attempt":2,"ended":"passed"},{"case":"c","attempt":2,"ended":"passed"}]}"#;
    let known = cases(&["a", "b 2", "c"]);
    let renamed = HashMap::from([("b".to_owned(), "b 2".to_owned())]);
    let who = ran(&[("one", &["a"]), ("two", &["b 2"])]);
    let forward = fold_attempts(&[("one", one, &none()), ("two", two, &renamed)], Some(&known), &who).unwrap();
    let backward = fold_attempts(&[("two", two, &renamed), ("one", one, &none())], Some(&known), &who).unwrap();
    assert_eq!(forward, backward);
    assert_eq!(
        String::from_utf8(forward).unwrap(),
        "{\"version\":1,\"attempts\":[{\"case\":\"a\",\"attempt\":1,\"ended\":\"failed\",\"duration\":3,\"message\":\"no\",\"frame\":\"t.ts:4\"},{\"case\":\"a\",\"attempt\":2,\"ended\":\"passed\",\"duration\":1},{\"case\":\"b 2\",\"attempt\":1,\"ended\":\"failed\"},{\"case\":\"b 2\",\"attempt\":2,\"ended\":\"passed\"},{\"case\":\"c\",\"attempt\":2,\"ended\":\"passed\"}]}\n"
    );
}

#[test]
fn a_shard_that_ran_a_case_once_retires_the_attempts_another_carried() {
    let carried = br#"{"version":1,"attempts":[{"case":"a","attempt":1,"ended":"failed"},{"case":"a","attempt":2,"ended":"passed"}]}"#;
    let ran_once = br#"{"version":1,"attempts":[]}"#;
    let who = ran(&[("one", &[]), ("two", &["a"])]);
    let folded = fold_attempts(&[("one", carried, &none()), ("two", ran_once, &none())], Some(&cases(&["a"])), &who).unwrap();
    assert_eq!(String::from_utf8(folded).unwrap(), "{\"version\":1,\"attempts\":[]}\n");
}

#[test]
fn refuses_an_attempt_of_a_case_the_index_does_not_record_and_a_section_it_does_not_read() {
    let gone = br#"{"version":1,"attempts":[{"case":"gone","attempt":1,"ended":"failed"}]}"#;
    let message = fold_attempts(&[("one", gone, &none())], Some(&cases(&["a"])), &HashMap::new()).err().unwrap();
    assert!(message.contains("one: its attempts section holds an attempt of `gone`, a case the combined index does not record"), "{message}");
    assert!(fold_attempts(&[("one", gone, &none())], None, &HashMap::new()).is_err());
    for section in [r#"{"version":2,"attempts":[]}"#, r#"{"version":1,"attempts":[{"case":"a","attempt":0,"ended":"passed"}]}"#, r#"{"version":1,"attempts":[{"case":"a","attempt":1}]}"#, "["] {
        assert!(fold_attempts(&[("one", section.as_bytes(), &none())], Some(&cases(&["a"])), &HashMap::new()).is_err(), "{section}");
    }
}
