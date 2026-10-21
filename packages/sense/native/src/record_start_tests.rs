use crate::record_combine::combine_bytes;
use crate::record_coverage;
use crate::record_fixture::{self as fixture, spec, test};

const ONE: &str = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const TWO: &str = "sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

/// A shard that ran `file` from `base`, as its record names it.
fn shard(file: &'static str, base: Option<&'static str>) -> Vec<u8> {
    let mut held = spec(vec![test(file)], Vec::new());
    held.base = base;
    fixture::write(&held)
}

fn combined(records: &[&[u8]]) -> Result<Vec<u8>, String> {
    let named: Vec<(String, Vec<u8>)> = records.iter().enumerate().map(|(at, bytes)| (format!("shard-{at}.bin"), bytes.to_vec())).collect();
    combine_bytes(&named, None).map(|combined| combined.bytes)
}

#[test]
fn fails_the_build_when_two_shards_were_laid_over_two_records_and_names_what_starts_them_alike() {
    let over = |laid: &str| leak(format!("none over {laid}"));
    let (one, two, none) = (shard("a.test.ts", Some(over(ONE))), shard("b.test.ts", Some(over(TWO))), shard("c.test.ts", Some("none")));
    for (records, started) in [
        ([&one, &two], "shard-0.bin started from the record sha256:0123456789ab, and shard-1.bin from the record sha256:fedcba987654."),
        ([&two, &one], "shard-0.bin started from the record sha256:fedcba987654, and shard-1.bin from the record sha256:0123456789ab."),
        ([&one, &none], "shard-0.bin started from the record sha256:0123456789ab, and shard-1.bin from no record."),
    ] {
        let message = combined(&[records[0], records[1]]).err().expect("the build fails");
        assert!(message.starts_with(&format!("the build failed because the sharding was unstable: {started}")), "{message}");
        assert!(message.contains("Nothing of this build is combined, so the record before it stands. Shards start alike when every one restores the same cached record"), "{message}");
        assert!(!message.split(|letter: char| !letter.is_alphabetic()).any(|word| word == "again"), "{message}");
        assert!(message.contains("`variance-${{ runner.os }}-${{ runner.arch }}-${{ github.sha }}`"), "{message}");
    }
}

#[test]
fn fails_the_build_when_two_shards_chose_their_tests_from_two_records_and_names_both() {
    let over_none = |read: &str| format!("{read} over none");
    let (one, two) = (shard("a.test.ts", Some(leak(over_none(ONE)))), shard("b.test.ts", Some(leak(over_none(TWO)))));
    let unread = shard("c.test.ts", Some("none"));
    for (records, chose) in [
        ([&one, &two], "shard-0.bin chose its tests from the record sha256:0123456789ab, and shard-1.bin from the record sha256:fedcba987654."),
        ([&one, &unread], "shard-0.bin chose its tests from the record sha256:0123456789ab, and shard-1.bin from no record."),
    ] {
        let message = combined(&[records[0], records[1]]).err().expect("the build fails");
        assert!(message.starts_with(&format!("the build failed because the sharding was unstable: {chose}")), "{message}");
        assert!(message.contains("Nothing of this build is combined, so the record before it stands. Shards choose alike when every one reads the same record"), "{message}");
        assert!(!message.split(|letter: char| !letter.is_alphabetic()).any(|word| word == "again"), "{message}");
    }
}

#[test]
fn passes_shards_that_read_one_record_and_recorded_into_fresh_artifacts() {
    let base = leak(format!("{ONE} over none"));
    let bytes = combined(&[&shard("a.test.ts", Some(base)), &shard("b.test.ts", Some(base))]).unwrap();
    assert_eq!(record_coverage::read(&bytes).unwrap().parts.base.as_deref(), Some(base.as_bytes()));
}

#[test]
fn tells_a_restored_record_apart_from_the_record_the_selection_read() {
    let (one, two) = (shard("a.test.ts", Some(leak(format!("{ONE} over {TWO}")))), shard("b.test.ts", Some(ONE)));
    let message = combined(&[&one, &two]).err().expect("the build fails");
    assert!(message.starts_with("the build failed because the sharding was unstable: shard-0.bin started from the record sha256:fedcba987654, and shard-1.bin from the record sha256:0123456789ab."), "{message}");
    assert!(message.contains("every one restores the same cached record"), "{message}");
}

#[test]
fn refuses_shards_of_two_versions_and_says_which_combine() {
    let (named, unnamed) = (shard("a.test.ts", Some(ONE)), shard("b.test.ts", None));
    for records in [[&named, &unnamed], [&unnamed, &named]] {
        let message = combined(&[records[0], records[1]]).err().expect("the shards are refused");
        let (old, new) = if records[0] == &unnamed { ("shard-0.bin", "shard-1.bin") } else { ("shard-1.bin", "shard-0.bin") };
        assert!(message.starts_with(&format!("{old} was written by variance-authority 0.15.0 or earlier, and {new} by a later version")), "{message}");
        assert!(message.contains("so nothing says the shards split one plan, and they are not combined. Shards combine when the version that combines them wrote every one."), "{message}");
        assert!(!message.split(|letter: char| !letter.is_alphabetic()).any(|word| word == "again"), "{message}");
    }
    let message = combined(&[&unnamed]).err().unwrap();
    assert!(message.starts_with("shard-0.bin was written by variance-authority 0.15.0 or earlier"), "{message}");
    let unspelled = shard("a.test.ts", Some("yesterday"));
    let message = combined(&[&unspelled]).err().unwrap();
    assert!(message.starts_with("shard-0.bin names the record it started from as `yesterday`"), "{message}");
    assert!(message.ends_with("so this build cannot tell where it started, and nothing of it is combined."), "{message}");
}

/// A spelling that lives as long as the fixtures that hold it.
fn leak(text: String) -> &'static str {
    Box::leak(text.into_boxed_str())
}

#[test]
fn writes_the_record_every_shard_started_from() {
    let bytes = combined(&[&shard("a.test.ts", Some(ONE)), &shard("b.test.ts", Some(ONE))]).unwrap();
    assert_eq!(record_coverage::read(&bytes).unwrap().parts.base.as_deref(), Some(ONE.as_bytes()));
    let bytes = combined(&[&shard("a.test.ts", Some("none")), &shard("b.test.ts", Some("none"))]).unwrap();
    assert_eq!(record_coverage::read(&bytes).unwrap().parts.base.as_deref(), Some(&b"none"[..]));
}

#[test]
fn a_shard_that_observed_nothing_started_from_a_record_too() {
    let mut empty = spec(Vec::new(), Vec::new());
    empty.base = Some(TWO);
    let message = combined(&[&shard("a.test.ts", Some(ONE)), &fixture::write(&empty)]).err().unwrap();
    assert!(message.starts_with("the build failed because the sharding was unstable"), "{message}");
}

fn result(records: &[&[u8]]) -> crate::record_combine::CombinedRecord {
    let named: Vec<(String, Vec<u8>)> = records.iter().enumerate().map(|(at, bytes)| (format!("shard-{at}.bin"), bytes.to_vec())).collect();
    combine_bytes(&named, None).unwrap().result
}

#[test]
fn reports_the_record_every_shard_read_so_the_landing_writes_it() {
    let base = leak(format!("{ONE} over none"));
    assert_eq!(result(&[&shard("a.test.ts", Some(base)), &shard("b.test.ts", Some(base))]).read.as_deref(), Some(ONE));
    assert_eq!(result(&[&shard("a.test.ts", Some("none"))]).read.as_deref(), Some("none"));
}

#[test]
fn checks_no_read_of_a_shard_that_names_it_unknown_and_says_which() {
    let (unknown, read) = (shard("a.test.ts", Some("unknown over none")), shard("b.test.ts", Some(leak(format!("{ONE} over none")))));
    let folded = result(&[&unknown, &read]);
    assert_eq!(folded.unchecked, ["shard-0.bin"]);
    assert_eq!(folded.read.as_deref(), Some("unknown"), "a combine that checked no read of one shard claims none for all");
    let named: Vec<(String, Vec<u8>)> = vec![("shard-0.bin".into(), unknown.clone()), ("shard-1.bin".into(), read.clone())];
    let bytes = combine_bytes(&named, None).unwrap().bytes;
    assert_eq!(record_coverage::read(&bytes).unwrap().parts.base.as_deref(), Some(&b"unknown over none"[..]));
    assert!(result(&[&read]).unchecked.is_empty());
    // The record a shard was laid over is still checked.
    let message = combined(&[&shard("a.test.ts", Some(leak(format!("unknown over {ONE}")))), &shard("b.test.ts", Some("unknown over none"))]).err().unwrap();
    assert!(message.starts_with("the build failed because the sharding was unstable: shard-0.bin started from the record sha256:0123456789ab"), "{message}");
    // A run always knows the record it was laid over.
    let message = combined(&[&shard("a.test.ts", Some("none over unknown"))]).err().unwrap();
    assert!(message.starts_with("shard-0.bin names the record it started from as `none over unknown`"), "{message}");
}
