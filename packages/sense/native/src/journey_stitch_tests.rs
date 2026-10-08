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
