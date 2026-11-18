use super::*;
use crate::crossing_sets::SetPool;
use crate::journey_format::{encode, CaseExtras, EncodedModule};
use crate::journey_journal::{Test, FINISHED};
use crate::journey_read::Journey;
use crate::journey_record::{Block, Module};

/// `page` calls `useSessionId` in `session.ts` for case 0 and `header` is
/// rendered by case 2; `legacy.ts` declares it again for case 1. In `meet.ts`,
/// `first` ends on the line `second`, a longer one, starts; each is entered by one case. `log` in `loud.ts` is entered by every case, in `quiet.ts` by case 3,
/// which alone runs `report`. `idle` is run by nobody. `statuses.ts` declares
/// a constant whose line holds a callback case 0 runs.
fn recorded() -> JourneyMasks {
    let tests: Vec<Test> = (0..4)
        .map(|case| Test { id: format!("t{case}"), file: format!("t{case}.test.ts"), name: format!("case {case}"), project: None, runner: None, settled: FINISHED, heard: None })
        .collect();
    let block = |kind: &str, name: &str, start: u32, end: u32| Block { kind: kind.to_owned(), name: name.to_owned(), path: String::new(), start_line: start, end_line: end, source: true };
    let module = |file: &str, blocks: Vec<Block>| Module { id: file.to_owned(), file: file.to_owned(), blocks, owners: None };
    let declares = |file: &str, name: &str| module(file, vec![block("module", "", 1, 3), block("function", name, 1, 3)]);
    let modules = [
        declares("src/session.ts", "useSessionId"),
        declares("src/legacy.ts", "useSessionId"),
        module("src/page.ts", vec![block("module", "", 1, 9), block("function", "page", 2, 4), block("function", "header", 5, 7), block("function", "idle", 8, 9)]),
        module("src/meet.ts", vec![block("module", "", 1, 7), block("function", "first", 1, 3), block("function", "second", 3, 7)]),
        declares("src/loud.ts", "log"),
        declares("src/quiet.ts", "log"),
        module("src/report.ts", vec![block("module", "", 1, 2), block("function", "report", 2, 2)]),
        module("src/statuses.ts", vec![block("module", "", 1, 1), block("function", "map.arg0", 1, 1)]),
    ];
    let mut sets = SetPool::new(tests.len());
    let mut set = |members: &[u32]| sets.intern(members);
    let called = [
        vec![set(&[]), set(&[0])],
        vec![set(&[]), set(&[1])],
        vec![set(&[]), set(&[0]), set(&[2]), set(&[])],
        vec![set(&[]), set(&[0]), set(&[3])],
        vec![set(&[]), set(&[0, 1, 2, 3])],
        vec![set(&[]), set(&[3])],
        vec![set(&[]), set(&[3])],
        vec![set(&[]), set(&[0])],
    ];
    let loaded: Vec<Vec<bool>> = modules.iter().map(|module| vec![false; module.blocks.len()]).collect();
    let encoded: Vec<EncodedModule<'_>> = modules
        .iter()
        .enumerate()
        .map(|(at, module)| EncodedModule { module, called: &called[at], loaded: &loaded[at], overwritten: &[] })
        .collect();
    let bytes = encode(&tests, &CaseExtras::default(), &encoded, &mut sets, None).unwrap();
    JourneyMasks::of(Journey::of("recorded", bytes).unwrap()).unwrap()
}

fn at(file: &str, line: u32) -> JourneyEnd {
    JourneyEnd { file: file.to_owned(), line }
}

fn rows(answer: &Resonance) -> Vec<(String, u32, u32, u32, String)> {
    answer.resonant.iter().map(|row| (row.file.clone(), row.candidate, row.cases, row.shared, format!("{:.2}", row.score))).collect()
}

#[test]
fn the_declaration_the_line_called_scores_and_the_other_shares_nothing() {
    let mut masks = recorded();
    let answer = resonate(&mut masks, "src/page.ts", 3, "useSessionId", &[at("src/session.ts", 1), at("src/legacy.ts", 1)]).unwrap();
    assert_eq!(answer.cases, 1);
    assert_eq!(rows(&answer), vec![("src/session.ts".into(), 0, 1, 1, "1.00".into()), ("src/legacy.ts".into(), 1, 1, 0, "0.00".into())]);
}

#[test]
fn a_line_two_functions_meet_on_ran_for_the_cases_of_both() {
    let mut masks = recorded();
    let answer = resonate(&mut masks, "src/meet.ts", 3, "useSessionId", &[at("src/session.ts", 1), at("src/quiet.ts", 1)]).unwrap();
    assert_eq!(answer.cases, 2);
}

#[test]
fn a_function_every_case_enters_scores_below_one_only_the_line_s_cases_enter() {
    let mut masks = recorded();
    let answer = resonate(&mut masks, "src/report.ts", 2, "log", &[at("src/loud.ts", 1), at("src/quiet.ts", 1)]).unwrap();
    assert_eq!(rows(&answer), vec![("src/quiet.ts".into(), 1, 1, 1, "1.00".into()), ("src/loud.ts".into(), 0, 4, 1, "0.50".into())]);
}

#[test]
fn a_line_no_case_ran_has_no_cases_and_one_no_function_holds_is_refused() {
    let mut masks = recorded();
    let idle = resonate(&mut masks, "src/page.ts", 9, "useSessionId", &[at("src/session.ts", 1)]).unwrap();
    assert_eq!((idle.cases, idle.not_recorded), (0, None));
    let outside = resonate(&mut masks, "src/page.ts", 1, "useSessionId", &[at("src/session.ts", 1)]).unwrap();
    assert_eq!(outside.not_recorded.as_deref(), Some("no recorded function holds src/page.ts:1"));
    let unwritten = resonate(&mut masks, "src/page.ts", 3, "useSessionId", &[at("src/absent.ts", 1)]).unwrap();
    assert!(unwritten.resonant.iter().any(|row| row.candidate == 0 && !row.recorded));
}

#[test]
fn a_constant_does_not_take_the_score_of_a_callback_written_on_its_line() {
    let mut masks = recorded();
    let answer = resonate(&mut masks, "src/page.ts", 3, "statuses", &[at("src/statuses.ts", 1)]).unwrap();
    assert_eq!(answer.resonant.iter().map(|row| (row.recorded, row.cases)).collect::<Vec<_>>(), vec![(false, 0)]);
}
