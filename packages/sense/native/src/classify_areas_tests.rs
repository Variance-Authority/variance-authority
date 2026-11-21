//! The areas a request's words point to: directories of at most a bounded
//! number of files `HEAD` holds, each scored by the request's stems its path,
//! its file names and the names its files declare hold, the rarer stem
//! counting for more.

use std::collections::HashMap;

use super::*;

fn ranked(query: &str, paths: &[String], declared: &DeclaredWords, most: u32) -> Vec<RankedArea> {
    let paths: Vec<&str> = paths.iter().map(String::as_str).collect();
    rank(&code_words(query), &paths, declared, most)
}

fn files_under(directory: &str, names: &[&str]) -> Vec<String> {
    names.iter().map(|name| format!("{directory}/{name}")).collect()
}

fn owned(paths: &[&str]) -> Vec<String> {
    paths.iter().map(|path| (*path).to_owned()).collect()
}

fn paths() -> Vec<String> {
    [
        files_under("x-pack/plugins/task_manager/server", &["task_pool.ts", "task_claimer.ts", "index.ts"]),
        files_under("x-pack/plugins/alerting/server", &["rule_runner.ts", "index.ts", "task_runner.ts"]),
        files_under("src/core/server", &["index.ts", "server.ts", "restart.ts"]),
    ]
    .concat()
}

fn words(words: &[(&str, u64)]) -> DeclaredWords {
    DeclaredWords { holding: BTreeMap::new(), words: words.iter().map(|&(file, held)| (file.to_owned(), held)).collect() }
}

fn path_words(areas: &[RankedArea]) -> Vec<(&str, Vec<&str>)> {
    areas.iter().map(|area| (area.path.as_str(), area.words.iter().map(String::as_str).collect())).collect()
}

fn path_list(areas: &[RankedArea]) -> Vec<&str> {
    areas.iter().map(|area| area.path.as_str()).collect()
}

#[test]
fn keeps_feature_words_from_directories_below_the_selected_area() {
    let paths = owned(&["tools/src/migrations/alpha-to-beta/index.ts", "tools/src/migrations/alpha-to-beta/transform.ts", "ui/src/index.ts"]);
    let areas = ranked("alpha beta", &paths, &DeclaredWords::default(), 2);

    assert_eq!(path_words(&areas), vec![("tools", vec!["alpha", "beta"])]);
    let reversed: Vec<String> = paths.iter().rev().cloned().collect();
    assert_eq!(areas, ranked("alpha beta", &reversed, &DeclaredWords::default(), 2));
}

#[test]
fn counts_a_directory_once_even_when_it_contains_several_files() {
    // Stop-word basenames add no vocabulary, so another sibling only changes the file count.
    let paths = [owned(&["tools/alpha/the.ts", "tools/alpha/and.ts"]), files_under("ui", &["one.ts", "two.ts", "three.ts"])].concat();
    let before = ranked("alpha", &paths, &DeclaredWords::default(), 3);
    let after = ranked("alpha", &[paths, owned(&["tools/alpha/of.ts"])].concat(), &DeclaredWords::default(), 3);

    assert_eq!(before[0].words, vec!["alpha"]);
    assert_eq!(after[0].score, before[0].score);
    assert_eq!(after[0].files, 3);
}

#[test]
fn ranks_first_the_directory_whose_path_and_file_names_hold_the_words_none_a_declared_name() {
    let areas = ranked("Fix task manager claiming tasks twice after a restart", &paths(), &DeclaredWords::default(), 2);

    assert_eq!(areas[0].path, "x-pack/plugins/task_manager/server");
    // The words lead with the one that weighs most there: `manager`, rare and in the path, before
    // `task`, in the path and two file names but also beside it, before `claiming`, in one file name.
    assert_eq!(areas[0].words, vec!["manager", "task", "claiming"]);
    assert_eq!(areas[0].files, 3);
}

#[test]
fn splits_a_directory_holding_more_than_the_bound_into_its_children() {
    let areas = ranked("alerting rule runner", &paths(), &DeclaredWords::default(), 4);

    assert!(path_list(&areas).contains(&"x-pack/plugins/alerting"));
    assert!(!path_list(&areas).contains(&"x-pack/plugins"));
}

#[test]
fn counts_the_names_a_directorys_files_declare() {
    let mut declaring = words(&[("src/core/server/server.ts", 1)]);
    declaring.holding.insert("restart".to_owned(), HashMap::from([("src/core/server/server.ts".to_owned(), 1)]));

    let without = ranked("server restart", &paths(), &DeclaredWords::default(), 3);
    let with_names = ranked("server restart", &paths(), &declaring, 3);

    assert_eq!(with_names[0].path, "src");
    assert!(with_names[0].score > without[0].score);
}

#[test]
fn weighs_a_word_less_in_an_area_that_holds_more_words_as_many_files_as_it_has() {
    let paths = [files_under("alpha", &["restart.ts", "other.ts"]), files_under("beta", &["restart.ts", "other.ts"])].concat();
    // `alpha`'s files declare many names, so its one `restart` is a smaller share of what it says.
    let declared = words(&[("alpha/other.ts", 40)]);

    assert_eq!(path_list(&ranked("restart", &paths, &declared, 2)), vec!["beta", "alpha"]);
}

#[test]
fn ranks_the_same_on_every_run_ties_in_code_unit_order_of_the_path() {
    // Two areas alike in every count tie, and the earlier path in code-unit order ranks first.
    let paths = [files_under("b", &["restart.ts", "other.ts"]), files_under("a", &["restart.ts", "other.ts"])].concat();
    let one = ranked("restart", &paths, &DeclaredWords::default(), 2);

    assert_eq!(one, ranked("restart", &paths, &DeclaredWords::default(), 2));
    assert_eq!(one[0].score, one[1].score);
    assert_eq!(path_list(&one), vec!["a", "b"]);
}

#[test]
fn says_which_areas_hold_a_file_the_source_index_read_a_name_from() {
    let paths = [files_under("docs/task", &["claiming.md"]), files_under("src/task", &["claimer.ts"])].concat();
    let declared = words(&[("src/task/claimer.ts", 2)]);

    let areas = ranked("task claiming", &paths, &declared, 1);
    let declares: HashMap<&str, bool> = areas.iter().map(|area| (area.path.as_str(), area.declares)).collect();

    assert_eq!(declares, HashMap::from([("docs", false), ("src", true)]));
}

#[test]
fn ranks_nothing_for_a_request_with_no_word_to_describe() {
    assert_eq!(ranked("a the of", &paths(), &DeclaredWords::default(), 3), vec![]);
}

#[test]
fn shows_at_most_ten_areas() {
    let paths: Vec<String> = (0..12).map(|area| format!("area{area:02}/restart.ts")).collect();

    assert_eq!(ranked("restart", &paths, &DeclaredWords::default(), 1).len(), 10);
}

/// One case the JavaScript ranking this replaced answered, before it was removed.
#[derive(serde::Deserialize)]
struct Golden {
    query: String,
    paths: Vec<String>,
    holding: BTreeMap<String, HashMap<String, u64>>,
    words: HashMap<String, u64>,
    most: u32,
    areas: Vec<GoldenArea>,
}

#[derive(serde::Deserialize)]
struct GoldenArea {
    path: String,
    files: u32,
    words: Vec<String>,
    score: u32,
    declares: bool,
}

#[test]
fn ranks_as_the_javascript_ranking_it_replaced() {
    // Written by `rankedAreas` in `packages/help/src/tools/classify-areas.ts`
    // at 6356fad4e, over generated trees, before it was removed.
    let cases: Vec<Golden> = serde_json::from_str(include_str!("classify_areas_golden.json")).expect("the golden cases read");
    assert!(!cases.is_empty());
    for (at, case) in cases.iter().enumerate() {
        let declared = DeclaredWords { holding: case.holding.clone(), words: case.words.clone() };
        let found = ranked(&case.query, &case.paths, &declared, case.most);
        let expected: Vec<RankedArea> = case
            .areas
            .iter()
            .map(|area| RankedArea { path: area.path.clone(), files: area.files, words: area.words.clone(), score: area.score, declares: area.declares })
            .collect();
        assert_eq!(found, expected, "case {at}: {:?}", case.query);
    }
}

#[test]
fn source_trees_read_packages_extensions_and_tests_as_containment_did() {
    let packages: HashSet<&str> = ["packages/a", "packages/a/nested"].into_iter().collect();

    assert_eq!(package_owner(&packages, "packages/a/nested/src/x.ts"), "packages/a/nested");
    assert_eq!(package_owner(&packages, "packages/a/src/x.ts"), "packages/a");
    assert_eq!(package_owner(&packages, "tools/x.ts"), ".");
    assert_eq!(extension("src/.eslintrc"), "");
    assert_eq!(extension("src/a.b/file"), "");
    assert_eq!(extension("src/x.test.ts"), ".ts");
    let tests = TestPaths::new();
    for test in ["src/x.test.ts", "a/__tests__/x.ts", "a/Tests/x.ts", "x_test.go", "test_x.py", "a/FooTest.java", "spec/x_spec.rb", "a/fixtures/x.ts"] {
        assert!(tests.holds(test), "{test} is a test");
    }
    for source in ["src/x.ts", "src/latest.ts", "src/contest/x.ts", "Test.java"] {
        assert!(!tests.holds(source), "{source} is no test");
    }
}
