use super::*;

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
