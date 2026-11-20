use super::*;
use crate::segment::{encode_as, u32s, u8s, Collected, Strings};

/// A tree of `paths`, sorted, with `edges` as (from, to, kind) and `unknown` paths flagged.
fn tree_of(paths: &[&str], edges: &[(&str, &str, &str)], unknown: &[&str]) -> Vec<u8> {
    let mut paths = paths.to_vec();
    paths.sort_by(|left, right| code_unit(left, right));
    let mut collected = Collected::default();
    collected.extend(paths.iter().copied());
    collected.insert("unreadable");
    let mut strings = Strings::of(collected);
    let at = |path: &str| paths.iter().position(|known| *known == path).unwrap() as u32;
    let (mut offsets, mut targets, mut kinds) = (vec![0u32], Vec::new(), Vec::new());
    for &from in &paths {
        let mut row: Vec<(u32, u8)> = edges
            .iter()
            .filter(|edge| edge.0 == from)
            .map(|edge| (at(edge.1), EDGE_KINDS.iter().position(|kind| *kind == edge.2).unwrap() as u8))
            .collect();
        row.sort_unstable();
        row.dedup();
        targets.extend(row.iter().map(|edge| edge.0));
        kinds.extend(row.iter().map(|edge| edge.1));
        offsets.push(targets.len() as u32);
    }
    let reasons = paths.iter().map(|path| strings.optional(unknown.contains(path).then_some("unreadable"))).collect();
    let [blob, off] = strings.columns();
    let ids = paths.iter().map(|path| strings.id(path)).collect();
    encode_as(FORMAT, VERSION, vec![
        blob, off,
        u32s("files.path", ids),
        u32s("files.unknown", reasons),
        u32s("edges.offset", offsets),
        u32s("edges.target", targets),
        u8s("edges.kind", kinds),
    ])
}

fn open(bytes: &[u8], workspace: &str) -> SourceTree {
    SourceTree { graph: Arc::new(Graph::read(bytes, workspace).unwrap()) }
}

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| value.to_string()).collect()
}

fn sample() -> Vec<u8> {
    tree_of(
        &["a.ts", "b.ts", "c.ts", "d.ts", "lone.ts"],
        &[("a.ts", "b.ts", "imports"), ("b.ts", "c.ts", "type"), ("b.ts", "c.ts", "reexports"), ("a.ts", "d.ts", "type"), ("d.ts", "c.ts", "imports")],
        &["d.ts"],
    )
}

#[test]
fn a_forward_walk_reaches_every_import_once_at_its_shortest_distance() {
    let tree = open(&sample(), "");
    let walk = tree.walk(strings(&["a.ts"]), false, None);
    assert_eq!(walk.files(), strings(&["a.ts", "b.ts", "c.ts", "d.ts"]));
    assert_eq!(walk.depths(), vec![0, 1, 2, 1]);
    assert_eq!(walk.count(), 4);
    assert_eq!(walk.distance("lone.ts".into()), None);
}

#[test]
fn a_chain_leads_back_to_the_seed_and_names_the_kind_that_is_not_a_type() {
    let tree = open(&sample(), "");
    let walk = tree.walk(strings(&["c.ts"]), true, None);
    let chain = walk.chain("a.ts".into());
    let said: Vec<(String, Option<String>)> = chain.into_iter().map(|link| (link.file, link.kind)).collect();
    assert_eq!(said, vec![("a.ts".into(), Some("imports".into())), ("b.ts".into(), Some("reexports".into())), ("c.ts".into(), None)]);
    assert_eq!(walk.trail("a.ts".into()), strings(&["c.ts", "b.ts", "a.ts"]));
}

#[test]
fn an_avoided_file_is_never_entered() {
    let tree = open(&sample(), "");
    let walk = tree.walk(strings(&["a.ts"]), false, Some(strings(&["b.ts"])));
    assert_eq!(walk.files(), strings(&["a.ts", "c.ts", "d.ts"]));
    let edges: Vec<(String, String)> = walk.edges_into(strings(&["b.ts", "c.ts"])).into_iter().map(|edge| (edge.from, edge.to)).collect();
    assert_eq!(edges, vec![("a.ts".into(), "b.ts".into()), ("d.ts".into(), "c.ts".into())]);
}

#[test]
fn a_workspace_below_the_root_sees_its_own_files_and_walks_the_whole_graph() {
    let bytes = tree_of(&["app/x.ts", "app/y.ts", "lib/z.ts"], &[("app/x.ts", "lib/z.ts", "imports"), ("lib/z.ts", "app/y.ts", "imports")], &["app/y.ts", "lib/z.ts"]);
    let tree = open(&bytes, "app");
    assert_eq!(tree.size(), 2);
    assert!(tree.has("x.ts".into()));
    assert!(!tree.has("lib/z.ts".into()));
    assert_eq!(tree.paths(0, 10), strings(&["x.ts", "y.ts"]));
    assert_eq!(tree.paths(1, 10), strings(&["y.ts"]));
    assert_eq!(tree.unknown_files(), strings(&["app/y.ts"]));
    assert_eq!(tree.unknown_among(strings(&["lib/z.ts", "app/x.ts", "gone.ts"])), strings(&["lib/z.ts"]));
    let walk = tree.walk(strings(&["x.ts"]), false, None);
    assert_eq!(walk.files(), strings(&["app/x.ts", "app/y.ts", "lib/z.ts"]));
}

#[test]
fn a_start_point_names_a_file_its_folder_or_the_files_directly_in_it() {
    let bytes = tree_of(&["src/a.ts", "src/deep/b.ts", "src.ts", "srcx/c.ts"], &[], &[]);
    let tree = open(&bytes, "");
    assert_eq!(tree.entries("src/a.ts".into(), "file".into()), strings(&["src/a.ts"]));
    assert_eq!(tree.entries("src".into(), "file".into()), strings(&["src/a.ts", "src/deep/b.ts"]));
    assert_eq!(tree.entries("src/".into(), "under".into()), strings(&["src/a.ts", "src/deep/b.ts"]));
    assert_eq!(tree.entries("src/*".into(), "own".into()), strings(&["src/a.ts"]));
    assert!(tree.entries("".into(), "under".into()).is_empty());
}

#[test]
fn a_tree_whose_columns_disagree_is_refused() {
    let mut collected = Collected::default();
    collected.insert("a.ts");
    let mut strings = Strings::of(collected);
    let id = strings.id("a.ts");
    let [blob, off] = strings.columns();
    let bytes = encode_as(FORMAT, VERSION, vec![
        blob, off,
        u32s("files.path", vec![id]),
        u32s("files.unknown", vec![NONE]),
        u32s("edges.offset", vec![0, 1]),
        u32s("edges.target", vec![7]),
        u8s("edges.kind", vec![0]),
    ]);
    assert!(Graph::read(&bytes, "").is_err());
}
