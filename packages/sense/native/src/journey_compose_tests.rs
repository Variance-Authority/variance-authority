use super::*;
use crate::journey_format::{encode, EncodedModule, SetPool};
use crate::journey_journal::{Test, FINISHED};
use crate::journey_read::Journey;
use crate::journey_record::{Block, Module};

/// Eight cases. `setup` runs in every one, so it is structure. Two unit tests
/// of `a` take its first branch; `b`'s test takes both of `a`'s branches and
/// `b`; one unit test runs `c`; the end-to-end case runs everything; three
/// cases run setup alone.
fn recorded() -> JourneyMasks {
    let names = ["a unit", "b uses a", "c unit", "a again", "end to end", "setup one", "setup two", "setup three"];
    let tests: Vec<Test> = names
        .iter()
        .enumerate()
        .map(|(case, name)| Test {
            id: format!("t{case}"),
            file: if case == 3 { "a.test.ts".to_owned() } else { format!("t{case}.test.ts") },
            name: (*name).to_owned(),
            runner: None,
            settled: FINISHED,
            preconditions: None,
        })
        .collect();
    let block = |kind: &str, name: &str, start: u32, end: u32| Block {
        kind: kind.to_owned(),
        name: name.to_owned(),
        path: String::new(),
        start_line: start,
        end_line: end,
        source: true,
    };
    let module = |file: &str, blocks: Vec<Block>| Module { id: file.to_owned(), file: file.to_owned(), blocks, owners: None };
    let modules = [
        module("src/a.ts", vec![block("module", "", 1, 20), block("function", "a", 1, 10), block("branch", "", 3, 4), block("branch", "", 6, 7)]),
        module("src/b.ts", vec![block("module", "", 1, 9), block("function", "b", 1, 9), block("branch", "", 3, 4)]),
        module("src/c.ts", vec![block("module", "", 1, 5), block("function", "c", 1, 5)]),
        module("src/setup.ts", vec![block("module", "", 1, 4), block("function", "setup", 1, 4)]),
    ];
    let mut sets = SetPool::new(tests.len());
    let mut set = |members: &[u32]| sets.intern(members);
    let called = [
        vec![set(&[]), set(&[0, 1, 3, 4]), set(&[0, 1, 3, 4]), set(&[1, 4])],
        vec![set(&[]), set(&[1, 4]), set(&[1, 4])],
        vec![set(&[]), set(&[2, 4])],
        vec![set(&[]), set(&[0, 1, 2, 3, 4, 5, 6, 7])],
    ];
    let loaded = [vec![false; 4], vec![false; 3], vec![false; 2], vec![false; 2]];
    let encoded: Vec<EncodedModule<'_>> = modules
        .iter()
        .enumerate()
        .map(|(at, module)| EncodedModule { module, called: &called[at], loaded: &loaded[at] })
        .collect();
    let bytes = encode(&tests, &encoded, &sets, None).unwrap();
    JourneyMasks::of(Journey::of("recorded", bytes).unwrap()).unwrap()
}

fn cases(pieces: &[JourneyPiece]) -> Vec<(u32, u32, u32)> {
    pieces.iter().map(|piece| (piece.case.case, piece.case.blocks, piece.shared)).collect()
}

fn lines(blocks: &[JourneyBlock]) -> Vec<(&str, u32)> {
    blocks.iter().map(|block| (block.file.as_str(), block.line)).collect()
}

#[test]
fn what_a_test_alone_runs_is_split_from_what_its_pieces_run() {
    let mut masks = recorded();
    let answer = compose(&mut masks, "t1.test.ts", None).unwrap();
    assert!(answer.not_recorded.is_none());
    let test = answer.test.unwrap();
    assert_eq!((test.case, test.blocks, answer.suite, answer.structure), (1, 5, 8, 1));
    // Both unit tests of `a` sit inside it; the end-to-end case holds it.
    assert_eq!(cases(&answer.pieces), vec![(0, 2, 2), (3, 2, 2)]);
    assert_eq!(cases(&answer.wholes), vec![(4, 6, 5)]);
    assert_eq!((answer.explained, answer.alike), (2, 0));
    // `b` is its own layer; `a`'s second branch is a path of a piece that only it reaches.
    assert_eq!(lines(&answer.own), vec![("src/b.ts", 1), ("src/b.ts", 3)]);
    assert_eq!(lines(&answer.reached), vec![("src/a.ts", 6)]);
}

#[test]
fn a_test_its_pieces_explain_leaves_nothing() {
    let mut masks = recorded();
    let answer = compose(&mut masks, "t4.test.ts", None).unwrap();
    assert_eq!(answer.test.unwrap().blocks, 6);
    assert_eq!(cases(&answer.pieces), vec![(1, 5, 5), (0, 2, 2), (3, 2, 2), (2, 1, 1)]);
    assert!(answer.wholes.is_empty());
    assert_eq!(answer.explained, 6);
    assert!(answer.own.is_empty() && answer.reached.is_empty());
}

#[test]
fn a_test_with_the_same_journey_is_alike_and_not_a_piece() {
    let mut masks = recorded();
    let answer = compose(&mut masks, "a.test.ts", None).unwrap();
    assert_eq!(answer.test.unwrap().case, 3);
    assert!(answer.pieces.is_empty());
    assert_eq!(answer.alike, 1);
    assert_eq!(cases(&answer.wholes), vec![(1, 5, 2), (4, 6, 2)]);
    assert_eq!(lines(&answer.own), vec![("src/a.ts", 1), ("src/a.ts", 3)]);
    assert!(answer.reached.is_empty());
}

#[test]
fn a_test_that_runs_only_structure_has_no_footprint() {
    let mut masks = recorded();
    let answer = compose(&mut masks, "t5.test.ts", None).unwrap();
    assert_eq!((answer.test.unwrap().blocks, answer.structure), (0, 1));
    assert!(answer.pieces.is_empty() && answer.wholes.is_empty() && answer.own.is_empty());
}

#[test]
fn a_test_is_named_by_its_file_and_a_word_of_its_name() {
    let mut masks = recorded();
    assert_eq!(compose(&mut masks, "t1.test.ts", Some("USES")).unwrap().test.unwrap().case, 1);
    assert_eq!(
        compose(&mut masks, "t1.test.ts", Some("nothing")).unwrap().not_recorded.unwrap(),
        "No recorded test in t1.test.ts has nothing in its name. Its 1 recorded test:\n  b uses a"
    );
    assert_eq!(
        compose(&mut masks, "absent.test.ts", None).unwrap().not_recorded.unwrap(),
        "The recording holds no test declared in absent.test.ts."
    );
}

#[test]
fn several_tests_in_a_file_are_named_rather_than_chosen() {
    let tests: Vec<Test> = ["first", "second"]
        .iter()
        .map(|name| Test { id: (*name).to_owned(), file: "x.test.ts".to_owned(), name: (*name).to_owned(), runner: None, settled: FINISHED, preconditions: None })
        .collect();
    let module = Module { id: "src/x.ts".to_owned(), file: "src/x.ts".to_owned(), blocks: Vec::new(), owners: None };
    let sets = SetPool::new(tests.len());
    let encoded = [EncodedModule { module: &module, called: &[], loaded: &[] }];
    let mut masks = JourneyMasks::of(Journey::of("two", encode(&tests, &encoded, &sets, None).unwrap()).unwrap()).unwrap();
    assert_eq!(
        compose(&mut masks, "x.test.ts", None).unwrap().not_recorded.unwrap(),
        "x.test.ts declares 2 recorded tests; name one of them:\n  first\n  second"
    );
}
