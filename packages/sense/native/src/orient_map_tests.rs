//! The code map folded from a chain published the way the scan publishes one:
//! four families of packages that import inside the family, and one road from
//! the server family into the interface family's core.

use std::collections::HashSet;
use std::path::PathBuf;

use super::{carried, fold, map_path, orient_map_page, uncarried as prepare_orient_map};
use crate::compact::Layer;
use crate::generation::Delta;
use crate::graph_index::merged;
use crate::index_chain::read_chain;
use crate::orient_map_read::read;

/// No part may take more than a third of what it splits, so four families of five.
const FAMILIES: [&str; 4] = ["ui", "server", "data", "tools"];
const MEMBERS: usize = 5;

struct Fixture(PathBuf);

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// `packages/<family>/<family>N`, named `@t/<family>-N`; member 0 is the core.
fn packages() -> Vec<(String, String)> {
    FAMILIES
        .iter()
        .flat_map(|family| (0..MEMBERS).map(move |n| (format!("packages/{family}/{family}{n}"), format!("@t/{family}-{n}"))))
        .collect()
}

fn fixture(name: &str) -> (Fixture, Vec<String>) {
    let root = std::env::temp_dir().join(format!("sense-orient-map-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let mut paths = vec!["package.json".to_owned()];
    let mut write = |path: &str, text: &str| {
        let file = root.join(path);
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(file, text).unwrap();
    };
    write("package.json", r#"{"private": true}"#);
    for (directory, name) in packages() {
        write(&format!("{directory}/package.json"), &format!(r#"{{"name": "{name}"}}"#));
        write(&format!("{directory}/src/index.ts"), "export const make = 1;\n");
        paths.push(format!("{directory}/package.json"));
        paths.push(format!("{directory}/src/index.ts"));
    }
    paths.sort_by(|a, b| crate::order::code_unit(a, b));
    (Fixture(root), paths)
}

fn publish(index: &str) {
    let (mut records, mut parses) = (Vec::new(), Vec::new());
    for (at, (directory, _)) in packages().iter().enumerate() {
        let family = FAMILIES[at / MEMBERS];
        let n = at % MEMBERS;
        let file = format!("{directory}/src/index.ts");
        let digest = format!("d{at}");
        // Each member takes every member before it; the server core takes the interface core.
        let mut takes: Vec<(String, String)> = Vec::new();
        for m in 0..n {
            takes.push((format!("packages/{family}/{family}{m}/src/index.ts"), format!("@t/{family}-{m}")));
        }
        if family == "server" && n == 0 {
            takes.push(("packages/ui/ui0/src/index.ts".to_owned(), "@t/ui-0".to_owned()));
        }
        let targets: Vec<String> = takes.iter().map(|(target, _)| format!("\"{target}\"")).collect();
        records.push(format!(
            r#"["{file}", {{"record": {{"file": "{file}", "digest": "{digest}"}}, "witnesses": [], "targets": [{}]}}]"#,
            targets.join(", ")
        ));
        let requests: Vec<String> = takes
            .iter()
            .map(|(_, value)| {
                format!(r#"{{"value": "{value}", "kind": "imports", "line": 1, "bindings": [{{"imported": "make", "local": "make", "type": false, "line": 1}}]}}"#)
            })
            .collect();
        parses.push(format!(r#"["{digest}\u0000.ts\u0000+", {{"requests": [{}]}}]"#, requests.join(", ")));
    }
    let document = format!(r#"{{"records": [{}], "parses": [{}], "deletedRecords": [], "deletedParses": []}}"#, records.join(", "), parses.join(", "));
    let segment = merged(&[], &Delta::of(vec![document]).unwrap());
    crate::log::publish(index, &[], &[&segment], &[]).unwrap();
}

fn stored(name: &str) -> (Fixture, String, super::Stored) {
    let (root, paths) = fixture(name);
    let index = root.0.join("source-index.bin").to_string_lossy().into_owned();
    publish(&index);
    let chain = read_chain(&index).unwrap().expect("a published chain");
    let layers: Vec<Layer> = chain.segments.iter().map(|bytes| Layer::open(bytes).unwrap()).collect();
    let read = read(&root.0.to_string_lossy(), &layers, Some(&paths), HashSet::new);
    let (made, pages, placed) = fold(&read).ok().expect("named packages to fold");
    let digest = super::manifest_digest(&index).unwrap();
    let stored = super::Stored { format: super::FORMAT, index: digest, listed: None, unmarked: false, made: Some(made), unmade: None, pages, placed };
    (root, index, stored)
}

#[test]
fn four_families_fold_into_four_areas_and_the_road_between_them() {
    let (_root, _, stored) = stored("families");
    let top = &stored.pages[0];
    assert_eq!((top.id.as_str(), top.packages, top.files, top.alone), ("", 20, 20, 0));
    // Each member takes every member before it, and the server core takes the interface core.
    assert_eq!((stored.made.unwrap().layers, top.low, top.high), (6, 1, 6));
    let rows: Vec<(&str, &str, u32)> = top.rows.iter().map(|row| (row.id.as_str(), row.name.as_str(), row.packages)).collect();
    assert_eq!(
        rows,
        [("1", "packages/data/ data", 5), ("2", "packages/server/ server", 5), ("3", "packages/tools/ tools", 5), ("4", "packages/ui/ ui", 5)]
    );
    // Inside a family nothing crosses a line; the one road lands on the interface core.
    let (server, ui) = (&top.rows[1], &top.rows[3]);
    assert_eq!((server.outgoing, &server.uses[..]), (1, &[("4".to_owned(), 1)][..]));
    assert_eq!((ui.incoming, &ui.front[..], ui.more), (1, &[("@t/ui-0".to_owned(), 1)][..], 0));
    assert_eq!((server.low, server.high, server.median), (2, 6, 4));
    // An area with no areas inside it lists its packages.
    let leaf = stored.pages.iter().find(|page| page.id == "4").unwrap();
    assert!(leaf.rows.is_empty());
    assert_eq!(leaf.list, ["@t/ui-0", "@t/ui-1", "@t/ui-2", "@t/ui-3", "@t/ui-4"]);
}

#[test]
fn the_same_index_folds_into_the_same_bytes() {
    let (_a, _, first) = stored("again-a");
    let (_b, _, second) = stored("again-b");
    let (mut first, mut second) = (first, second);
    first.index.clear();
    second.index.clear();
    assert_eq!(serde_json::to_string(&first).unwrap(), serde_json::to_string(&second).unwrap());
}

#[test]
fn a_page_reads_back_and_says_when_the_index_has_moved() {
    let (_root, index, stored) = stored("pages");
    assert!(orient_map_page(index.clone(), None).unwrap().is_none(), "no map is kept before one is written");
    std::fs::write(map_path(&index), serde_json::to_vec(&stored).unwrap()).unwrap();
    let top = orient_map_page(index.clone(), None).unwrap().expect("a kept map");
    assert!(top.current);
    assert_eq!(top.page.expect("the top page").rows.len(), 4);
    assert!(orient_map_page(index.clone(), Some("1".to_owned())).unwrap().unwrap().page.is_some());
    assert!(orient_map_page(index.clone(), Some("9.9".to_owned())).unwrap().unwrap().page.is_none());
    // A map of another format is no map, whatever the rest of it holds.
    std::fs::write(map_path(&index), br#"{"format": 1, "pages": {}}"#).unwrap();
    assert!(orient_map_page(index.clone(), None).unwrap().is_none());
    std::fs::write(map_path(&index), serde_json::to_vec(&stored).unwrap()).unwrap();
    // Republishing writes a new manifest; the map kept beside it is now older than it.
    std::fs::write(&index, b"moved").unwrap();
    assert!(!orient_map_page(index, None).unwrap().unwrap().current);
}

/// A fixture with its source index published beside it.
fn indexed(name: &str) -> (Fixture, String, String) {
    let (root, _) = fixture(name);
    let index = root.0.join("source-index.bin").to_string_lossy().into_owned();
    publish(&index);
    let at = root.0.to_string_lossy().into_owned();
    (root, at, index)
}

fn git(root: &str, arguments: &[&str]) {
    let status = std::process::Command::new("git").arg("-C").arg(root).args(arguments).status().unwrap();
    assert!(status.success(), "git {arguments:?}");
}

fn inode(path: &str) -> u64 {
    std::os::unix::fs::MetadataExt::ino(&std::fs::metadata(path).unwrap())
}

#[test]
fn outside_git_the_map_is_folded_from_the_indexed_files_and_the_manifests_beside_them() {
    let (_root, root, index) = indexed("walked");
    // A scan that could not list with git: the map asks git nothing either.
    let prepared = prepare_orient_map(&root, &index, Some(true)).unwrap().expect("an index");
    assert!(prepared.walked && !prepared.unmarked && !prepared.relisted && prepared.unmade.is_none());
    let map = prepared.map.expect("a folded map");
    assert_eq!((map.packages, map.areas, map.levels, map.layers, map.unread), (20, 4, 1, 6, 0));
    assert!(orient_map_page(index, None).unwrap().expect("a kept map").current);
}

#[test]
fn every_package_reads_back_with_its_layer_and_what_it_takes() {
    let (_root, root, index) = indexed("placed");
    prepare_orient_map(&root, &index, Some(true)).unwrap().expect("an index");
    let answer = crate::orient_map::orient_layers(index).unwrap().expect("a kept map");
    assert!(answer.current && answer.unmade.is_none());
    let packages = answer.packages.expect("a folded map");
    let layer = |name: &str| packages.iter().find(|package| package.package == name).unwrap();
    // A package that takes nothing is layer 1; each member takes every member before it.
    assert_eq!((layer("@t/data-0").layer, layer("@t/data-0").takes.len()), (1, 0));
    assert_eq!((layer("@t/data-4").layer, layer("@t/data-4").takes.len()), (5, 4));
    // The server core also takes the interface core, whose own layer is 1.
    assert_eq!(layer("@t/server-0").takes, ["@t/ui-0"]);
    assert_eq!(layer("@t/server-0").layer, 2);
    assert_eq!(packages.iter().map(|package| package.layer).max(), Some(6));
}

#[test]
fn a_checkout_with_nothing_to_fold_says_why_and_keeps_no_map() {
    let (fixture, root, index) = indexed("unmade");
    assert!(prepare_orient_map(&root, &index, None).unwrap().unwrap().map.is_some());
    for (directory, _) in packages() {
        std::fs::write(fixture.0.join(directory).join("package.json"), "{}").unwrap();
    }
    std::fs::write(fixture.0.join("package.json"), r#"{"name": "@t/root"}"#).unwrap();
    let prepared = prepare_orient_map(&root, &index, None).unwrap().unwrap();
    assert_eq!((prepared.map.is_none(), prepared.unmade.as_deref()), (true, Some("the root's is the only named manifest")));
    let answer = orient_map_page(index.clone(), None).unwrap().expect("the reason, kept beside the index");
    assert_eq!((answer.page.is_none(), answer.layers, answer.unmade.as_deref()), (true, None, Some("the root's is the only named manifest")));
    std::fs::write(fixture.0.join("package.json"), "{}").unwrap();
    let prepared = prepare_orient_map(&root, &index, None).unwrap().unwrap();
    assert_eq!(prepared.unmade.as_deref(), Some("no manifest names a package"));
}

#[test]
fn in_git_an_unchanged_index_and_unchanged_manifests_keep_the_map_unfolded() {
    let (fixture, root, index) = indexed("kept");
    git(&root, &["init", "-q"]);
    git(&root, &["add", "-A"]);
    // The listing the scan took is carried; git is not asked again.
    let scanned = crate::git_tree(root.clone()).expect("a checkout");
    let first = carried(&scanned, &root, &index).unwrap().unwrap();
    assert!(!first.walked && !first.relisted && first.map.is_some());
    let folded = inode(&map_path(&index));
    let again = carried(&scanned, &root, &index).unwrap().unwrap();
    assert_eq!(inode(&map_path(&index)), folded, "nothing moved, so nothing was written");
    assert_eq!(again.map.map(|map| (map.packages, map.areas)), Some((20, 4)));
    // With no scan to carry, git lists the checkout for the map, and says so.
    let alone = prepare_orient_map(&root, &index, None).unwrap().unwrap();
    assert!(alone.relisted && !alone.walked);
    assert_eq!(inode(&map_path(&index)), folded);
    // A manifest git holds a new blob for folds the map again.
    std::fs::write(fixture.0.join("packages/ui/ui1/package.json"), r#"{"name": "@t/ui-1", "private": true}"#).unwrap();
    git(&root, &["add", "-A"]);
    carried(&crate::git_tree(root.clone()).unwrap(), &root, &index).unwrap().unwrap();
    assert_ne!(inode(&map_path(&index)), folded);
}
