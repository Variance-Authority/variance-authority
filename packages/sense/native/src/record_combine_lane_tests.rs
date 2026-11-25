//! The worker lane of a test file rides through a fold.

use super::tests::combined;
use super::*;
use crate::record_fixture::{self as fixture, block, module, spec, test};

#[test]
fn carries_each_test_files_lane_and_reads_the_layout_before_it_as_none_given() {
    let none = LAYOUT.coverage.no_duration;
    let mut unlaned = spec(vec![test("a.test.ts")], vec![module("src/a.ts", vec![block(0, &[0])])]);
    unlaned.version = LAYOUT.coverage.unlaned;
    let mut laned = spec(vec![test("b.test.ts")], vec![module("src/a.ts", vec![block(0, &[0])])]);
    laned.tests[0].lane = Some(3);
    let folded = combined(&[&fixture::write(&unlaned), &fixture::write(&laned)]).unwrap();
    assert_eq!(fixture::lanes(&folded.bytes), [("a.test.ts".to_owned(), none), ("b.test.ts".to_owned(), 3)]);
    assert_eq!(journey_columns::decode_any(&folded.bytes).unwrap().0, LAYOUT.coverage.format);
}
