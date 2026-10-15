use super::*;
use crate::journey_format::SetPool;

fn cut() -> Vec<Block> {
    ["root", "inner"]
        .into_iter()
        .enumerate()
        .map(|(at, name)| Block {
            kind: "function".to_owned(),
            name: name.to_owned(),
            path: name.to_owned(),
            start_line: at as u32 + 1,
            end_line: at as u32 + 1,
            source: true,
        })
        .collect()
}

#[test]
fn refuses_an_owner_that_is_not_before_its_region() {
    let mut held = Vec::new();
    let refused = held_inventory(&mut held, "src/a.ts", cut(), Some(vec![NO_OWNER, 1])).unwrap_err();
    assert_eq!(refused, "src/a.ts names an owner after its region in blocks.owner");
    assert!(held.is_empty());
}

#[test]
fn refuses_two_shards_naming_different_owners_for_one_cut() {
    let mut held = Vec::new();
    held_inventory(&mut held, "src/a.ts", cut(), Some(vec![NO_OWNER, 0])).unwrap();
    let refused = held_inventory(&mut held, "src/a.ts", cut(), Some(vec![NO_OWNER, NO_OWNER])).unwrap_err();
    assert_eq!(refused, "two shards name different owners for one cut of src/a.ts in blocks.owner");
}

#[test]
fn fills_in_owners_for_a_cut_one_shard_wrote_without_them() {
    let mut held = Vec::new();
    assert_eq!(held_inventory(&mut held, "src/a.ts", cut(), None).unwrap(), 0);
    assert_eq!(held_inventory(&mut held, "src/a.ts", cut(), Some(vec![NO_OWNER, 0])).unwrap(), 0);
    assert_eq!(held_inventory(&mut held, "src/a.ts", cut(), None).unwrap(), 0);
    assert_eq!(held[0].owners, Some(vec![NO_OWNER, 0]));
}

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

/// Lines of one case: values 4 and 9, fallback 4, module 0 at 9 from region 1
/// and module 2 at 9 throughout, as `case-lines.ts` writes them.
fn lines() -> Vec<u8> {
    vec![2, 4, 5, 0, 2, 0, 2, 0, 1, 1, 1, 1, 1]
}

#[test]
fn moves_a_cases_lines_to_the_rows_of_the_fold() {
    let moved = remap_lines(&lines(), &[Ok(5), Err("src/b.ts"), Ok(1)]).unwrap();
    // Module 2 is row 1 now and module 0 row 5, so row 1 comes first.
    assert_eq!(moved, vec![2, 4, 5, 0, 2, 1, 1, 1, 3, 2, 0, 1, 1]);
    assert_eq!(remap_lines(&moved, &(0..6).map(Ok).collect::<Vec<_>>()).unwrap(), moved);
    assert_eq!(remap_lines(&[1, 0], &[]).unwrap(), vec![1, 0]);
}

#[test]
fn refuses_lines_on_a_renumbered_or_missing_module_and_lines_that_lie() {
    assert_eq!(remap_lines(&lines(), &[Err("src/a.ts"), Err("src/b.ts"), Ok(1)]).unwrap_err(), "its lines stand on `src/a.ts`, which two shards cut into different regions");
    assert!(remap_lines(&lines(), &[Ok(0)]).unwrap_err().contains("missing module"));
    assert!(remap_lines(&[0xff, 0xff, 0xff, 0xff, 0x0f], &[]).unwrap_err().contains("more values"));
    assert!(remap_lines(&[0xff, 0xff, 0xff, 0xff, 0xff, 0x01], &[]).is_err());
    let mut longer = lines();
    longer.push(0);
    assert!(remap_lines(&longer, &[Ok(0), Err("src/b.ts"), Ok(1)]).unwrap_err().contains("run past"));
}
