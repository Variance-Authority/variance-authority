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
    combine_bytes(&named).map(|combined| combined.bytes)
}

#[test]
fn fails_the_build_when_two_shards_started_from_two_records_and_says_how_to_run_it_again() {
    let (one, two, none) = (shard("a.test.ts", Some(ONE)), shard("b.test.ts", Some(TWO)), shard("c.test.ts", Some("none")));
    for (records, started) in [
        ([&one, &two], "shard-0.bin started from the record sha256:0123456789ab, and shard-1.bin from the record sha256:fedcba987654."),
        ([&two, &one], "shard-0.bin started from the record sha256:fedcba987654, and shard-1.bin from the record sha256:0123456789ab."),
        ([&one, &none], "shard-0.bin started from the record sha256:0123456789ab, and shard-1.bin from no record."),
    ] {
        let message = combined(&[records[0], records[1]]).err().expect("the build fails");
        assert!(message.starts_with(&format!("the build failed because the sharding was unstable: {started}")), "{message}");
        assert!(message.contains("Run the whole build again, so that every shard restores the same cached record"), "{message}");
        assert!(message.contains("`variance-${{ runner.os }}-${{ runner.arch }}-${{ github.sha }}`"), "{message}");
    }
}

#[test]
fn refuses_a_shard_that_names_no_record_it_started_from() {
    let (named, unnamed) = (shard("a.test.ts", Some(ONE)), shard("b.test.ts", None));
    for records in [[&named, &unnamed], [&unnamed, &named]] {
        let message = combined(&[records[0], records[1]]).err().expect("the shard is refused");
        let at = if records[0] == &unnamed { "shard-0.bin" } else { "shard-1.bin" };
        assert!(message.starts_with(&format!("{at} names no record its run started from")), "{message}");
        assert!(message.contains("Record it again with this build"), "{message}");
    }
    let unspelled = shard("a.test.ts", Some("yesterday"));
    let message = combined(&[&unspelled]).err().unwrap();
    assert!(message.starts_with("shard-0.bin names the record it started from as `yesterday`"), "{message}");
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
