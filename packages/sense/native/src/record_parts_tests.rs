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
    let bytes = fold_last(&shards, &HashMap::new(), &[])?;
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
            "beforeTexts": {"src/a.ts": "t2", "src/z.ts": "t1"}, "cases": {"references": ["a.ts > y 2", "b.ts > x"]}
        })
    );
    let forward = fold_last(&[("one", &one, &none()), ("two", &two, &none())], &HashMap::new(), &[]).unwrap();
    let backward = fold_last(&[("two", &two, &none()), ("one", &one, &none())], &HashMap::new(), &[]).unwrap();
    assert_eq!(forward, backward);
    // The layer is spelled as `JSON.stringify(layer, null, 2)` spells it, its keys in `LastCaseRun`'s order.
    let text = String::from_utf8(forward).unwrap();
    assert!(text.starts_with("{\n  \"commit\": \"c\",\n  \"before\": \"b\",\n  \"at\""), "{text}");
}

#[test]
fn folds_legacy_and_compact_membership_into_the_combined_rows() {
    let legacy = last(r#"{"at":"1","files":["b.ts"],"cases":["b.ts > x","removed.ts > old"]}"#);
    let compact = last(r#"{"at":"1","files":["a.ts"],"cases":{"references":[1,"missing.ts > old"]}}"#);
    let renamed = HashMap::from([("a.ts > y".to_owned(), "a.ts > y 2".to_owned())]);
    let rows = HashMap::from([("two".to_owned(), vec!["a.ts > not run".to_owned(), "a.ts > y".to_owned()])]);
    let combined = vec!["a.ts > not run".to_owned(), "b.ts > x".to_owned(), "a.ts > y 2".to_owned()];
    let bytes = fold_last(&[("one", &legacy, &none()), ("two", &compact, &renamed)], &rows, &combined).unwrap();
    let folded: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(folded["cases"], serde_json::json!({"references": [2, 1, "missing.ts > old", "removed.ts > old"]}));
    let resolved = read_last(&bytes).unwrap().cases.resolved(Some(&combined)).unwrap();
    assert_eq!(resolved, vec!["a.ts > y 2", "b.ts > x", "missing.ts > old", "removed.ts > old"]);
}

#[test]
fn refuses_a_compact_row_the_shard_index_does_not_resolve() {
    let compact = last(r#"{"at":"1","files":["a.ts"],"cases":{"references":[1]}}"#);
    let rows = HashMap::from([("one".to_owned(), vec!["a.ts > x".to_owned()])]);
    let message = fold_last(&[("one", &compact, &none())], &rows, &[]).err().unwrap();
    assert_eq!(message, "one: its last-run layer names an unresolved case row: 1");
}

#[test]
fn began_when_every_shard_began() {
    let began = last(r#"{"at":"1","files":["a.ts"],"began":true,"cases":[]}"#);
    let all = folded_last(&[&began, &began], &[none(), none()]).unwrap();
    assert_eq!((&all["began"], all.get("unbased")), (&serde_json::json!(true), None));
}

#[test]
fn fails_the_build_when_the_shards_started_from_different_records() {
    let unstable = |first: &[u8], second: &[u8], records: [&str; 2]| {
        for (shards, named) in [([first, second], records), ([second, first], [records[1], records[0]])] {
            let message = folded_last(&shards, &[none(), none()]).err().unwrap();
            assert!(message.starts_with("the build failed because the sharding was unstable: one started from "), "{message}");
            assert!(message.contains(&format!("one started from {}, and two from {}.", named[0], named[1])), "{message}");
            assert!(message.contains("the split may have left tests that ran in no shard. Nothing of this build is combined, so the record before it stands. Shards start alike when every one restores the same cached record"), "{message}");
        }
    };
    let at = |commit: &str| last(&format!(r#"{{"commit":"{commit}","at":"1","files":[],"cases":[]}}"#));
    unstable(&at("c"), &at("d"), ["commit `c`", "commit `d`"]);
    let text = |value: &str| last(&format!(r#"{{"at":"1","files":[],"beforeTexts":{{"a.ts":"{value}"}},"cases":[]}}"#));
    unstable(&text("t1"), &text("t2"), ["`a.ts` at text `t1`", "`a.ts` at text `t2`"]);
    let over = |before: &str| last(&format!(r#"{{"at":"1","before":"{before}","files":[],"cases":[]}}"#));
    unstable(&over("b1"), &over("b2"), ["the before layer of commit `b1`", "the before layer of commit `b2`"]);
    // A shard that found no record split the suite against no plan, beside one that split against the record.
    let began = last(r#"{"at":"1","files":["a.ts"],"began":true,"cases":[]}"#);
    unstable(&began, &over("b1"), ["no record", "the before layer of commit `b1`"]);
    // `began` spelled false is a run that did not begin: no writer spells it, and it reads as absent.
    let unbegun = last(r#"{"at":"1","files":["b.ts"],"began":false,"cases":[]}"#);
    unstable(&began, &unbegun, ["no record", "a record"]);
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
    let forward = fold_eyes(&[("one", &one, &renamed), ("two", &two, &none())], Some(&known)).unwrap();
    let backward = fold_eyes(&[("two", &two, &none()), ("one", &one, &renamed)], Some(&known)).unwrap();
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
        let message = fold_eyes(&named, Some(&cases(&["a"]))).err().unwrap();
        assert!(message.contains("a.bin and b.bin hold different Eyes journals for `a` attempt 1"), "{message}");
    }
}

#[test]
fn refuses_a_journal_of_a_case_the_index_does_not_record() {
    let one = eyes(r#"{"version":1,"watched":[],"journals":[{"case":"gone","attempt":1,"journal":{}}]}"#);
    let message = fold_eyes(&[("one", &one, &none())], Some(&cases(&["a"]))).err().unwrap();
    assert!(message.contains("one: its eyes section holds a journal of `gone`, a case the combined index does not record"), "{message}");
}

#[test]
fn refuses_a_journal_when_no_shard_kept_cases_and_says_so() {
    let one = eyes(r#"{"version":1,"watched":[],"journals":[{"case":"a","attempt":1,"journal":{}}]}"#);
    let message = fold_eyes(&[("one", &one, &none())], None).err().unwrap();
    assert_eq!(
        message,
        "one: its eyes section holds a journal of `a`, and no shard kept cases, so the combined record has no case index to name it."
    );
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
        assert!(fold_eyes(&[("one", section.as_bytes(), &none())], Some(&cases(&["a"]))).is_err(), "{section}");
    }
}

#[test]
fn a_last_run_at_no_commit_takes_the_commit_the_others_name() {
    let named = last(r#"{"commit":"c","at":"1","files":["a.ts"],"cases":[]}"#);
    let unnamed = last(r#"{"at":"1","files":["b.ts"],"cases":[]}"#);
    for layers in [[&unnamed, &named], [&named, &unnamed]] {
        let folded = folded_last(&[layers[0], layers[1]], &[none(), none()]).unwrap();
        assert_eq!(folded["commit"], serde_json::json!("c"));
    }
}

/// A readings section as `readings-bytes.ts` writes it; a case's bytes are opaque to the fold, so any distinct text stands for them.
fn section(cases: &[(&str, &str)], inputs: &[(&str, &str)]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut last = Vec::new();
    put(&mut out, cases.len() as u64);
    for (id, own) in cases {
        put_fronted(&mut out, &mut last, id);
        put(&mut out, own.len() as u64);
        out.extend_from_slice(own.as_bytes());
    }
    let mut last = Vec::new();
    put(&mut out, inputs.len() as u64);
    for (file, digest) in inputs {
        put_fronted(&mut out, &mut last, file);
        put_digest(&mut out, digest);
    }
    out
}

#[test]
fn folds_readings_under_each_case_combined_id() {
    let one = section(&[("b", "two readings")], &[]);
    let two = section(&[("a", "one reading")], &[]);
    let renamed: HashMap<String, String> = [("b".to_owned(), "c".to_owned())].into();
    let folded = fold_readings(&[("one", &one, &renamed), ("two", &two, &none())], &cases(&["a", "c"]), &HashMap::new(), &HashMap::new()).unwrap();

    assert_eq!(folded, section(&[("a", "one reading"), ("c", "two readings")], &[]));
}

#[test]
fn refuses_two_shards_reading_one_case_otherwise() {
    let one = section(&[("a", "first")], &[]);
    let two = section(&[("a", "second")], &[]);
    let message = fold_readings(&[("two", &two, &none()), ("one", &one, &none())], &cases(&["a"]), &HashMap::new(), &HashMap::new()).err().unwrap();

    assert_eq!(message, "one and two hold different readings of `a`, so they are not shards of one run and cannot be folded into one.");
}

#[test]
fn refuses_readings_of_a_case_the_index_does_not_record() {
    let one = section(&[("a", "first")], &[]);
    let message = fold_readings(&[("one", &one, &none())], &cases(&["b"]), &HashMap::new(), &HashMap::new()).err().unwrap();

    assert_eq!(message, "one: its readings section holds readings of `a`, a case the combined index does not record");
}

#[test]
fn refuses_a_readings_section_of_bytes_cut_short() {
    let one = section(&[("a", "first")], &[("a.test.ts", "1")]);
    let cut = &one[..one.len() - 1];

    assert!(fold_readings(&[("one", cut, &none())], &cases(&["a"]), &HashMap::new(), &HashMap::new()).is_err());
}

#[test]
fn reads_a_readings_section_an_earlier_build_wrote_as_json_as_none() {
    let json = br#"{"cases":{"a":[{"count":1}]}}"#.to_vec();
    let two = section(&[("b", "second")], &[]);
    let folded = fold_readings(&[("one", &json, &none()), ("two", &two, &none())], &cases(&["a", "b"]), &HashMap::new(), &HashMap::new()).unwrap();

    assert_eq!(folded, section(&[("b", "second")], &[]));
}

#[test]
fn folds_what_each_test_file_ran_over_beside_the_readings() {
    let one = section(&[("a", "first")], &[("b.test.ts", "2"), ("a.test.ts", "1")]);
    let two = section(&[], &[("c.test.ts", "3"), ("a.test.ts", "1")]);
    let folded = fold_readings(&[("one", &one, &none()), ("two", &two, &none())], &cases(&["a"]), &HashMap::new(), &HashMap::new()).unwrap();

    assert_eq!(folded, section(&[("a", "first")], &[("a.test.ts", "1"), ("b.test.ts", "2"), ("c.test.ts", "3")]));
}

#[test]
fn writes_each_path_after_what_it_shares_and_a_digest_as_its_bytes() {
    let one = section(&[], &[("src/a.test.ts", "v1:00ff"), ("src/b.test.ts", "sha:x")]);
    let folded = fold_readings(&[("one", &one, &none())], &cases(&[]), &HashMap::new(), &HashMap::new()).unwrap();

    let mut expected = vec![0, 2, 0, 13];
    expected.extend_from_slice(b"src/a.test.ts");
    expected.extend_from_slice(&[2, 0x00, 0xff, 4, 9]);
    expected.extend_from_slice(b"b.test.ts");
    expected.extend_from_slice(&[0, 5]);
    expected.extend_from_slice(b"sha:x");
    assert_eq!(folded, expected);
    assert_eq!(read_readings(&folded).unwrap().inputs, [("src/a.test.ts".to_owned(), "v1:00ff".to_owned()), ("src/b.test.ts".to_owned(), "sha:x".to_owned())]);
}

#[test]
fn refuses_two_shards_naming_one_test_file_otherwise() {
    let one = section(&[], &[("a.test.ts", "1")]);
    let two = section(&[], &[("a.test.ts", "2")]);
    let message = fold_readings(&[("two", &two, &none()), ("one", &one, &none())], &cases(&[]), &HashMap::new(), &HashMap::new()).err().unwrap();

    assert_eq!(message, "one and two name different inputs of `a.test.ts`, so they are not shards of one run and cannot be folded into one.");
}

#[test]
fn takes_what_the_shard_that_ran_a_file_read_over_what_another_carried_from_its_seed() {
    let ran = section(&[("a", "ran")], &[("a.test.ts", "2")]);
    let carried = section(&[("a", "carried")], &[("a.test.ts", "1")]);
    let who: HashMap<String, Ran> = [("one".to_owned(), Ran { cases: cases(&["a"]), files: cases(&["a.test.ts"]) })].into();
    let folded = fold_readings(&[("two", &carried, &none()), ("one", &ran, &none())], &cases(&["a"]), &who, &HashMap::new()).unwrap();

    assert_eq!(folded, section(&[("a", "ran")], &[("a.test.ts", "2")]));
}

#[test]
fn refuses_two_shards_that_ran_one_file_naming_it_otherwise() {
    let one = section(&[], &[("a.test.ts", "1")]);
    let two = section(&[], &[("a.test.ts", "2")]);
    let both = Ran { cases: cases(&[]), files: cases(&["a.test.ts"]) };
    let who: HashMap<String, Ran> = [("one".to_owned(), both.clone()), ("two".to_owned(), both)].into();
    let message = fold_readings(&[("two", &two, &none()), ("one", &one, &none())], &cases(&[]), &who, &HashMap::new()).err().unwrap();

    assert_eq!(message, "one and two name different inputs of `a.test.ts`, so they are not shards of one run and cannot be folded into one.");
}

#[test]
fn drops_what_a_shard_carried_of_a_case_or_file_another_shard_ran_and_kept_nothing_of() {
    let ran = section(&[], &[]);
    let carried = section(&[("a", "carried")], &[("a.test.ts", "1"), ("b.test.ts", "1")]);
    let who: HashMap<String, Ran> = [("one".to_owned(), Ran { cases: cases(&["a"]), files: cases(&["a.test.ts"]) })].into();
    let folded = fold_readings(&[("two", &carried, &none()), ("one", &ran, &none())], &cases(&["a"]), &who, &HashMap::new()).unwrap();

    assert_eq!(folded, section(&[], &[("b.test.ts", "1")]));
}
