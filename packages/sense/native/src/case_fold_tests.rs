use super::*;
use crate::journey_columns::{self, Column};
use crate::journey_journal::{FINISHED, STOPPED};
use crate::record_layout::LAYOUT;

fn case(file: &str, name: &str, runner: &str, settled: u8) -> Test {
    Test {
        id: format!("{file} > {name}"),
        file: file.to_owned(),
        name: name.to_owned(),
        project: None,
        runner: Some(runner.to_owned()),
        settled,
        preconditions: None,
    }
}

fn regions(file: &str, count: u32) -> Module {
    Module {
        id: file.to_owned(),
        file: file.to_owned(),
        blocks: (0..count)
            .map(|at| Block { kind: "function".to_owned(), name: format!("f{at}"), path: format!("f{at}"), start_line: at + 1, end_line: at + 1, source: true })
            .collect(),
        owners: None,
    }
}

/// One shard's index: `called[module][region]` names the cases, by position, that called it.
fn shard(tests: &[Test], extras: &CaseExtras, modules: &[(&str, Vec<Vec<u32>>)]) -> Vec<u8> {
    let mut sets = SetPool::new(tests.len());
    let held: Vec<(Module, Vec<u32>, Vec<bool>)> = modules
        .iter()
        .map(|(file, called)| {
            let ids = called.iter().map(|members| sets.intern(members)).collect();
            (regions(file, called.len() as u32), ids, vec![false; called.len()])
        })
        .collect();
    let encoded: Vec<EncodedModule<'_>> = held.iter().map(|(module, called, loaded)| EncodedModule { module, called, loaded }).collect();
    journey_format::encode(tests, extras, &encoded, &sets, None).unwrap()
}

fn folded(files: &[&[u8]]) -> Result<Folded, String> {
    let mut inventories = HashMap::new();
    let shards = files.iter().map(|bytes| case_shard::read_shard(bytes, &mut inventories)).collect::<Result<Vec<_>, _>>()?;
    fold(shards, inventories)
}

fn read(bytes: &[u8]) -> Shard {
    case_shard::read_shard(bytes, &mut HashMap::new()).unwrap()
}

fn two() -> (Vec<u8>, Vec<u8>) {
    let first = shard(
        &[case("a.test.ts", "adds", "1", FINISHED), case("a.test.ts", "drops", "2", STOPPED)],
        &CaseExtras { durations: vec![Some(5), None], lines: vec![vec![1, 7], Vec::new()] },
        &[("src/a.ts", vec![vec![0, 1], vec![1]]), ("src/shared.ts", vec![vec![0]])],
    );
    let second = shard(
        &[case("b.test.ts", "bends", "1", FINISHED)],
        &CaseExtras { durations: vec![Some(9)], lines: Vec::new() },
        &[("src/b.ts", vec![vec![0]]), ("src/shared.ts", vec![vec![0]])],
    );
    (first, second)
}

#[test]
fn folds_to_the_same_bytes_whatever_the_order_of_the_shards() {
    let (first, second) = two();
    let forward = folded(&[&first, &second]).unwrap();
    let backward = folded(&[&second, &first]).unwrap();
    assert_eq!(forward.bytes, backward.bytes);
    assert_eq!((forward.tests, forward.modules, forward.crossings), (3, 3, 6));
    let again = folded(&[&forward.bytes]).unwrap();
    assert_eq!(again.bytes, forward.bytes, "one folded index folds to itself");
}

#[test]
fn reconciles_two_cuts_of_one_file_in_the_order_of_their_contents() {
    let first = shard(&[case("a.test.ts", "adds", "1", FINISHED)], &CaseExtras::default(), &[("src/a.ts", vec![vec![0], vec![0]])]);
    let second = shard(&[case("b.test.ts", "bends", "1", FINISHED)], &CaseExtras::default(), &[("src/a.ts", vec![vec![0], vec![], vec![0]])]);
    let forward = folded(&[&first, &second]).unwrap();
    assert_eq!(forward.renumbered, ["src/a.ts"]);
    assert_eq!(forward.bytes, folded(&[&second, &first]).unwrap().bytes);
}

#[test]
fn carries_each_cases_duration_and_lines_on_the_rows_of_the_fold() {
    let (first, second) = two();
    let folded = read(&folded(&[&second, &first]).unwrap().bytes);
    let named: Vec<&str> = folded.tests.iter().map(|test| test.name.as_str()).collect();
    assert_eq!(named, ["adds", "drops", "bends"]);
    assert_eq!(folded.durations, [Some(5), None, Some(9)]);
    assert_eq!(folded.lines, [vec![1, 7], Vec::new(), Vec::new()]);
}

#[test]
fn joins_a_case_two_shards_ran_at_its_longest_duration_and_how_it_settled() {
    let one = |duration, settled| shard(&[case("a.test.ts", "adds", "1", settled)], &CaseExtras { durations: vec![Some(duration)], lines: Vec::new() }, &[]);
    let joined = read(&folded(&[&one(3, STOPPED), &one(8, FINISHED)]).unwrap().bytes);
    assert_eq!(joined.durations, [Some(8)]);
    assert_eq!(joined.tests[0].settled, FINISHED);
}

#[test]
fn refuses_one_case_with_two_lines() {
    let one = |lines: Vec<u8>| shard(&[case("a.test.ts", "adds", "1", FINISHED)], &CaseExtras { durations: Vec::new(), lines: vec![lines] }, &[]);
    let refused = folded(&[&one(vec![1, 7]), &one(vec![1, 8])]).err().unwrap();
    assert!(refused.contains("different lines"), "{refused}");
    assert!(folded(&[&one(vec![1, 7]), &one(Vec::new())]).is_ok());
}

#[test]
fn renames_a_case_its_shard_numbered_after_another_of_its_name() {
    let mut second = case("a.test.ts", "adds", "2", FINISHED);
    second.id = "a.test.ts > adds".to_owned();
    let first = shard(&[case("a.test.ts", "adds", "1", FINISHED)], &CaseExtras::default(), &[]);
    let later = shard(&[second], &CaseExtras::default(), &[]);
    let joined = folded(&[&first, &later]).unwrap();
    assert!(joined.renamed[0].is_empty());
    assert_eq!(joined.renamed[1].len(), 1);
    assert_ne!(joined.renamed[1]["a.test.ts > adds"], "a.test.ts > adds");
}

#[test]
fn reads_an_index_that_spells_load_time_as_sets() {
    let (first, _) = two();
    let (_, current) = journey_columns::decode_any(&first).unwrap();
    // Version 2: the set of cases that loaded each region, where version 3 holds a flag.
    let columns = |name: &'static str| Column::Words(name, current.words(name).unwrap());
    let mut held = vec![
        Column::Blob("strings.blob", current.held("strings.blob").unwrap().to_vec(), current.words("strings.off").unwrap()),
        columns("strings.off"),
    ];
    held.extend(["tests.id", "tests.file", "tests.name", "modules.file", "modules.blocks", "blocks.kind", "blocks.name", "blocks.path", "blocks.start", "blocks.end"].map(columns));
    held.push(Column::Bytes("blocks.source", current.bytes("blocks.source").unwrap()));
    // The pool is rebuilt beside the shard's own sets, so called sets keep their ids.
    let mut sets = SetPool::new(2);
    let called: Vec<u32> = current.words("blocks.calledSet").unwrap().iter()
        .map(|set| sets.intern(&case_shard::decode_set(case_shard::set_slice(&current.bytes("sets.blob").unwrap(), &current.words("sets.off").unwrap(), *set).unwrap(), 2).unwrap()))
        .collect();
    let (empty, loaded) = (sets.intern(&[]), sets.intern(&[0]));
    let loaded_sets = vec![loaded, empty, empty];
    held.push(Column::Words("blocks.calledSet", called));
    held.push(Column::Words("blocks.loadedSet", loaded_sets));
    held.push(Column::Blob("sets.blob", sets.bytes().to_vec(), sets.offsets().to_vec()));
    held.push(Column::Words("sets.off", sets.offsets().to_vec()));
    let older = journey_columns::encode(held, LAYOUT.cases.loaded_sets).unwrap();
    let shard = read(&older);
    let flags: Vec<Vec<bool>> = shard.modules.iter().map(|module| module.loaded.clone()).collect();
    assert_eq!(flags, [vec![true, false], vec![false]]);
    let refused = case_shard::read_shard(&journey_columns::encode(Vec::new(), 5).unwrap(), &mut HashMap::new()).err().unwrap();
    assert!(refused.contains("unsupported case index version: 5"), "{refused}");
}
