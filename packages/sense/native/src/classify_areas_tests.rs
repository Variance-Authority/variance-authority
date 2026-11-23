//! The areas a request's words point to: directories of at most a bounded
//! number of files the published source index holds, each scored by the request's stems its path,
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
fn weighs_a_word_the_same_in_an_area_however_many_other_words_it_holds() {
    let paths = [files_under("alpha", &["restart.ts", "other.ts"]), files_under("beta", &["restart.ts", "other.ts"])].concat();
    // `alpha`'s files declare many names: more subjects, not fewer words for `restart`.
    let declared = words(&[("alpha/other.ts", 40)]);
    let areas = ranked("restart", &paths, &declared, 2);

    assert_eq!(path_list(&areas), vec!["alpha", "beta"]);
    assert_eq!(areas[0].score, areas[1].score);
}

#[test]
fn ranks_first_the_long_area_that_alone_holds_the_rarest_words() {
    // The shape of nodejs/node: `lib` declares many names, so it is long, and only it holds
    // `translators` and `finalizeEsmResolution`; the test and fixture areas are short, and their
    // file names repeat the request's common words.
    let paths = [
        files_under("lib/internal/modules/esm", &["translators.js", "resolve.js", "loader.js", "module_job.js"]),
        files_under("lib/internal/modules", &["run_main.js"]),
        files_under("test/es-module", &["test-esm-loader-cjs.mjs", "test-esm-cjs-main.js", "test-esm-loader-module-job.mjs", "test-esm-cjs-interop.js"]),
        files_under("test/fixtures/es-modules", &["cjs-esm.js", "loader-main.mjs", "esm-cjs-run.mjs", "module-loader.mjs"]),
        files_under("test/fixtures/es-module-loaders", &["loader-esm.mjs", "loader-cjs.mjs", "module-wrap-loader.mjs"]),
    ]
    .concat();
    let mut declared = words(&[
        ("lib/internal/modules/esm/translators.js", 400),
        ("lib/internal/modules/esm/resolve.js", 400),
        ("lib/internal/modules/esm/loader.js", 400),
        ("lib/internal/modules/esm/module_job.js", 400),
        ("lib/internal/modules/run_main.js", 400),
    ]);
    for stem in ["finaliz", "resolution"] {
        declared.holding.insert(stem.to_owned(), HashMap::from([("lib/internal/modules/esm/resolve.js".to_owned(), 1)]));
    }

    let query = "ESM loader CJS-ESM interop ModuleLoader finalizeEsmResolution translators ModuleJob run_main ModuleWrap";
    assert_eq!(ranked(query, &paths, &declared, 5)[0].path, "lib");
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

/// One generated tree, its request and the areas it ranks.
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
fn ranks_the_generated_trees_as_recorded() {
    // The trees and requests were written by `rankedAreas` in
    // `packages/help/src/tools/classify-areas.ts` at 6356fad4e, before it was
    // removed; the areas were recorded again when an area's length stopped
    // discounting its words.
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
fn ranks_the_published_inventory_without_a_checkout() {
    use crate::generation::Delta;
    use crate::graph_index::merged;
    use crate::help_store::{encode_help_store, HelpStore};
    let directory = std::env::temp_dir().join(format!("sense-classify-snapshot-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&directory);
    std::fs::create_dir_all(&directory).unwrap();
    let index = directory.join("index.bin").to_str().unwrap().to_owned();
    let base = merged(&[], &Delta::of(vec![r#"{"records":[["app/task/old.ts",{"record":{"file":"app/task/old.ts","digest":"git:a"},"witnesses":[],"targets":[]}],["other/task.ts",{"record":{"file":"other/task.ts","digest":"git:b"},"witnesses":[],"targets":[]}]]}"#.to_owned()]).unwrap());
    let newer = merged(&[], &Delta::of(vec![r#"{"deletedRecords":["app/task/old.ts"],"records":[["app/task/new.ts",{"record":{"file":"app/task/new.ts","digest":"git:c"},"witnesses":[],"targets":[]}]]}"#.to_owned()]).unwrap());
    assert!(crate::log::written(&index, crate::log::Over::Nothing, &[], &[&base, &newer], &[], 0).unwrap());
    let store = encode_help_store(HelpStore { packages: vec![], deep: vec![], by_path: vec![], unfollowed: vec![], unreadable: vec![] }, vec![], None);
    let answer = classify_areas(directory.join("no-checkout").to_str().unwrap().to_owned(), "task old new".to_owned(), vec![vec![], vec![], vec![]], Some(store.bytes.to_vec().into()), index.clone(), "app".to_owned(), false, None, None).unwrap();
    assert_eq!(answer.refused, None, "classification must not ask git for files");
    assert_eq!(answer.areas.len(), 1);
    assert_eq!(answer.areas[0].files, 1);
    assert_eq!(answer.areas[0].words.iter().cloned().collect::<std::collections::BTreeSet<_>>(), ["new".to_owned(), "task".to_owned()].into_iter().collect());
    use crate::segment::{encode_as, u32s, u8s, Collected, Strings};
    let mut collected = Collected::default();
    collected.extend(["app/task/new.ts", "other/task.ts"]);
    let mut strings = Strings::of(collected);
    let ids = vec![strings.id("app/task/new.ts"), strings.id("other/task.ts")];
    let [blob, off] = strings.columns();
    let graph = encode_as(crate::source_tree::FORMAT, crate::source_tree::VERSION, vec![blob, off, u32s("files.path", ids), u32s("files.unknown", vec![NONE, NONE]), u32s("edges.offset", vec![0, 0, 0]), u32s("edges.target", vec![]), u8s("edges.kind", vec![])]);
    let tree = crate::source_query::open_source_tree(graph.into(), "app".to_owned()).unwrap();
    let walk = tree.walk(vec!["task/new.ts".to_owned()], false);
    let scoped = classify_areas("/no-checkout".to_owned(), "task old new".to_owned(), vec![vec![], vec![], vec![]], Some(store.bytes.to_vec().into()), index.clone(), "app".to_owned(), true, Some(&walk), None).unwrap();
    assert_eq!(scoped.areas, answer.areas);
    assert_eq!(scoped.reached, 1);
    let refused_scope = classify_areas("/no-checkout".to_owned(), "task old new".to_owned(), vec![vec![], vec![], vec![]], Some(store.bytes), index, "app".to_owned(), true, None, None).unwrap();
    assert!(refused_scope.areas.is_empty());
    std::fs::remove_dir_all(directory).unwrap();
}
