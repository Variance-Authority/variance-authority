//! Native selection keeps runtime edges, moved names and per-test shadows together.

use super::*;
use super::build::{SelectionGraphOptions, SelectionTaint};
use super::walk::{SelectionMoved, SelectionWalkOptions};

fn fixture(name: &str, files: &[(&str, &[u8])], taints: Vec<SelectionTaint>) -> (std::path::PathBuf, SelectionGraph) {
    let root = crate::git_fixture::repository(name, files);
    let index = root.join("cache/index.bin");
    let tree = crate::git_tree_for(root.to_string_lossy().into_owned(), vec!["src".into()]).unwrap();
    tree.update_index(crate::source_update::UpdateOptions {
        root: root.to_string_lossy().into_owned(), index: index.to_string_lossy().into_owned(),
        config: "fixture".into(), largest_file: None, readers: None, packs: None, prepare_map: None,
        tsconfig: None, condition_names: None, aliases: None,
        builtins: Vec::new(), code_extensions: vec![".ts".into()], readable: vec![".ts".into()], stores: None,
    }).unwrap().unwrap();
    let opened = crate::help_publish::open_index(index.to_string_lossy().into_owned()).unwrap();
    let graph = selection_graph_of(&opened, SelectionGraphOptions {
        root: root.to_string_lossy().into_owned(), raw: None, dirs: vec!["src".into()], before: Vec::new(),
        code: vec![".ts".into()], builtins: Vec::new(), tsconfig: None, taints, depends: Vec::new(),
    }).unwrap().unwrap();
    (root, graph)
}

fn reach(graph: &SelectionGraph, file: &str, names: Option<Vec<&str>>, shadows: bool) -> walk::SelectionWalk {
    graph.walk(SelectionWalkOptions {
        seeds: vec![SelectionNode { kind: "file".into(), name: file.into() }], reverse: true,
        through: Some(KINDS.iter().filter(|&&kind| kind != "type").map(|kind| (*kind).into()).collect()),
        avoid: Vec::new(), moved: names.map(|names| vec![SelectionMoved {
            file: file.into(), names: names.into_iter().map(str::to_owned).collect(),
        }]).unwrap_or_default(), shadows,
    })
}

#[test]
fn selection_graph_runtime_walk_excludes_type_imports_and_each_tests_mock_cut() {
    let (root, graph) = fixture("selection-runtime-shadows", &[
        ("src/value.ts", b"export const value = 1;\n"),
        ("src/live.test.ts", b"import { value } from './value'; console.log(value);\n"),
        ("src/mocked.test.ts", b"import { value } from './value'; vi.mock('./value'); console.log(value);\n"),
        ("src/types.test.ts", b"import type { value } from './value';\n"),
    ], Vec::new());
    let reached = reach(&graph, "src/value.ts", None, true);
    assert_eq!(reached.nodes.iter().map(|node| node.name.as_str()).collect::<Vec<_>>(), vec!["src/live.test.ts", "src/value.ts"]);
    assert_eq!(reached.shadowed, vec!["src/mocked.test.ts"]);
    assert_eq!(graph.shadowed(vec!["src/mocked.test.ts".into()]), vec![vec!["src/value.ts".to_owned()]]);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn selection_graph_moved_names_flow_through_renames_and_exclude_default_from_stars() {
    let (root, graph) = fixture("selection-moved-names", &[
        ("src/value.ts", b"export const value = 1; export const other = 2; export default 3;\n"),
        ("src/barrel.ts", b"export { value as renamed } from './value'; export * from './value';\n"),
        ("src/renamed.test.ts", b"import { renamed } from './barrel'; console.log(renamed);\n"),
        ("src/other.test.ts", b"import { other } from './barrel'; console.log(other);\n"),
        ("src/default.test.ts", b"import value from './barrel'; console.log(value);\n"),
    ], Vec::new());
    let reached = reach(&graph, "src/value.ts", Some(vec!["value"]), false);
    assert_eq!(reached.nodes.iter().map(|node| node.name.as_str()).collect::<Vec<_>>(), vec!["src/barrel.ts", "src/renamed.test.ts", "src/value.ts"]);
    let reached = reach(&graph, "src/value.ts", Some(vec!["default"]), false);
    assert_eq!(reached.nodes.iter().map(|node| node.name.as_str()).collect::<Vec<_>>(), vec!["src/value.ts"]);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn selection_graph_taint_additions_use_whole_edge_provenance() {
    let (root, graph) = fixture("selection-taint-provenance", &[
        ("src/value.ts", b"export const value = 1; export const other = 2;\n"),
        ("src/live.test.ts", b"import { other } from './value'; console.log(other);\n"),
    ], vec![SelectionTaint { file: "src/live.test.ts".into(), plus: vec!["./value".into()], minus: Vec::new() }]);
    let reached = reach(&graph, "src/value.ts", Some(vec!["value"]), false);
    assert_eq!(reached.nodes.iter().map(|node| node.name.as_str()).collect::<Vec<_>>(), vec!["src/live.test.ts", "src/value.ts"]);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn journey_selection_queries_the_existing_native_graph_with_its_runtime_mock_rules() {
    let (root, graph) = fixture("journey-native-graph", &[
        ("src/value.ts", b"export const value = 1;\n"),
        ("src/live.test.ts", b"import { value } from './value'; console.log(value);\n"),
        ("src/mocked.test.ts", b"import { value } from './value'; vi.mock('./value'); console.log(value);\n"),
        ("src/types.test.ts", b"import type { value } from './value';\n"),
    ], Vec::new());
    let journey = crate::journey_graph::Graph::native(&graph);
    assert_eq!(journey.importers("src/value.ts").unwrap(), vec!["src/live.test.ts", "src/value.ts"]);
    assert!(journey.importers("missing.ts").is_none());
    std::fs::remove_dir_all(root).unwrap();
}
