use super::*;

#[test]
fn reads_every_set_container_at_both_widths() {
    for tests in [40, LAYOUT.sets.narrow + 10] {
        let mut pool = SetPool::new(tests);
        let spread: Vec<u32> = (0..tests as u32).step_by(tests / 7).collect();
        let dense: Vec<u32> = (0..tests as u32).filter(|test| test % 3 != 0).collect();
        let runs: Vec<u32> = (3..tests as u32 / 2).collect();
        for members in [&spread, &dense, &runs, &Vec::new()] {
            let id = pool.intern(members);
            let held = set_slice(pool.bytes(), pool.offsets(), id).unwrap();
            assert_eq!(&decode_set(held, tests).unwrap(), members, "{tests} tests, container {}", held[0]);
        }
    }
}

#[test]
fn a_run_reaching_past_the_tests_is_refused_before_it_is_held() {
    let mut run = vec![LAYOUT.sets.runs];
    run.extend_from_slice(&1_u16.to_le_bytes());
    run.extend_from_slice(&u16::MAX.to_le_bytes());
    assert_eq!(decode_set(&run, 3).unwrap_err(), "journey set names a missing test");
    let mut wide = vec![LAYOUT.sets.runs];
    wide.extend_from_slice(&u32::MAX.to_le_bytes());
    wide.extend_from_slice(&u32::MAX.to_le_bytes());
    assert_eq!(decode_set(&wide, LAYOUT.sets.narrow).unwrap_err(), "journey set names a missing test");
}

#[test]
fn a_list_or_bitmap_naming_a_missing_test_is_refused() {
    assert!(decode_set(&[LAYOUT.sets.list, 9, 0], 3).is_err());
    assert!(decode_set(&[LAYOUT.sets.bits, 0b1000, 0, 0, 0], 3).is_err());
    assert!(decode_set(&[7], 3).is_err());
    assert!(decode_set(&[], 3).is_err());
}
