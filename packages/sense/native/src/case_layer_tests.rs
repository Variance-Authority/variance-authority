use super::*;
use crate::crossing_sets::{self, SetPool};
use crate::journey_record::Module;
use super::super::case_layer_landing::Hunk;

fn case(file: &str, name: &str) -> Test {
    Test { id: format!("{file} > {name}"), file: file.to_owned(), name: name.to_owned(), project: None, runner: Some("vitest".to_owned()), settled: 0, heard: None }
}

fn regions(file: &str, lines: &[u32]) -> Module {
    let blocks = lines
        .iter()
        .enumerate()
        .map(|(at, line)| Block { kind: "function".to_owned(), name: format!("f{at}"), path: format!("f{at}"), start_line: *line, end_line: *line, source: true })
        .collect();
    Module { id: file.to_owned(), file: file.to_owned(), blocks, owners: None }
}

/// An index whose module `file` has a region at each line, `called[region]` naming its cases by position.
fn index(tests: &[Test], modules: &[(&str, &[u32], Vec<Vec<u32>>)]) -> Vec<u8> {
    let mut sets = SetPool::new(tests.len());
    let held: Vec<(Module, Vec<u32>, Vec<bool>)> = modules
        .iter()
        .map(|(file, lines, called)| (regions(file, lines), called.iter().map(|members| sets.intern(members)).collect(), vec![false; called.len()]))
        .collect();
    let encoded: Vec<EncodedModule<'_>> = held.iter().map(|(module, called, loaded)| EncodedModule { module, called, loaded, overwritten: &[] }).collect();
    journey_format::encode(tests, &CaseExtras::default(), &encoded, &mut sets, None).unwrap()
}

/// Each module's file and, per region, the names of the cases it holds.
fn read(bytes: &[u8]) -> Vec<(String, Vec<u32>, Vec<Vec<String>>)> {
    let (shard, cuts) = read_held(bytes).unwrap().unwrap();
    shard
        .modules
        .iter()
        .zip(&cuts)
        .map(|(module, cut)| {
            let named = module
                .called
                .iter()
                .map(|set| {
                    let held = crossing_sets::set_slice(&shard.set_bytes, &shard.set_offsets, *set).unwrap();
                    crossing_sets::decode_set(held, shard.tests.len()).unwrap().into_iter().map(|at| shard.tests[at as usize].name.clone()).collect()
                })
                .collect();
            (module.file.clone(), cut.blocks.iter().map(|block| block.start_line).collect(), named)
        })
        .collect()
}

fn set(files: &[&str]) -> FxHashSet<String> {
    files.iter().map(|file| (*file).to_owned()).collect()
}

fn ran(files: &[&str], present: &[&str]) -> Files<'static> {
    Files { ran: set(files), finished: set(files), present: Present::Among(set(present)), edits: Edits::One, same_text: None, same_before_text: None }
}

#[test]
fn writes_the_run_alone_over_no_index() {
    let fresh = index(&[case("a.test.ts", "one")], &[("a.ts", &[1], vec![vec![0]])]);
    let layers = layer(None, &fresh, &ran(&["a.test.ts"], &[]), None, true).unwrap();
    assert_eq!(layers.merged, fresh);
    assert_eq!(layers.cases, ["a.test.ts > one"]);
    assert!(layers.before.is_none());
}

#[test]
fn replaces_a_finished_file_carries_the_rest_and_retires_a_file_the_checkout_lost() {
    let held = index(
        &[case("a.test.ts", "old"), case("b.test.ts", "kept"), case("c.test.ts", "gone")],
        &[("m.ts", &[1, 2], vec![vec![0, 1], vec![2]])],
    );
    let fresh = index(&[case("a.test.ts", "new")], &[("m.ts", &[1, 2], vec![vec![], vec![0]])]);
    let layers = layer(Some(&held), &fresh, &ran(&["a.test.ts"], &["a.test.ts", "b.test.ts"]), None, true).unwrap();
    assert_eq!(layers.cases, ["a.test.ts > new", "b.test.ts > kept"]);
    assert_eq!(read(&layers.merged), [("m.ts".to_owned(), vec![1, 2], vec![vec!["kept".to_owned()], vec!["new".to_owned()]])]);
    let before = layers.before.unwrap();
    assert_eq!(read(&before), [("m.ts".to_owned(), vec![1, 2], vec![vec!["old".to_owned()], vec![]])]);
}

#[test]
fn lands_held_cases_where_the_edit_moved_their_region() {
    let held = index(&[case("a.test.ts", "one"), case("b.test.ts", "two")], &[("m.ts", &[1, 2], vec![vec![0], vec![1]])]);
    let fresh = index(&[case("a.test.ts", "one")], &[("m.ts", &[1, 4], vec![vec![0], vec![]])]);
    let mut files = ran(&["a.test.ts"], &["a.test.ts", "b.test.ts"]);
    let edit = |_: &str| Ok(Some(Edit { hunks: vec![Hunk { old_start: 1, old_count: 0, new_start: 2, new_count: 2 }], reading: None }));
    files.edits = Edits::Asked(&edit);
    let layers = layer(Some(&held), &fresh, &files, None, false).unwrap();
    assert_eq!(read(&layers.merged), [("m.ts".to_owned(), vec![1, 4], vec![vec!["one".to_owned()], vec!["two".to_owned()]])]);
}

#[test]
fn lays_a_retired_before_over_the_one_kept() {
    let kept = index(&[case("a.test.ts", "first"), case("b.test.ts", "other")], &[("m.ts", &[1], vec![vec![0, 1]])]);
    let retired = index(&[case("a.test.ts", "second")], &[("m.ts", &[1], vec![vec![0]])]);
    assert_eq!(layer_before(None, Some(&retired), set(&[])).unwrap(), Some(retired.clone()));
    assert_eq!(layer_before(Some(&kept), None, set(&[])).unwrap(), Some(kept.clone()));
    let laid = layer_before(Some(&kept), Some(&retired), set(&["a.test.ts"])).unwrap().unwrap();
    assert_eq!(read(&laid), [("m.ts".to_owned(), vec![1], vec![vec!["second".to_owned(), "other".to_owned()]])]);
}

#[test]
fn follows_a_module_onto_the_cut_its_rows_were_landed_at_and_nothing_already_there() {
    let held = index(&[case("a.test.ts", "one")], &[("m.ts", &[1, 2], vec![vec![], vec![0]])]);
    let at = |lines: &[u32]| RowCut { file: "m.ts".to_owned(), blocks: regions("m.ts", lines).blocks, owners: vec![NO_OWNER; lines.len()] };
    let edits: FxHashMap<String, Option<Edit>> = [("m.ts".to_owned(), Some(Edit { hunks: vec![Hunk { old_start: 1, old_count: 0, new_start: 2, new_count: 3 }], reading: None }))].into_iter().collect();
    assert!(follow_cuts(&held, &[at(&[1, 2])], &edits).unwrap().is_none());
    let followed = follow_cuts(&held, &[at(&[1, 5])], &edits).unwrap().unwrap();
    assert_eq!(read(&followed), [("m.ts".to_owned(), vec![1, 5], vec![vec![], vec!["one".to_owned()]])]);
}

#[test]
fn asks_an_edit_only_of_a_module_both_indexes_hold() {
    let held = index(&[case("a.test.ts", "one")], &[("m.ts", &[1], vec![vec![0]])]);
    let fresh = index(&[case("a.test.ts", "one")], &[("m.ts", &[1], vec![vec![0]]), ("n.ts", &[1], vec![vec![0]])]);
    let asked = std::cell::RefCell::new(Vec::new());
    let ask = |file: &str| -> Result<Option<Edit>, String> {
        asked.borrow_mut().push(file.to_owned());
        Ok(Some(Edit::default()))
    };
    let mut files = ran(&["a.test.ts"], &["a.test.ts"]);
    files.edits = Edits::Asked(&ask);
    layer(Some(&held), &fresh, &files, None, false).unwrap();
    assert_eq!(*asked.borrow(), ["m.ts"]);
    // No index to lay over asks nothing.
    asked.borrow_mut().clear();
    layer(None, &fresh, &files, None, false).unwrap();
    assert!(asked.borrow().is_empty());
}
