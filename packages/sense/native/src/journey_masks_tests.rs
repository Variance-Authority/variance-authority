use super::*;
use crate::journey_forks::{between, JourneyEnd};
use crate::journey_format::{encode, EncodedModule, SetPool};
use crate::journey_journal::{Test, FINISHED};
use crate::journey_paths::through;
use crate::journey_record::{Block, Module};

/// `setup` runs for every case. Four cases take `route`'s first branch and
/// reach `target`; two take its second and stop; one reaches `target` alone.
fn recorded() -> JourneyMasks {
    let tests: Vec<Test> = (0..7)
        .map(|case| Test { id: format!("t{case}"), file: format!("route{}.test.ts", case % 2), name: format!("case {case}"), settled: FINISHED })
        .collect();
    let block = |kind: &str, name: &str, start: u32, end: u32| Block {
        kind: kind.to_owned(),
        name: name.to_owned(),
        path: String::new(),
        start_line: start,
        end_line: end,
        source: true,
    };
    let module = |file: &str, blocks: Vec<Block>| Module { id: file.to_owned(), file: file.to_owned(), digest: [0; 16], blocks, lands: Vec::new() };
    let modules = [
        module(
            "src/route.ts",
            vec![block("module", "", 1, 20), block("function", "route", 1, 10), block("branch", "", 3, 4), block("branch", "", 6, 7)],
        ),
        module("src/setup.ts", vec![block("module", "", 1, 9), block("function", "setup", 1, 4), block("function", "other", 5, 9)]),
        module("src/target.ts", vec![block("module", "", 1, 5), block("function", "target", 1, 5)]),
    ];
    let mut sets = SetPool::new(tests.len());
    let mut set = |members: &[u32]| sets.intern(members);
    let called = [
        vec![set(&[]), set(&[0, 1, 2, 3, 4, 5]), set(&[0, 1, 2, 3]), set(&[4, 5])],
        vec![set(&[]), set(&[0, 1, 2, 3, 4, 5]), set(&[1, 2])],
        vec![set(&[]), set(&[0, 1, 2, 3, 6])],
    ];
    let loaded = [vec![false; 4], vec![false; 3], vec![false; 2]];
    let encoded: Vec<EncodedModule<'_>> = modules
        .iter()
        .enumerate()
        .map(|(at, module)| EncodedModule { module, called: &called[at], loaded: &loaded[at] })
        .collect();
    let bytes = encode(&tests, &encoded, &sets, None).unwrap();
    JourneyMasks::of(Journey::of("recorded", bytes).unwrap()).unwrap()
}

#[test]
fn a_region_belongs_to_the_smallest_function_holding_its_first_line() {
    let masks = recorded();
    let route = masks.function_at("src/route.ts", 5).unwrap().unwrap();
    assert_eq!(masks.inside(route).len(), 2);
    assert_eq!(masks.within(route), vec![route]);
    assert!(masks.function_at("src/route.ts", 15).unwrap().is_none());
    assert!(masks.function_at("src/absent.ts", 1).unwrap().is_none());
}

#[test]
fn a_journey_is_as_large_as_the_regions_it_entered() {
    let mut masks = recorded();
    assert_eq!(*masks.sizes().unwrap(), vec![4, 5, 5, 4, 3, 3, 1]);
    assert_eq!(overlap(&[1, 2, 3, 4], &[1, 2, 5]), 0.5);
}

#[test]
fn the_path_most_cases_take_is_passage() {
    let mut masks = recorded();
    let answer = through(&mut masks, "src/route.ts", 5).unwrap().unwrap();
    assert_eq!(answer.function.unwrap().name, "route");
    assert_eq!(answer.cases, 6);
    let shape: Vec<(u32, u32, bool, u32)> = answer.paths.iter().map(|p| (p.cases, p.entered[0].line, p.passage, p.smallest.case)).collect();
    assert_eq!(shape, vec![(4, 3, true, 0), (2, 6, false, 4)]);
    assert_eq!((answer.paths[0].files, answer.paths[0].median), (2, 5));
    assert_eq!(answer.paths[1].entered[0].function.as_deref(), Some("route"));
    assert!(through(&mut masks, "src/route.ts", 15).unwrap().is_none());
}

#[test]
fn the_fork_is_the_region_that_separates_the_near_misses() {
    let mut masks = recorded();
    let at = |file: &str, line| JourneyEnd { file: file.to_owned(), line };
    let answer = between(&mut masks, &at("src/route.ts", 2), &at("src/target.ts", 2)).unwrap();
    assert_eq!((answer.reached_a, answer.reached_b, answer.both, answer.journeys), (6, 5, 4, 4));
    let connection = answer.connection.unwrap();
    assert_eq!((connection.case, connection.blocks, connection.alike), (0, 4, 1));
    assert!(!answer.thin);
    let sides = answer.sides.unwrap();
    assert_eq!(sides.len(), 2);
    let forks: Vec<(u32, f64)> = sides[0].forks.as_ref().unwrap().iter().map(|f| (f.block.line, f.separation)).collect();
    assert_eq!(forks, vec![(3, 1.0), (6, -1.0)]);
    assert_eq!((sides[0].only, sides[0].near, sides[0].nearly.as_ref().unwrap().case), (2, 2, 4));
    assert_eq!((sides[1].end.as_str(), sides[1].only, sides[1].near, sides[1].best), ("b", 1, 0, Some(0.25)));
    assert!(sides[1].forks.is_none());
}

#[test]
fn too_few_connecting_cases_are_not_ranked() {
    let mut masks = recorded();
    let at = |file: &str, line| JourneyEnd { file: file.to_owned(), line };
    let answer = between(&mut masks, &at("src/setup.ts", 6), &at("src/target.ts", 2)).unwrap();
    assert_eq!(answer.both, 2);
    assert!(answer.thin);
    assert!(answer.sides.unwrap().iter().all(|side| side.forks.is_none()));
}
