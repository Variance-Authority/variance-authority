use super::*;
use crate::case_fold;
use crate::crossing_sets::SetPool;
use crate::journey_format::{self, CaseExtras, EncodedModule};
use crate::journey_journal::{Test, FINISHED};
use crate::journey_record::{Block, Module};

fn region(name: &str, start: u64) -> Region {
    Region { module: "src/a.ts".to_owned(), name: name.to_owned(), path: name.to_owned(), start, end: start, value: Some(start * 2) }
}

fn case(file: &str, name: &str) -> Test {
    Test { id: format!("{file} > {name}"), file: file.to_owned(), name: name.to_owned(), project: None, runner: None, settled: FINISHED, heard: None }
}

/// One shard's index: each module cut into `blocks`, `called[region]` naming the cases, by position, that crossed it.
fn shard(tests: &[Test], modules: &[(&str, &[&str], Vec<Vec<u32>>)]) -> Vec<u8> {
    let mut sets = SetPool::new(tests.len());
    let held: Vec<(Module, Vec<u32>, Vec<bool>)> = modules
        .iter()
        .map(|(file, blocks, called)| {
            let module = Module {
                id: (*file).to_owned(),
                file: (*file).to_owned(),
                blocks: blocks
                    .iter()
                    .enumerate()
                    .map(|(at, name)| Block { kind: "function".to_owned(), name: (*name).to_owned(), path: (*name).to_owned(), start_line: at as u32 + 1, end_line: at as u32 + 1, source: true })
                    .collect(),
                owners: None,
            };
            (module, called.iter().map(|members| sets.intern(members)).collect(), vec![false; called.len()])
        })
        .collect();
    let encoded: Vec<EncodedModule<'_>> = held.iter().map(|(module, called, loaded)| EncodedModule { module, called, loaded, overwritten: &[] }).collect();
    journey_format::encode(tests, &CaseExtras::default(), &encoded, &mut sets, None).unwrap()
}

fn expanded() -> usize {
    EXPANDED.with(std::cell::Cell::get)
}

fn newest(stored: Stored) -> Vec<u8> {
    case_bytes(&[Stored { count: 1, stopped: Some(false), ..stored }, Stored { count: 2, added: Some(vec![(0, region("x", 9))]), ..Stored::default() }])
}

#[test]
fn reads_back_the_bytes_it_writes() {
    let readings = vec![
        Stored { count: 3, stopped: Some(true), gone: Some(vec![0, 2]), values: Some(vec![(1, None)]), added: Some(vec![(0, region("x", 9))]), ..Stored::default() },
        Stored { count: 1, regions: Some(vec![region("x", 9), region("y", 4)]), ..Stored::default() },
    ];
    let bytes = case_bytes(&readings);

    assert_eq!(decode_case(&bytes).unwrap(), readings);
    assert_eq!(case_bytes(&decode_case(&bytes).unwrap()), bytes);
}

#[test]
fn owes_only_a_newest_stored_as_a_change_from_the_index() {
    assert!(newest_differs(&newest(Stored { gone: Some(vec![0]), ..Stored::default() })).unwrap());
    assert!(!newest_differs(&newest(Stored::default())).unwrap());
    assert!(!newest_differs(&newest(Stored { regions: Some(vec![region("a", 1)]), ..Stored::default() })).unwrap());
    assert!(!newest_differs(&case_bytes(&[])).unwrap());
}

#[test]
fn lays_out_no_case_where_every_file_is_cut_one_way() {
    let tests: Vec<Test> = (0..200).map(|at| case("a.test.ts", &format!("case {at}"))).collect();
    let all: Vec<u32> = (0..200).collect();
    let one = shard(&tests, &[("src/a.ts", &["f", "g"], vec![all.clone(), all.clone()]), ("src/b.ts", &["h"], vec![all.clone()])]);
    let two = shard(&[case("b.test.ts", "bends")], &[("src/a.ts", &["f", "g"], vec![vec![0], vec![0]])]);
    let mut inventories = HashMap::new();
    let read = case_shard::read_shard(&one, &mut inventories).unwrap();
    case_shard::read_shard(&two, &mut inventories).unwrap();
    // Every newest stands on the index: as its count, or as a difference from it.
    let bytes: Vec<(String, Vec<u8>)> = tests
        .iter()
        .enumerate()
        .map(|(at, test)| (test.id.clone(), newest(if at % 2 == 0 { Stored::default() } else { Stored { gone: Some(vec![1]), ..Stored::default() } })))
        .collect();
    let cases: Vec<(String, &[u8])> = bytes.iter().map(|(id, bytes)| (id.clone(), bytes.as_slice())).collect();
    let before = expanded();

    let owed = owed(&read, &inventories, &cases).unwrap();

    assert!(owed.is_empty());
    assert_eq!(expanded(), before);
    assert!(laid_again(vec![("one".to_owned(), owed)], &[], &HashMap::new()).unwrap().is_empty());
    assert_eq!(expanded(), before);
}

#[test]
fn lays_a_newest_again_over_a_file_the_fold_reconciled_one_case_at_a_time() {
    let tests = [case("a.test.ts", "differs"), case("a.test.ts", "counts")];
    let one = shard(&tests, &[("src/a.ts", &["f", "g"], vec![vec![0, 1], vec![0, 1]])]);
    let two = shard(&[case("b.test.ts", "bends")], &[("src/a.ts", &["f"], vec![vec![0]])]);
    let mut inventories = HashMap::new();
    let read = case_shard::read_shard(&one, &mut inventories).unwrap();
    let other = case_shard::read_shard(&two, &mut inventories).unwrap();
    let (differs, counts) = (newest(Stored { gone: Some(vec![0]), ..Stored::default() }), newest(Stored::default()));
    let cases = [(tests[0].id.clone(), differs.as_slice()), (tests[1].id.clone(), counts.as_slice())];
    let was = applied(&decode_case(&differs).unwrap()[0], &case_regions(&read, &inventories, 0).unwrap());
    let before = expanded();

    let owed = owed(&read, &inventories, &cases).unwrap();

    assert_eq!(owed.iter().map(|case| case.id.as_str()).collect::<Vec<_>>(), [tests[0].id.as_str()]);
    assert_eq!(expanded(), before + 1);
    let shards = vec![case_shard::Shard { name: "one".to_owned(), ..read }, case_shard::Shard { name: "two".to_owned(), ..other }];
    let folded = case_fold::fold(shards, inventories, true).unwrap();
    let laid = laid_again(vec![("one".to_owned(), owed)], &folded.bytes, &HashMap::new()).unwrap();
    assert_eq!(expanded(), before + 2);
    let again = decode_case(&laid[&("one".to_owned(), tests[0].id.clone())]).unwrap();
    let mut combined = HashMap::new();
    let index = case_shard::read_shard(&folded.bytes, &mut combined).unwrap();
    let row = index.tests.iter().position(|test| test.id == tests[0].id).unwrap() as u32;
    assert_eq!(applied(&again[0], &case_regions(&index, &combined, row).unwrap()), was);
    assert_eq!(again[1], decode_case(&differs).unwrap()[1]);
}
