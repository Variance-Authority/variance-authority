use super::*;
use crate::crossing_sets::SetPool;
use crate::journey_format::{self, CaseExtras, EncodedModule};
use crate::journey_journal::{Test, FINISHED};
use crate::journey_record::{Block, Module};
use crate::record_fixture::{self as fixture, block, module, spec, test, Spec};

pub(super) fn named(records: &[&[u8]]) -> Vec<(String, Vec<u8>)> {
    records.iter().enumerate().map(|(at, bytes)| (format!("shard-{at}.bin"), bytes.to_vec())).collect()
}

pub(super) fn combined(records: &[&[u8]]) -> Result<Combined, String> {
    combine_bytes(&named(records), None)
}

fn refused(records: &[&[u8]]) -> String {
    combined(records).err().expect("the fold is refused")
}

fn two() -> (Vec<u8>, Vec<u8>) {
    let first = spec(
        vec![test("b.test.ts"), test("a.test.ts")],
        vec![module("src/shared.ts", vec![block(0, &[0, 1]), block(2, &[1])]), module("src/a.ts", vec![block(0, &[1])])],
    );
    let second = spec(vec![test("c.test.ts")], vec![module("src/shared.ts", vec![block(0, &[0]), block(1, &[0])])]);
    (fixture::write(&first), fixture::write(&second))
}

pub(super) fn files(names: &[&str]) -> Vec<String> {
    names.iter().map(|name| (*name).to_owned()).collect()
}

#[test]
fn writes_the_same_bytes_whatever_order_the_shards_are_named_in() {
    let (first, second) = two();
    let forward = combined(&[&first, &second]).unwrap();
    let backward = combined(&[&second, &first]).unwrap();
    assert_eq!(forward.bytes, backward.bytes);
    let again = combined(&[&forward.bytes]).unwrap();
    assert_eq!(again.bytes, forward.bytes, "a combined record combines to itself");
}

#[test]
fn unions_the_regions_of_a_module_two_shards_ran() {
    let (first, second) = two();
    let folded = combined(&[&second, &first]).unwrap();
    let (tests, modules) = fixture::read(&folded.bytes);
    let named: Vec<&str> = tests.iter().map(|(file, _, _)| file.as_str()).collect();
    assert_eq!(named, ["a.test.ts", "b.test.ts", "c.test.ts"]);
    assert_eq!(tests[0].2, Some(9));
    let shared = &modules.iter().find(|(file, _, _)| file == "src/shared.ts").unwrap().2;
    let regions: Vec<(u32, Vec<String>)> = shared.iter().map(|(ordinal, called, _)| (*ordinal, called.clone())).collect();
    assert_eq!(
        regions,
        [(0, files(&["a.test.ts", "b.test.ts", "c.test.ts"])), (1, files(&["c.test.ts"])), (2, files(&["a.test.ts"]))]
    );
    assert_eq!((folded.result.tests, folded.result.modules, folded.result.crossings), (3, 2, 6.0));
    // Each shard's files come back beside its path, in the order the shards were named.
    assert_eq!(folded.result.shards[0].files, files(&["c.test.ts"]));
    assert_eq!(folded.result.shards[1].files, files(&["a.test.ts", "b.test.ts"]));
    assert_eq!(folded.result.commit.as_deref(), Some("c0ffee"));
}

#[test]
fn refuses_a_test_file_two_shards_recorded() {
    let one = fixture::write(&spec(vec![test("a.test.ts")], Vec::new()));
    let other = fixture::write(&spec(vec![test("a.test.ts"), test("b.test.ts")], Vec::new()));
    assert!(refused(&[&one, &other]).contains("`a.test.ts` was recorded by"));
}

#[test]
fn refuses_shards_of_two_commits_or_two_recipes() {
    let at = |commit: Option<&'static str>, instrumentation: &'static str| {
        let mut held = spec(vec![test(if commit.is_some() { "a.test.ts" } else { "b.test.ts" })], Vec::new());
        held.commit = commit;
        held.instrumentation = instrumentation;
        fixture::write(&held)
    };
    // Shards at two commits started from two records: the build fails, naming both, in either order.
    for (first, second) in [(Some("c0ffee"), Some("beef")), (Some("beef"), Some("c0ffee")), (Some("c0ffee"), None)] {
        let message = refused(&[&at(first, "istanbul"), &at(second, "istanbul")]);
        assert!(message.starts_with("the build failed because the sharding was unstable"), "{message}");
        let named = |commit: Option<&str>| commit.map_or("no commit".to_owned(), |commit| format!("commit `{commit}`"));
        let started = format!("shard-0.bin started from {}, and shard-1.bin from {}.", named(first), named(second));
        assert!(message.contains(&started), "{message}");
    }
    let mut other = spec(vec![test("b.test.ts")], Vec::new());
    other.instrumentation = "v8";
    let message = refused(&[&at(Some("c0ffee"), "istanbul"), &fixture::write(&other)]);
    assert!(message.contains("disagree about the instrumentation"), "{message}");
}

#[test]
fn refuses_a_module_two_shards_built_from_different_text() {
    let mut changed = module("src/a.ts", vec![block(0, &[0])]);
    changed.source = "text-2";
    let one = fixture::write(&spec(vec![test("a.test.ts")], vec![module("src/a.ts", vec![block(0, &[0])])]));
    let other = fixture::write(&spec(vec![test("b.test.ts")], vec![changed]));
    assert!(refused(&[&one, &other]).contains("`src/a.ts` is different source in"));
}

#[test]
fn answers_a_module_from_the_shards_that_measured_it() {
    let mut unread = module("src/a.ts", vec![block(5, &[0])]);
    unread.instrumented = false;
    let unmeasured = fixture::write(&spec(vec![test("a.test.ts")], vec![unread]));
    let measured = fixture::write(&spec(vec![test("b.test.ts")], vec![module("src/a.ts", vec![block(0, &[0])])]));
    let (_, modules) = fixture::read(&combined(&[&unmeasured, &measured]).unwrap().bytes);
    assert_eq!(modules, [("src/a.ts".to_owned(), true, vec![(0, files(&["b.test.ts"]), Vec::new())])]);
    // Where no shard measured it, the shards' rows are one union all the same.
    let mut again = module("src/a.ts", vec![block(6, &[0])]);
    again.instrumented = false;
    let other = fixture::write(&spec(vec![test("b.test.ts")], vec![again]));
    let (_, modules) = fixture::read(&combined(&[&other, &unmeasured]).unwrap().bytes);
    let ordinals: Vec<u32> = modules[0].2.iter().map(|region| region.0).collect();
    assert_eq!((modules[0].1, ordinals), (false, vec![5, 6]));
}

#[test]
fn reads_the_untimed_layout_the_jvm_agent_writes() {
    let mut untimed = spec(vec![test("a.test.ts")], vec![module("src/a.ts", vec![block(0, &[0])])]);
    untimed.version = LAYOUT.coverage.untimed;
    let timed = spec(vec![test("b.test.ts")], vec![module("src/a.ts", vec![block(0, &[0])])]);
    let folded = combined(&[&fixture::write(&untimed), &fixture::write(&timed)]).unwrap();
    let (tests, _) = fixture::read(&folded.bytes);
    assert_eq!(tests, [("a.test.ts".to_owned(), true, None), ("b.test.ts".to_owned(), true, Some(9))]);
    assert_eq!(journey_columns::decode_any(&folded.bytes).unwrap().0, LAYOUT.coverage.format);
    // The agent chooses no tests from a record and lays its run over none, so it names none,
    // and two of its shards combine; one written before it named a base is refused.
    let mut jvm = spec(vec![test("b.test.ts")], vec![module("src/a.ts", vec![block(0, &[0])])]);
    jvm.version = LAYOUT.coverage.untimed;
    assert_eq!(combined(&[&fixture::write(&untimed), &fixture::write(&jvm)]).unwrap().result.shards.len(), 2);
    jvm.base = None;
    assert!(refused(&[&fixture::write(&untimed), &fixture::write(&jvm)]).contains("0.15.0 or earlier"));
}

#[test]
fn carries_each_test_files_phases_and_reads_the_layout_before_them_as_none_reported() {
    let none = LAYOUT.coverage.no_duration;
    let mut unphased = spec(vec![test("a.test.ts")], vec![module("src/a.ts", vec![block(0, &[0])])]);
    unphased.version = LAYOUT.coverage.unphased;
    let mut phased = spec(vec![test("b.test.ts")], vec![module("src/a.ts", vec![block(0, &[0])])]);
    phased.tests[0].phases = Some([4, none, 21, 530, 12]);
    let folded = combined(&[&fixture::write(&unphased), &fixture::write(&phased)]).unwrap();
    assert_eq!(fixture::phases(&folded.bytes), [("a.test.ts".to_owned(), [none; 5]), ("b.test.ts".to_owned(), [4, none, 21, 530, 12])]);
    assert_eq!(journey_columns::decode_any(&folded.bytes).unwrap().0, LAYOUT.coverage.format);
}

#[test]
fn refuses_a_version_or_a_section_this_build_does_not_read() {
    for version in [7, LAYOUT.coverage.format + 1] {
        let refused_version = refused(&[&journey_columns::encode(Vec::new(), version).unwrap()]);
        assert!(refused_version.contains(&format!("unsupported record version: {version}; this build reads versions 8, 9, 10, 11 and 12")), "{refused_version}");
    }
    let mut held = spec(vec![test("a.test.ts")], Vec::new());
    held.parts.push(("index", Vec::new()));
    let mut bytes = fixture::write(&held);
    // Rename the part to one no layout names, keeping the framing intact.
    let at = bytes.windows(5).position(|window| window == b"cases").unwrap();
    bytes[at..at + 5].copy_from_slice(b"caxes");
    assert!(refused(&[&bytes]).contains("a section this build does not know: caxes"));
}

#[test]
fn refuses_hostile_records_without_reading_past_them() {
    let good = fixture::write(&spec(vec![test("a.test.ts")], vec![module("src/a.ts", vec![block(0, &[0])])]));
    // Sections end on an 8-byte boundary, so a cut of eight bytes always reaches the data.
    for cut in [0, 3, 8, good.len() / 2, good.len() - 8] {
        assert!(combined(&[&good[..cut]]).is_err(), "a record cut at {cut} is refused");
    }
    let (_, decoded) = journey_columns::decode_any(&good).unwrap();
    let rewrite = |section: &'static str, values: Vec<u32>| {
        let mut columns: Vec<Column> = Vec::new();
        for name in &LAYOUT.coverage.sections {
            let name: &'static str = LAYOUT.coverage.sections.iter().find(|held| *held == name).unwrap().as_str();
            columns.push(if name == section {
                Column::Words(name, values.clone())
            } else if ["strings.blob", "sets.blob", "tests.complete", "modules.instrumented", "blocks.kind", "blocks.source"].contains(&name) {
                Column::Bytes(name, decoded.bytes(name).unwrap())
            } else {
                Column::Words(name, decoded.words(name).unwrap())
            });
        }
        columns.push(unbased());
        journey_columns::encode(columns, LAYOUT.coverage.format).unwrap()
    };
    for (section, values) in [
        ("tests.path", vec![u32::MAX]),
        ("blocks.set", vec![9]),
        ("modules.blocks", vec![0, 5]),
        ("strings.off", vec![0, 1, u32::MAX]),
        ("sets.off", vec![1]),
        ("tests.preconditions", vec![0]),
    ] {
        let message = refused(&[&rewrite(section, values)]);
        assert!(message.contains(section), "{section}: {message}");
    }
}

#[test]
fn folds_sets_of_every_spelling_and_width() {
    // Over the narrow limit a member takes four bytes; a run of consecutive
    // tests is stored as runs, a dense scatter as bits and a sparse one as a list.
    let count = LAYOUT.sets.narrow as u32 + 8;
    let names: Vec<&'static str> = (0..count).map(|at| &*Box::leak(format!("t{at:06}.test.ts").into_boxed_str())).collect();
    let (left, right) = names.split_at(names.len() / 2);
    let runs: Vec<u32> = (0..left.len() as u32).collect();
    let bits: Vec<u32> = (0..right.len() as u32).step_by(3).collect();
    let list = [1, right.len() as u32 - 1];
    let one = spec(left.iter().map(|name| test(name)).collect(), vec![module("src/a.ts", vec![block(0, &runs), block(1, &[2])])]);
    let other = spec(right.iter().map(|name| test(name)).collect(), vec![module("src/a.ts", vec![block(0, &bits), block(1, &list)])]);
    let (one, other) = (fixture::write(&one), fixture::write(&other));
    let folded = combined(&[&one, &other]).unwrap();
    assert_eq!(folded.bytes, combined(&[&other, &one]).unwrap().bytes);
    let (_, modules) = fixture::read(&folded.bytes);
    let mut expected: Vec<String> = left.iter().map(|name| (*name).to_owned()).collect();
    expected.extend(bits.iter().map(|at| right[*at as usize].to_owned()));
    assert_eq!(modules[0].2[0].1, expected);
    assert_eq!(modules[0].2[1].1, files(&[left[2], right[1], right[right.len() - 1]]));
}

fn cases(file: &str, runner: &str) -> Vec<u8> {
    index(file, runner, 1, Vec::new())
}

/// A case index whose one case of `file` called the first of `regions` regions of `src/a.ts`, with `lines` as its lines.
fn index(file: &str, runner: &str, regions: u32, lines: Vec<u8>) -> Vec<u8> {
    let tests = [Test {
        id: format!("{file} > adds"),
        file: file.to_owned(),
        name: "adds".to_owned(),
        project: None,
        runner: Some(runner.to_owned()),
        settled: FINISHED,
        heard: None,
    }];
    let regions_of = regions_in(regions);
    let mut sets = SetPool::new(1);
    let called: Vec<u32> = (0..regions).map(|at| if at == 0 { sets.intern(&[0]) } else { sets.intern(&[]) }).collect();
    let loaded = vec![false; regions as usize];
    let modules = [EncodedModule { module: &regions_of, called: &called, loaded: &loaded, overwritten: &[] }];
    let extras = CaseExtras { durations: Vec::new(), lines: if lines.is_empty() { Vec::new() } else { vec![lines] }, ..CaseExtras::default() };
    journey_format::encode(&tests, &extras, &modules, &mut sets, None).unwrap()
}

/// `src/a.ts` cut into `regions` functions, `f0` first.
fn regions_in(regions: u32) -> Module {
    Module {
        id: "src/a.ts".to_owned(),
        file: "src/a.ts".to_owned(),
        blocks: (0..regions)
            .map(|at| Block { kind: "function".to_owned(), name: format!("f{at}"), path: format!("f{at}"), start_line: at + 1, end_line: at + 1, source: true })
            .collect(),
        owners: None,
    }
}

fn last(commit: &str, files: &[&str], cases: &[&str]) -> Vec<u8> {
    let quoted = |values: &[&str]| values.iter().map(|value| format!("\"{value}\"")).collect::<Vec<_>>().join(",");
    format!("{{\"commit\":\"{commit}\",\"at\":\"2026-01-01T00:00:00.000Z\",\"files\":[{}],\"cases\":[{}]}}", quoted(files), quoted(cases)).into_bytes()
}

fn cased(file: &'static str, runner: &str) -> Spec {
    let mut held = spec(vec![test(file)], vec![module("src/a.ts", vec![block(0, &[0])])]);
    held.parts = vec![("index", cases(file, runner)), ("last", last("c0ffee", &[file], &[&format!("{file} > adds")]))];
    held
}

#[test]
fn folds_the_cases_beside_the_coverage_through_the_one_case_fold() {
    let (one, other) = (fixture::write(&cased("a.test.ts", "1")), fixture::write(&cased("b.test.ts", "1")));
    let folded = combined(&[&other, &one]).unwrap();
    assert_eq!(folded.bytes, combined(&[&one, &other]).unwrap().bytes);
    assert_eq!(folded.result.cases, Some(2));
    let record = record_coverage::read(&folded.bytes).unwrap();
    let last: serde_json::Value = serde_json::from_slice(record.parts.last.as_deref().unwrap()).unwrap();
    assert_eq!(last["files"], serde_json::json!(["a.test.ts", "b.test.ts"]));
    assert_eq!(last["cases"], serde_json::json!({"references": [0, 1]}));
    let index = case_shard::read_shard(record.parts.index.as_deref().unwrap(), &mut HashMap::new()).unwrap();
    assert_eq!(index.tests.iter().map(|test| test.id.as_str()).collect::<Vec<_>>(), vec!["a.test.ts > adds", "b.test.ts > adds"]);
}

#[test]
fn writes_a_record_of_cases_alone_when_no_shard_measured_coverage() {
    let alone = |file: &str| {
        let columns = vec![
            Column::Plain(LAYOUT.coverage.part("index"), cases(file, "1")),
            Column::Plain(LAYOUT.coverage.part("last"), last("c0ffee", &[file], &[])),
            unbased(),
        ];
        journey_columns::encode(columns, LAYOUT.coverage.format).unwrap()
    };
    let folded = combined(&[&alone("a.test.ts"), &alone("b.test.ts")]).unwrap();
    let record = record_coverage::read(&folded.bytes).unwrap();
    assert!(record.coverage.is_none());
    assert_eq!(folded.result.cases, Some(2));
    assert_eq!(folded.result.commit.as_deref(), Some("c0ffee"));
    // A shard that measured nothing names the files its last run ran, which the landing finishes.
    assert_eq!(folded.result.shards[1].files, files(&["b.test.ts"]));
    assert!(!folded.result.shards[1].measured);
}

/// The base part of a run that started from no record.
fn unbased() -> Column {
    Column::Plain(LAYOUT.coverage.part("base"), b"none".to_vec())
}

/// A record of `index` as its cases, and no coverage.
fn cases_alone(index: Vec<u8>, file: &str) -> Vec<u8> {
    let columns = vec![Column::Plain(LAYOUT.coverage.part("index"), index), Column::Plain(LAYOUT.coverage.part("last"), last("c0ffee", &[file], &[])), unbased()];
    journey_columns::encode(columns, LAYOUT.coverage.format).unwrap()
}

#[test]
fn refuses_shards_of_which_only_some_kept_cases() {
    let bare = fixture::write(&spec(vec![test("b.test.ts")], Vec::new()));
    let message = refused(&[&fixture::write(&cased("a.test.ts", "1")), &bare]);
    assert!(message.contains("shard-0.bin kept cases and shard-1.bin kept none"), "{message}");
    assert!(message.contains("so the combined record could answer for the cases of only some of its files, and the shards are not combined. Shards combine when every one kept cases, or none did."), "{message}");
    assert!(!message.split(|letter: char| !letter.is_alphabetic()).any(|word| word == "again"), "{message}");
}

#[test]
fn refuses_a_case_file_two_shards_ran_by_both_names_whatever_their_order() {
    let (one, other) = (cases_alone(cases("a.test.ts", "1"), "a.test.ts"), cases_alone(cases("a.test.ts", "2"), "a.test.ts"));
    for message in [refused(&[&one, &other]), refused(&[&other, &one])] {
        assert!(message.contains("`a.test.ts` has cases in shard-"), "{message}");
        assert!(message.contains("shard-0.bin") && message.contains("shard-1.bin"), "{message}");
        assert!(message.contains("combine only one of the two"), "{message}");
    }
}

#[test]
fn refuses_a_laid_shard_that_carries_a_case_another_shard_ran_whatever_their_order() {
    // A shard laid over a record carries the cases it did not run: here
    // `a.test.ts`'s, flagged at the region its edit wrote over. The shard that
    // ran that case saw it miss the region, which the fold cannot tell from
    // the carried flag, so a test file two shards hold is refused before it.
    let tests: Vec<Test> = ["a.test.ts", "b.test.ts"]
        .iter()
        .map(|file| Test { id: format!("{file} > adds"), file: (*file).to_owned(), name: "adds".to_owned(), project: None, runner: Some("1".to_owned()), settled: FINISHED, heard: None })
        .collect();
    let regions_of = regions_in(2);
    let mut sets = SetPool::new(2);
    let (called, overwritten) = ([sets.intern(&[1]), sets.intern(&[])], [sets.intern(&[]), sets.intern(&[0])]);
    let modules = [EncodedModule { module: &regions_of, called: &called, loaded: &[false, false], overwritten: &overwritten }];
    let laid = cases_alone(journey_format::encode(&tests, &CaseExtras::default(), &modules, &mut sets, None).unwrap(), "b.test.ts");
    let ran = cases_alone(index("a.test.ts", "1", 2, Vec::new()), "a.test.ts");
    for message in [refused(&[&laid, &ran]), refused(&[&ran, &laid])] {
        assert!(message.contains("`a.test.ts` has cases in shard-"), "{message}");
        assert!(message.contains("combine only one of the two"), "{message}");
    }
}

#[test]
fn refuses_an_index_it_cannot_read_with_the_reader_s_own_reason() {
    let message = refused(&[&cases_alone(vec![0xff; 16], "a.test.ts")]);
    let reason = case_shard::read_shard(&[0xff; 16], &mut HashMap::new()).err().unwrap();
    assert_eq!(message, format!("cannot read the case index of shard-0.bin: {reason}"));
}

#[test]
fn refuses_lines_on_a_file_two_shards_cut_differently_by_the_shard_and_the_file() {
    // One case's lines: two values, one segment on module 0, one run.
    let lines = vec![2, 4, 5, 0, 1, 0, 1, 1];
    let one = cases_alone(index("a.test.ts", "1", 2, lines), "a.test.ts");
    let other = cases_alone(index("b.test.ts", "1", 3, Vec::new()), "b.test.ts");
    let message = refused(&[&one, &other]);
    assert!(message.starts_with("shard-0.bin: case \"a.test.ts > adds\": its lines stand on `src/a.ts`"), "{message}");
    assert!(message.ends_with("so they name regions the combined record does not hold, and the shards are not combined. Shards combine when one build recorded every one, so each cuts the file the same way."), "{message}");
    assert!(!message.split(|letter: char| !letter.is_alphabetic()).any(|word| word == "Record"), "{message}");
}

#[test]
fn a_record_that_is_not_there_is_refused_by_name() {
    let missing = std::env::temp_dir().join(format!("variance-combine-missing-{}.bin", std::process::id()));
    let path = missing.to_string_lossy().into_owned();
    let error = combine(&[path.clone()], None).err().expect("the combine is refused");
    assert_eq!(error, format!("there is no record at {path}"));
}

#[test]
fn an_empty_shard_changes_nothing_whatever_it_says_of_its_run() {
    // A shard whose runner was handed no test files: no tests, no cases, another
    // commit and recipe, which it did not run under.
    let mut empty = spec(Vec::new(), Vec::new());
    empty.commit = Some("beef");
    empty.instrumentation = "v8";
    let empty = fixture::write(&empty);
    let cased_one = fixture::write(&cased("a.test.ts", "1"));
    let alone = combined(&[&cased_one]).unwrap();
    for shards in [[empty.as_slice(), cased_one.as_slice()], [cased_one.as_slice(), empty.as_slice()]] {
        let folded = combined(&shards).unwrap();
        assert_eq!(folded.bytes, alone.bytes);
        assert_eq!(folded.result.commit.as_deref(), Some("c0ffee"));
    }
    let (first, second) = two();
    assert_eq!(combined(&[&first, &empty, &second]).unwrap().bytes, combined(&[&first, &second]).unwrap().bytes);
}

#[test]
fn a_shard_that_measured_nothing_at_no_commit_disagrees_with_nobody() {
    // Its last run names no commit: the run was made outside one, and says
    // nothing against the commit the measured shard names.
    let unnamed = br#"{"at":"2026-01-01T00:00:00.000Z","files":["b.test.ts"],"cases":[]}"#.to_vec();
    let alone = journey_columns::encode(
        vec![Column::Plain(LAYOUT.coverage.part("index"), cases("b.test.ts", "1")), Column::Plain(LAYOUT.coverage.part("last"), unnamed), unbased()],
        LAYOUT.coverage.format,
    )
    .unwrap();
    let measured = fixture::write(&cased("a.test.ts", "1"));
    for shards in [[measured.as_slice(), alone.as_slice()], [alone.as_slice(), measured.as_slice()]] {
        let folded = combined(&shards).unwrap();
        assert_eq!(folded.result.commit.as_deref(), Some("c0ffee"));
        let last: serde_json::Value = serde_json::from_slice(record_coverage::read(&folded.bytes).unwrap().parts.last.as_deref().unwrap()).unwrap();
        assert_eq!((&last["commit"], &last["files"]), (&serde_json::json!("c0ffee"), &serde_json::json!(["a.test.ts", "b.test.ts"])));
    }
}

#[test]
fn a_record_whose_last_run_measured_nothing_at_a_later_commit_combines_as_it_is() {
    // A run that instrumented nothing, laid over a record, leaves the coverage
    // where it stood and writes its own commit into the last-run layer. The
    // record is one run's coverage and a later run's cases, and stays so.
    let mut held = cased("a.test.ts", "1");
    held.parts[1] = ("last", last("beef", &["a.test.ts"], &["a.test.ts > adds"]));
    let folded = combined(&[&fixture::write(&held)]).unwrap();
    assert_eq!(folded.result.commit.as_deref(), Some("c0ffee"));
    let last: serde_json::Value = serde_json::from_slice(record_coverage::read(&folded.bytes).unwrap().parts.last.as_deref().unwrap()).unwrap();
    assert_eq!(last["commit"], serde_json::json!("beef"));
}

#[test]
fn refuses_a_combine_of_no_records() {
    assert_eq!(refused(&[]), "no records were named to combine");
}

/// `cased(file)` with `before` as its before layer.
fn based(file: &'static str, before: Vec<u8>) -> Vec<u8> {
    let mut held = cased(file, "1");
    held.parts.push(("before", before));
    fixture::write(&held)
}

#[test]
fn fails_the_build_when_one_shard_found_no_record_and_another_found_one() {
    // A shard job that restored no record split the suite against no plan,
    // and one that restored the record split it against that record's: a test
    // may have run in neither. The build fails, naming both, in either order.
    let mut found = cased("a.test.ts", "1");
    found.parts = vec![
        ("index", cases("a.test.ts", "1")),
        ("last", br#"{"commit":"c0ffee","before":"beef","at":"1","files":["a.test.ts"],"cases":["a.test.ts > adds"]}"#.to_vec()),
        ("before", cases("a.test.ts", "1")),
    ];
    let mut began = cased("b.test.ts", "1");
    began.parts[1] = ("last", br#"{"commit":"c0ffee","at":"1","files":["b.test.ts"],"began":true,"cases":["b.test.ts > adds"]}"#.to_vec());
    let (found, began) = (fixture::write(&found), fixture::write(&began));
    for (records, started) in [
        ([&began, &found], "shard-0.bin started from no record, and shard-1.bin from the before layer of commit `beef`."),
        ([&found, &began], "shard-0.bin started from the before layer of commit `beef`, and shard-1.bin from no record."),
    ] {
        let message = refused(&[records[0], records[1]]);
        assert!(message.starts_with("the build failed because the sharding was unstable: "), "{message}");
        assert!(message.contains(started), "{message}");
    }
}

#[test]
fn refuses_a_before_layer_it_cannot_read_with_the_reader_s_own_reason() {
    let message = refused(&[&based("a.test.ts", vec![0xff; 16]), &based("b.test.ts", cases("b.test.ts", "1"))]);
    let reason = case_shard::read_shard(&[0xff; 16], &mut HashMap::new()).err().unwrap();
    assert_eq!(message, format!("cannot read the before layer of shard-0.bin: {reason}"));
}

#[test]
fn refuses_a_last_run_layer_this_build_cannot_read_by_its_shard() {
    let mut held = cased("a.test.ts", "1");
    held.parts[1] = ("last", b"{\"files\":3}".to_vec());
    let message = refused(&[&fixture::write(&held)]);
    assert!(message.starts_with("shard-0.bin: its last-run layer is not one this build reads: "), "{message}");
}
