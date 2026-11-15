use super::*;

fn at(kind: &str, name: &str, path: &str, start_line: u32, end_line: u32) -> Block {
    Block { kind: kind.to_owned(), name: name.to_owned(), path: path.to_owned(), start_line, end_line, source: true }
}

/// Regions the callers' names are no part of: kind and lines only.
fn module(lines: &[(&str, u32, u32)]) -> Vec<Block> {
    lines.iter().map(|(kind, start, end)| at(kind, "useEffect.arg0", "c/useEffect.arg0", *start, *end)).collect()
}

fn hunk(old_start: i64, old_count: i64, new_start: i64, new_count: i64) -> Hunk {
    Hunk { old_start, old_count, new_start, new_count }
}

fn edit(hunks: &[Hunk], reading: Option<&str>) -> Edit {
    Edit { hunks: hunks.to_vec(), reading: reading.map(str::to_owned) }
}

fn lands(held: &[Block], recorded: &[Block], owners: Option<&[u32]>, change: &Edit) -> Vec<i32> {
    landed_through(held, recorded, owners, Some(change)).lands
}

const N: u32 = NO_OWNER;

#[test]
fn lands_each_region_on_the_one_at_its_lines_when_the_text_did_not_change() {
    let regions = module(&[("module", 1, 9), ("function", 2, 4), ("function", 6, 8)]);
    assert_eq!(lands(&regions, &regions, None, &Edit::default()), [0, 1, 2]);
}

#[test]
fn lands_nothing_when_the_edit_could_not_be_had_and_says_so() {
    let regions = module(&[("module", 1, 9), ("function", 2, 4)]);
    assert_eq!(landed_through(&regions, &regions, None, None), Pairing { lands: vec![-1, -1], overwrote: vec![-1, -1], unread: true });
    assert!(!landed_through(&regions, &regions, None, Some(&Edit::default())).unread);
}

#[test]
fn parts_same_named_regions_by_the_lines_the_edit_places_them_at() {
    let held = module(&[("module", 1, 11), ("function", 2, 4), ("function", 6, 10)]);
    let recorded = module(&[("module", 1, 11), ("function", 2, 6), ("function", 8, 10)]);
    let hunks = [hunk(2, 4, 1, 0), hunk(11, 0, 7, 3)];
    assert_eq!(lands(&held, &recorded, None, &edit(&hunks, None)), [-1, 2, -1]);
    assert_eq!(lands(&held, &recorded, Some(&[N, 0, 0]), &edit(&hunks, Some("none"))), [0, 2, 0]);
}

#[test]
fn carries_nothing_onto_a_region_whose_own_lines_the_edit_rewrote() {
    let held = module(&[("module", 1, 9), ("function", 2, 4), ("function", 6, 8)]);
    assert_eq!(lands(&held, &held, None, &edit(&[hunk(7, 1, 7, 1)], None)), [-1, 1, -1]);
}

#[test]
fn leaves_a_region_whole_that_a_line_written_right_after_it_does_not_touch() {
    let held = module(&[("module", 1, 9), ("function", 2, 4), ("function", 6, 8)]);
    let recorded = module(&[("module", 1, 11), ("function", 2, 4), ("function", 8, 10)]);
    assert_eq!(lands(&held, &recorded, None, &edit(&[hunk(4, 0, 5, 2)], None)), [-1, 1, 2]);
}

#[test]
fn lands_every_region_on_its_own_when_the_edit_changes_nothing_that_runs() {
    let held = module(&[("module", 1, 9), ("function", 2, 4), ("function", 6, 8)]);
    let recorded = module(&[("module", 1, 11), ("function", 2, 4), ("function", 7, 10)]);
    let comments = [hunk(5, 0, 6, 1), hunk(6, 0, 8, 1)];
    assert_eq!(lands(&held, &recorded, None, &edit(&comments, None)), [-1, 1, -1]);
    assert_eq!(lands(&held, &recorded, None, &edit(&comments, Some("none"))), [0, 1, 2]);
}

#[test]
fn pairs_by_address_when_the_edit_changes_nothing_that_runs_but_the_cuts_hold_other_regions() {
    let held = module(&[("module", 1, 9), ("function", 2, 4)]);
    let recorded = module(&[("module", 1, 10), ("function", 2, 4), ("function", 6, 8)]);
    assert_eq!(lands(&held, &recorded, None, &edit(&[hunk(5, 0, 6, 1)], Some("none"))), [0, 1, -1]);
}

#[test]
fn lands_the_top_level_when_the_edit_changed_function_bodies_only() {
    let held = module(&[("module", 1, 9), ("function", 2, 4), ("function", 6, 8)]);
    let rewritten = [hunk(7, 1, 7, 1)];
    assert_eq!(lands(&held, &held, None, &edit(&rewritten, Some("bodies"))), [0, 1, -1]);
    assert_eq!(lands(&held, &held, None, &edit(&rewritten, Some("load"))), [-1, 1, -1]);
}

#[test]
fn names_the_held_region_whose_cases_did_not_land_on_a_region_the_edit_reached() {
    let held = module(&[("module", 1, 9), ("function", 2, 4), ("function", 6, 8)]);
    let rewritten = [hunk(7, 1, 7, 1)];
    assert_eq!(landed_through(&held, &held, None, Some(&edit(&rewritten, Some("bodies")))).overwrote, [-1, -1, 2]);
    assert_eq!(landed_through(&held, &held, None, Some(&edit(&rewritten, None))).overwrote, [0, -1, 2]);
}

#[test]
fn pairs_a_moved_region_by_its_address_and_a_born_one_takes_the_cases_around_it() {
    let held = [at("module", "", "", 1, 9), at("function", "f", "", 2, 4), at("function", "g", "", 6, 8)];
    let recorded = [at("module", "", "", 1, 10), at("function", "f", "", 2, 4), at("function", "g", "", 6, 9), at("branch", "g", "if#0", 7, 8)];
    let owners = [N, 0, 0, 2];
    let written = [hunk(6, 0, 7, 1)];
    assert_eq!(lands(&held, &recorded, Some(&owners), &edit(&written, Some("none"))), [0, 1, 2, 2]);
    assert_eq!(lands(&held, &recorded, Some(&owners), &edit(&written, Some("bodies"))), [0, 1, -1, -1]);
}

#[test]
fn gives_a_born_region_inside_one_of_two_same_named_callbacks_what_the_function_around_them_took() {
    let held = [at("module", "", "", 1, 14), at("function", "c", "", 2, 13), at("function", "c/useEffect.arg0", "", 8, 11)];
    let recorded = [
        at("module", "", "", 1, 15),
        at("function", "c", "", 2, 14),
        at("function", "c/useEffect.arg0", "", 3, 6),
        at("branch", "c/useEffect.arg0", "if#0", 4, 5),
        at("function", "c/useEffect.arg0", "", 8, 12),
    ];
    let owners = [N, 0, 1, 2, 1];
    assert_eq!(lands(&held, &recorded, Some(&owners), &edit(&[hunk(8, 0, 9, 1)], Some("none"))), [0, 1, 1, 1, 1]);
}

#[test]
fn pairs_by_address_only_what_a_renumbered_counter_does_not_count() {
    let held = [at("function", "f", "", 1, 9), at("branch", "f", "if#0", 2, 4), at("branch", "f", "if#1", 6, 8)];
    let recorded = [at("function", "f", "", 1, 6), at("branch", "f", "if#0", 3, 5)];
    assert_eq!(lands(&held, &recorded, None, &edit(&[hunk(2, 3, 1, 0)], Some("none"))), [0, 2]);
}

#[test]
fn pairs_no_repeated_address_by_occurrence_where_the_cuts_hold_it_a_different_number_of_times() {
    let held = [at("module", "", "", 1, 12), at("function", "c", "", 2, 11), at("function", "c/useEffect.arg0", "", 7, 9)];
    let recorded = [
        at("module", "", "", 1, 13),
        at("function", "c", "", 2, 12),
        at("function", "c/useEffect.arg0", "", 3, 5),
        at("function", "c/useEffect.arg0", "", 7, 10),
    ];
    assert_eq!(lands(&held, &recorded, Some(&[N, 0, 1, 1]), &edit(&[hunk(7, 0, 8, 1)], Some("none"))), [0, 1, 1, 1]);
}

#[test]
fn pairs_the_top_level_when_a_branch_deletion_renumbers_its_siblings() {
    let held = [at("module", "", "", 1, 12), at("function", "f", "", 2, 11), at("branch", "f", "if#0", 3, 5), at("branch", "f", "if#1", 7, 9)];
    let recorded = [at("module", "", "", 1, 9), at("function", "f", "", 2, 8), at("branch", "f", "if#0", 4, 6)];
    let deletion = [hunk(3, 3, 2, 0)];
    assert_eq!(lands(&held, &recorded, None, &edit(&deletion, Some("bodies"))), [0, -1, 3]);
    assert_eq!(lands(&held, &recorded, None, &edit(&deletion, Some("load"))), [-1, -1, 3]);
}

#[test]
fn never_lands_a_region_on_one_of_another_kind_at_the_same_lines() {
    assert_eq!(lands(&module(&[("function", 2, 4)]), &module(&[("branch", 2, 4)]), None, &Edit::default()), [-1]);
}

fn named(regions: &[(&str, u32)]) -> Vec<Block> {
    regions.iter().map(|(name, line)| at("function", name, name, *line, line + 1)).collect()
}

#[test]
fn relines_a_held_cut_onto_the_recorded_lines_by_address_and_leaves_out_what_the_recorded_cut_lacks() {
    let held = named(&[("top", 1), ("kept", 2), ("gone", 4), ("inner", 5)]);
    let recorded = named(&[("top", 11), ("kept", 12), ("inner", 15)]);
    assert_eq!(relined(&held, &recorded), Some(Relined::Kept(vec![(0, 0), (1, 1), (3, 2)])));
    assert_eq!(relined(&held, &held), Some(Relined::Same));
}

#[test]
fn relines_nothing_where_an_edit_renumbered_a_counter_both_cuts_hold() {
    let held = [at("function", "f", "if#0", 1, 2), at("function", "f", "if#1", 3, 4)];
    let recorded = [at("function", "f", "if#0", 5, 6)];
    assert_eq!(relined(&held, &recorded), None);
}

#[test]
fn a_held_region_strays_where_siblings_of_its_address_are_held_a_different_number_of_times() {
    let held = [at("function", "cb", "", 1, 2)];
    let recorded = [at("function", "cb", "", 5, 6), at("function", "cb", "", 8, 9)];
    assert!(strayed(&held, &recorded));
    assert!(!strayed(&held, &held));
}
