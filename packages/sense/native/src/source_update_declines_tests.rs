//! Refusal identities and the closure beyond Git's inventory.

use super::options;
use crate::git_fixture::{repository, write};

#[test]
fn an_untracked_size_refusal_is_kept_only_while_its_named_file_is_still_oversized() {
    let root = repository("source-size-untracked-reuse", &[("src/base.ts", b"export {};\n")]);
    write(&root, "src/large.ts", b"export const value = 'this exceeds the size limit';\n");
    let index = root.join("cache/index.bin");
    let mut opts = options(&root, &index, "size-refusal");
    opts.largest_file = Some(16);
    let tree = || crate::git_tree_for(opts.root.clone(), vec!["src".into()]).unwrap();
    assert_eq!(tree().update_index(opts.clone()).unwrap().unwrap().reread, 2);
    assert_eq!(tree().update_index(opts.clone()).unwrap().unwrap().reread, 0);
    write(&root, "src/large.ts", b"export {};\n");
    assert_eq!(tree().update_index(opts.clone()).unwrap().unwrap().reread, 1);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn an_explicit_import_reaches_an_ignored_oversized_file_without_inventory_identity() {
    let root = repository("source-size-ignored-closure", &[
        (".gitignore", b"src/generated/\n"),
        ("src/a.ts", b"import './generated/bundle.js';\n"),
    ]);
    write(&root, "src/generated/bundle.js", b"export const bundle = 'this exceeds the size limit';\n");
    let index = root.join("cache/index.bin");
    let mut opts = options(&root, &index, "ignored-closure");
    opts.largest_file = Some(40);
    opts.code_extensions.push(".js".into()); opts.readable.push(".js".into());
    let tree = || crate::git_tree_for(opts.root.clone(), vec!["src".into()]).unwrap();
    let first = tree().update_index(opts.clone()).unwrap().unwrap();
    assert_eq!((first.files, first.reread, first.parsed), (2, 2, 1));
    assert_eq!(tree().update_index(opts).unwrap().unwrap().reread, 1);
    std::fs::remove_dir_all(root).unwrap();
}
