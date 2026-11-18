//! Two writers updating one index at once, as two `variance` processes do in
//! one checkout: whichever publishes second read the chain before the first
//! published, and has to publish over what the first wrote, not be refused.

// compass: variance-authority.reach.source-index

use std::path::Path;
use std::sync::Barrier;

use crate::change_tree::disk_tree;
use crate::source_update::{UpdateOptions, Updated};

fn options(root: &Path, index: &Path) -> UpdateOptions {
    let extensions: Vec<String> = [".ts", ".js"].map(String::from).to_vec();
    UpdateOptions {
        root: root.to_string_lossy().into_owned(),
        index: index.to_string_lossy().into_owned(),
        config: "writers".to_owned(),
        largest_file: None,
        readers: None,
        tsconfig: None,
        condition_names: None,
        aliases: None,
        builtins: Vec::new(),
        code_extensions: extensions.clone(),
        readable: extensions,
        stores: None,
        packs: Some(false),
    }
}

#[test]
fn two_writers_that_read_one_chain_both_publish() {
    let base = std::env::temp_dir().join(format!("sense-writers-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    let (root, index) = (base.join("root"), base.join("index").join("index.bin"));
    std::fs::create_dir_all(&root).unwrap();
    std::fs::create_dir_all(index.parent().unwrap()).unwrap();
    let root = std::fs::canonicalize(root).unwrap();
    std::fs::write(root.join("a.ts"), "import { b } from './b';\nexport const a = b;\n").unwrap();
    for round in 0..8 {
        std::fs::write(root.join("b.ts"), format!("export const b = {round};\n")).unwrap();
        let barrier = Barrier::new(2);
        let done: Vec<Updated> = std::thread::scope(|scope| {
            let writers: Vec<_> = (0..2)
                .map(|_| {
                    scope.spawn(|| {
                        let tree = disk_tree(root.to_string_lossy().into_owned(), vec![String::new()]);
                        barrier.wait();
                        tree.update_index(options(&root, &index)).unwrap()
                    })
                })
                .collect();
            writers.into_iter().map(|writer| writer.join().unwrap()).collect()
        });
        for updated in &done {
            assert_eq!(updated.refused, None, "round {round}");
            assert_eq!(updated.files, 2, "round {round}");
        }
    }
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn a_configuration_changed_alone_is_published() {
    let base = std::env::temp_dir().join(format!("sense-configured-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    let (root, index) = (base.join("root"), base.join("index").join("index.bin"));
    std::fs::create_dir_all(&root).unwrap();
    std::fs::create_dir_all(index.parent().unwrap()).unwrap();
    let root = std::fs::canonicalize(root).unwrap();
    std::fs::write(root.join("a.ts"), "export const a = 1;\n").unwrap();
    let update = |config: &str| {
        let tree = disk_tree(root.to_string_lossy().into_owned(), vec![String::new()]);
        tree.update_index(UpdateOptions { config: config.to_owned(), ..options(&root, &index) }).unwrap()
    };
    update("before");
    assert!(update("after").published, "the new configuration is published though no record differs");
    let chain = crate::index_chain::read_chain(&index.to_string_lossy()).unwrap().unwrap();
    let last = crate::compact::Layer::open(chain.segments.last().unwrap()).unwrap();
    assert_eq!(last.config, Some("after"), "the next update reads the configuration it was made under");
    assert!(!update("after").published, "and finds nothing to publish");
    let _ = std::fs::remove_dir_all(&base);
}
