use std::collections::BTreeMap;

use super::*;

fn crossed(values: &[((u32, u32), u64)]) -> BTreeMap<(u32, u32), u64> {
    values.iter().copied().collect()
}

#[test]
fn writes_one_value_as_the_case_lines_writer_does_and_crossing_nothing_as_one_zero() {
    // `encodeCaseLines` of one value is its count and the value; of none, one zero byte.
    assert_eq!(encode(&crossed(&[((0, 0), 2), ((3, 1), 2)])), [1, 2]);
    assert_eq!(encode(&BTreeMap::new()), [0]);
}

#[test]
fn reads_back_every_value_it_wrote_with_the_fallback_most_modules_hold_alone() {
    let values = crossed(&[((0, 0), 2), ((0, 1), 14), ((0, 4), 14), ((1, 0), 3), ((2, 0), 3), ((5, 2), 2)]);
    let lines = decode(&encode(&values)).unwrap().unwrap();
    for ((module, block), value) in &values {
        assert_eq!(value_at(&lines, *module, *block), Some(*value), "module {module} region {block}");
    }
    assert_eq!(lines.fallback, Some(3));
    assert_eq!(decode(&[]).unwrap().map(|_| ()), None);
    assert_eq!(value_at(&decode(&[0]).unwrap().unwrap(), 0, 0), None);
}

#[test]
fn keeps_the_cases_own_crossing_over_a_hooks_then_the_earlier_line() {
    assert_eq!(earlier(14, 3), 14);
    assert_eq!(earlier(3, 14), 14);
    assert_eq!(earlier(14, 2), 2);
    assert_eq!(earlier(5, 3), 3);
}

#[test]
fn refuses_bytes_that_name_a_value_they_do_not_hold() {
    // Two values, a fallback index past them.
    assert!(decode(&[2, 2, 12, 9, 0]).is_err());
}

#[test]
fn writes_runs_segments_and_the_fallback_as_the_case_lines_writer_does() {
    // Pinned from the writer before the fold encoded each module as it closed:
    // runs that change mid-module, modules alone off the fallback, a gap in the
    // module indices, and a fallback chosen among modules alone.
    let values = crossed(&[
        ((0, 0), 2), ((0, 1), 14), ((0, 4), 14), ((0, 7), 2), ((1, 0), 3), ((1, 5), 3), ((2, 0), 3),
        ((3, 2), 2), ((4, 0), 2), ((6, 1), 9), ((6, 3), 9), ((8, 0), 40), ((8, 9), 3),
    ]);
    assert_eq!(encode(&values), [5, 2, 1, 6, 5, 26, 0, 5, 0, 3, 0, 3, 0, 1, 6, 0, 1, 1, 0, 1, 1, 3, 1, 2, 1, 2, 4, 1, 9]);
    // Two values held alone by as many modules each: the lower is the fallback.
    let tie = crossed(&[((0, 0), 6), ((1, 0), 4), ((2, 0), 6), ((3, 0), 4), ((4, 0), 6), ((4, 1), 4)]);
    assert_eq!(encode(&tie), [2, 4, 2, 0, 3, 0, 1, 1, 1, 1, 1, 1, 2, 1, 0, 1]);
}

#[test]
fn holds_a_case_by_its_runs_not_by_its_crossings() {
    // Twenty modules of a thousand regions at one line: what the case holds
    // once each module closes is one module index per module, not a value per
    // region, and the bytes are those the whole map would write.
    let mut builder = Builder::default();
    let mut values = BTreeMap::new();
    for module in 0..20 {
        for block in 0..1000 {
            builder.add(module, block, 6);
            values.insert((module, block), 6);
        }
        assert!(builder.held() <= module as usize + 2, "module {module}: {} held", builder.held());
    }
    // A module whose line changes holds a run per change.
    for block in 0..1000 {
        builder.add(20, block, if block < 500 { 6 } else { 8 });
        values.insert((20, block), if block < 500 { 6 } else { 8 });
    }
    assert_eq!(builder.held(), 20 + 2);
    assert_eq!(builder.finish(), encode(&values));
}
