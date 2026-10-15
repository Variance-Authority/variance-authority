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
