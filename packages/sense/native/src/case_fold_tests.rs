use super::*;
use crate::case_lines;
use crate::journey_columns;
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
        heard: None,
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
    journey_format::encode(tests, extras, &encoded, &mut sets, None).unwrap()
}

fn folded(files: &[&[u8]]) -> Result<Folded, String> {
    let mut inventories = HashMap::new();
    let shards = files.iter().map(|bytes| case_shard::read_shard(bytes, &mut inventories)).collect::<Result<Vec<_>, _>>()?;
    fold(shards, inventories, true)
}

fn read(bytes: &[u8]) -> Shard {
    case_shard::read_shard(bytes, &mut HashMap::new()).unwrap()
}

fn two() -> (Vec<u8>, Vec<u8>) {
    let first = shard(
        &[case("a.test.ts", "adds", "1", FINISHED), case("a.test.ts", "drops", "2", STOPPED)],
        &CaseExtras { durations: vec![Some(5), None], lines: vec![vec![1, 7], Vec::new()], ..CaseExtras::default() },
        &[("src/a.ts", vec![vec![0, 1], vec![1]]), ("src/shared.ts", vec![vec![0]])],
    );
    let second = shard(
        &[case("b.test.ts", "bends", "1", FINISHED)],
        &CaseExtras { durations: vec![Some(9)], lines: Vec::new(), ..CaseExtras::default() },
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
    let one = |duration, settled| shard(&[case("a.test.ts", "adds", "1", settled)], &CaseExtras { durations: vec![Some(duration)], lines: Vec::new(), ..CaseExtras::default() }, &[]);
    let joined = read(&folded(&[&one(3, STOPPED), &one(8, FINISHED)]).unwrap().bytes);
    assert_eq!(joined.durations, [Some(8)]);
    assert_eq!(joined.tests[0].settled, FINISHED);
}

#[test]
fn joins_a_case_two_shards_hold_at_the_lines_they_recorded() {
    let one = |lines: Vec<u8>| shard(&[case("a.test.ts", "adds", "1", FINISHED)], &CaseExtras { durations: Vec::new(), lines: vec![lines], ..CaseExtras::default() }, &[]);
    assert_eq!(read(&folded(&[&one(vec![1, 7]), &one(vec![1, 7])]).unwrap().bytes).lines, [vec![1, 7]]);
    assert_eq!(read(&folded(&[&one(Vec::new()), &one(vec![1, 7])]).unwrap().bytes).lines, [vec![1, 7]]);
}

#[test]
fn unions_the_lines_of_the_parts_of_one_case_over_the_regions_each_crossed() {
    // Two parts of one case, as `journeys stitch` joins them: one crossed the
    // first region of `src/a.ts` at line 1, the other the second at line 7, and
    // both the third, the first part from a hook at line 2 and the second at
    // its own line 9.
    let lines = |values: &[((u32, u32), u64)]| case_lines::encode(&values.iter().copied().collect());
    let part = |called: Vec<Vec<u32>>, values: &[((u32, u32), u64)]| {
        shard(&[case("a.test.ts", "adds", "1", FINISHED)], &CaseExtras { durations: Vec::new(), lines: vec![lines(values)], ..CaseExtras::default() }, &[("src/a.ts", called)])
    };
    let first = part(vec![vec![0], vec![], vec![0]], &[((0, 0), 2), ((0, 2), 5)]);
    let second = part(vec![vec![], vec![0], vec![0]], &[((0, 1), 14), ((0, 2), 18)]);
    for order in [[&first, &second], [&second, &first]] {
        let joined = read(&folded(&[order[0], order[1]]).unwrap().bytes);
        let held = case_lines::decode(&joined.lines[0]).unwrap().unwrap();
        let at: Vec<Option<u64>> = (0..3).map(|block| case_lines::value_at(&held, 0, block)).collect();
        assert_eq!(at, [Some(2), Some(14), Some(18)]);
    }
}

#[test]
fn writes_a_duration_column_only_where_asked_or_a_case_was_timed() {
    let untimed = shard(&[case("a.test.ts", "adds", "1", FINISHED)], &CaseExtras::default(), &[]);
    let fold_of = |always_timed: bool| {
        let mut inventories = HashMap::new();
        let shards = vec![case_shard::read_shard(&untimed, &mut inventories).unwrap()];
        let bytes = fold(shards, inventories, always_timed).unwrap().bytes;
        journey_columns::decode_any(&bytes).unwrap().1.has("tests.duration")
    };
    // A record's case index always carries the column; a journey artifact only where a case was timed.
    assert!(fold_of(true));
    assert!(!fold_of(false));
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
fn refuses_an_index_at_another_version() {
    // Every shard of a combine was written by one build: the index before
    // `blocks.loaded`, which spelled load time as sets, is another build's.
    for version in [LAYOUT.cases.format - 1, 5] {
        let refused = case_shard::read_shard(&journey_columns::encode(Vec::new(), version).unwrap(), &mut HashMap::new()).err().unwrap();
        assert!(refused.contains(&format!("it is written at version {version}, and this build reads version 3")), "{refused}");
    }
}
