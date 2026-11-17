use super::*;
use crate::segment::{encode_as, u32s, u8s, Collected, Strings, NONE};

fn graph(targets: Vec<u32>) -> Vec<u8> {
    let mut strings = Strings::of(Collected::from_iter(["a.ts", "dir/b.ts", "dir/c.ts", "unresolved"]));
    let [blob, off] = strings.columns();
    encode_as("variance-authority-source-tree", 2, vec![blob, off,
        u32s("files.path", ["a.ts", "dir/b.ts", "dir/c.ts"].map(|path| strings.id(path)).to_vec()),
        u32s("files.unknown", vec![NONE, NONE, strings.id("unresolved")]),
        u32s("edges.offset", vec![0, 2, 3, 3]), u32s("edges.target", targets),
        u8s("edges.kind", vec![3, 2, 0]),
    ])
}

#[test]
fn paths_distances_chains_and_unknowns_are_queried_without_reconstructing_records() {
    let reader = SourceTreeReader::open(graph(vec![1, 2, 2])).unwrap();
    assert_eq!(reader.files(), ["a.ts", "dir/b.ts", "dir/c.ts"]);
    let walk = reader.walk(vec!["a.ts".into()], false, false);
    assert_eq!(walk.files(), ["a.ts", "dir/b.ts", "dir/c.ts"]);
    assert_eq!(walk.distances(), [0, 1, 1]);
    let chain = reader.walk(vec!["dir/c.ts".into()], true, false).chain("a.ts".into());
    assert_eq!(chain.iter().map(|step| (step.file.as_str(), step.kind.as_deref())).collect::<Vec<_>>(), [("a.ts", Some("dynamic")), ("dir/c.ts", None)]);
    assert_eq!(reader.unknown_among(vec!["a.ts".into(), "dir/c.ts".into()]), ["dir/c.ts"]);
    assert!(reader.walk(vec!["missing.ts".into()], false, false).files().is_empty());
}

#[test]
fn weighted_walk_keeps_half_hops_separate_from_import_distance() {
    let reader = SourceTreeReader::open(graph(vec![1, 2, 2])).unwrap();
    assert_eq!(reader.walk(vec!["a.ts".into()], false, true).distances(), [0, 2, 2]);
    let reverse = reader.walk(vec!["dir/c.ts".into()], true, true);
    assert_eq!(reverse.distances(), [2, 2, 0]);
}

#[test]
fn malformed_edges_are_refused_at_open() {
    assert!(SourceTreeReader::open(graph(vec![1, 3, 2])).is_err());
}
