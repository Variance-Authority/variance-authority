use super::*;
use crate::journey_forks::{between, JourneyEnd};
use crate::journey_format::{encode, EncodedModule, SetPool};
use crate::journey_journal::{Test, FINISHED};
use crate::journey_paths::through;
use crate::journey_record::{Block, Module};

/// `setup` runs for every case but one. Four cases take `route`'s first branch
/// and reach `target`; three take its second and stop; one reaches `target` alone.
fn recorded() -> JourneyMasks {
    let tests: Vec<Test> = (0..8)
        .map(|case| Test { id: format!("t{case}"), file: format!("route{}.test.ts", case % 2), name: format!("case {case}"), runner: None, settled: FINISHED, preconditions: None })
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
        vec![set(&[]), set(&[0, 1, 2, 3, 4, 5, 7]), set(&[0, 1, 2, 3]), set(&[4, 5, 7])],
        vec![set(&[]), set(&[0, 1, 2, 3, 4, 5, 7]), set(&[1, 2])],
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
    assert_eq!(*masks.sizes().unwrap(), vec![4, 5, 5, 4, 3, 3, 1, 3]);
    assert_eq!(overlap(&[1, 2, 3, 4], &[1, 2, 5]), 0.5);
}

#[test]
fn the_path_most_cases_take_is_passage() {
    let mut masks = recorded();
    let answer = through(&mut masks, "src/route.ts", 5).unwrap().unwrap();
    assert_eq!(answer.function.unwrap().name, "route");
    assert_eq!(answer.cases, 7);
    let shape: Vec<(u32, u32, bool, u32)> = answer.paths.iter().map(|p| (p.cases, p.entered[0].line, p.passage, p.smallest.case)).collect();
    assert_eq!(shape, vec![(4, 3, true, 0), (3, 6, false, 4)]);
    assert_eq!((answer.paths[0].files, answer.paths[0].median), (2, 5));
    assert_eq!(answer.paths[1].entered[0].function.as_deref(), Some("route"));
    assert!(through(&mut masks, "src/route.ts", 15).unwrap().is_none());
}

#[test]
fn the_fork_is_the_region_that_separates_the_near_misses() {
    let mut masks = recorded();
    let at = |file: &str, line| JourneyEnd { file: file.to_owned(), line };
    let answer = between(&mut masks, &at("src/route.ts", 2), &at("src/target.ts", 2)).unwrap();
    assert_eq!((answer.reached_a, answer.reached_b, answer.both, answer.journeys), (7, 5, 4, 4));
    let connection = answer.connection.unwrap();
    assert_eq!((connection.case, connection.blocks, connection.alike), (0, 4, Some(1)));
    assert!(!answer.thin);
    let sides = answer.sides.unwrap();
    assert_eq!(sides.len(), 2);
    let forks: Vec<(u32, f64)> = sides[0].forks.as_ref().unwrap().iter().map(|f| (f.block.line, f.separation)).collect();
    assert_eq!(forks, vec![(3, 1.0), (6, -1.0)]);
    assert_eq!((sides[0].only, sides[0].near, sides[0].nearly.as_ref().unwrap().case), (3, 3, 4));
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

#[test]
fn a_journey_map_draws_what_the_kept_cases_ran_beyond_the_suite() {
    let mut masks = recorded();
    let answer = crate::journey_map::map(&mut masks, "src/route.ts", &[]).unwrap().unwrap();
    assert_eq!((answer.suite, answer.entered, answer.kept, answer.structure), (8, 7, 7, 2));
    assert_eq!((answer.tests[0].case, answer.tests[0].blocks, answer.tests[0].alike), (4, 3, Some(2)));
    assert_eq!(answer.functions.len(), 1);
    assert_eq!(answer.functions[0].paths.iter().map(|p| p.cases).collect::<Vec<_>>(), vec![4, 3]);
    assert!(answer.spine.is_empty());
    let branches: Vec<(u32, &str, u32)> = answer.branches.iter().map(|b| (b.cases, b.places[0].name.as_str(), b.smallest.case)).collect();
    assert_eq!(branches, vec![(2, "other", 1)]);
    let kept = crate::journey_map::map(&mut masks, "src/route.ts", &["CASE 4".to_owned()]).unwrap().unwrap();
    assert_eq!((kept.entered, kept.kept, kept.tests[0].case, kept.tests[0].alike), (7, 1, 4, Some(0)));
    assert_eq!(kept.functions[0].paths.len(), 1);
    assert!(kept.branches.is_empty());
    assert!(crate::journey_map::map(&mut masks, "src/absent.ts", &[]).unwrap().is_none());
}


#[test]
fn a_journey_map_asked_about_a_test_file_names_the_modules_its_cases_ran() {
    let mut masks = recorded();
    // Cases 0, 2, 4 and 6: three run each module, and fewer of the suite run `target` than the other two.
    assert_eq!(
        crate::journey_map::unmapped(&mut masks, "route0.test.ts", None).unwrap(),
        "route0.test.ts is a test file, and journey-map draws its map around the code that tests run. \
         Ask about one of the modules its 4 recorded tests ran most:\n  \
         src/target.ts  run by 3 of its 4 tests and 5 of all 8 recorded tests\n  \
         src/route.ts  run by 3 of its 4 tests and 7 of all 8 recorded tests\n  \
         src/setup.ts  run by 3 of its 4 tests and 7 of all 8 recorded tests"
    );
}

fn known(module: bool, existed: Option<bool>) -> crate::journey_map::JourneyMapFile {
    crate::journey_map::JourneyMapFile {
        module,
        commit: Some("0123456789abcdef".to_owned()),
        existed,
        unread: existed.is_none().then(|| "git could not read 0123456789ab".to_owned()),
        listed: Some(true),
        directory: Some(false),
        ignored: Some(false),
    }
}

#[test]
fn a_journey_map_says_no_test_loaded_a_file_only_where_every_owner_agrees_it_could_have() {
    let mut masks = recorded();
    let mut unmapped = |file: &str, known: &crate::journey_map::JourneyMapFile| crate::journey_map::unmapped(&mut masks, file, Some(known)).unwrap();
    assert_eq!(
        unmapped("src/absent.ts", &known(true, Some(true))),
        "No recorded test loaded src/absent.ts, unless the test run is configured to leave it uninstrumented: \
         the recording keeps no row for a file the run leaves out. \
         The file existed at 0123456789ab, where the recording was made, and the recording lists 3 files in src/ \
         that its 8 tests loaded, but not this one."
    );
    assert_eq!(
        unmapped("src/absent.ts", &known(true, Some(false))),
        "src/absent.ts is new since the recording, which was made at 0123456789ab, so the recording cannot say whether a test loads it."
    );
    assert_eq!(
        unmapped("src/absent.ts", &known(true, None)),
        "The recording cannot say whether a test loaded src/absent.ts: git could not say whether the file existed \
         at 0123456789ab, where the recording was made (git could not read 0123456789ab)."
    );
    assert!(unmapped("src/types.d.ts", &known(false, Some(true))).starts_with(
        "The recording cannot say whether a test loaded src/types.d.ts: it keeps rows for the source modules a test run instruments"
    ));
    assert_eq!(
        unmapped("lib/absent.ts", &known(true, Some(true))),
        "The recording cannot say whether a test loaded lib/absent.ts: it lists no file in lib/. \
         A directory with no listed file is either one that no recorded test loaded or one that the test run does not instrument, \
         and the recording does not say which."
    );
    // The root is judged by its own files, not by every row.
    assert!(unmapped("absent.ts", &known(true, Some(true))).contains("it lists no file at the repository root."));
    let nowhere = crate::journey_map::JourneyMapFile { listed: Some(false), ..known(false, Some(false)) };
    assert_eq!(
        unmapped("src/absent.json", &nowhere),
        "src/absent.json is not in the checkout: git lists no such file, and the recording keeps no row for it."
    );
    let ignored = crate::journey_map::JourneyMapFile { listed: Some(false), ignored: Some(true), ..known(false, Some(false)) };
    assert_eq!(
        unmapped("gen/out.ts", &ignored),
        "gen/out.ts is not in the checkout: git ignores it, and the recording keeps no row for it."
    );
    let deleted = crate::journey_map::JourneyMapFile { listed: Some(false), ..known(true, Some(true)) };
    assert_eq!(
        unmapped("src/old.ts", &deleted),
        "src/old.ts existed at 0123456789ab, where the recording was made, and is not in the checkout now."
    );
    assert_eq!(
        unmapped("src", &known(false, Some(true))),
        "src is a directory, and journey-map draws its map around one file: ask about one of the files in it."
    );
}
