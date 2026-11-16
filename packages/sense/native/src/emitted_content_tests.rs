//! The content proof and explicit boundaries of an active source listing.

use std::sync::Arc;
use oxc_resolver::FileSystem;
use super::Emitted;


#[test]
fn tracked_configuration_readers_share_the_listed_blob_bytes() {
    let root = crate::git_fixture::repository("listed-configuration-bytes", &[
        ("package.json", br#"{"name":"listed"}"#),
        ("tsconfig.base.json", br#"{"compilerOptions":{"customConditions":["listed"]}}"#),
        ("tsconfig.json", br#"{"extends":"./tsconfig.base.json","compilerOptions":{"baseUrl":"./listed"}}"#),
    ]);
    let tree = crate::git_tree::git_tree(root.to_str().unwrap().to_owned()).unwrap();
    let scan = Emitted::listed_for(&root, Some(tree.listing()), true);
    // Every consumer must use the tree it was handed, without reopening the
    // tracked configurations or requiring their files still to be present.
    for file in ["package.json", "tsconfig.base.json", "tsconfig.json"] {
        std::fs::remove_file(root.join(file)).unwrap();
    }
    assert_eq!(scan.read(&root.join("package.json")).unwrap(), br#"{"name":"listed"}"#);
    assert_eq!(scan.configs.custom_conditions(&root.join("tsconfig.json")), Some(vec!["listed".to_owned()]));
    assert_eq!(tree.aliases_in(tree.named(Vec::new())).unwrap().bases, vec!["listed"]);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn changed_symbolic_and_outside_configuration_bytes_keep_their_boundary() {
    let root = crate::git_fixture::repository("listed-configuration-boundaries", &[
        ("tsconfig.json", br#"{"compilerOptions":{"customConditions":["committed"]}}"#),
        ("tsconfig.target.json", br#"{"compilerOptions":{"customConditions":["target"]}}"#),
    ]);
    std::os::unix::fs::symlink("tsconfig.target.json", root.join("tsconfig.link.json")).unwrap();
    crate::git_fixture::commit(&root);
    crate::git_fixture::write(&root, "tsconfig.json", br#"{"compilerOptions":{"customConditions":["dirty"]}}"#);
    let tree = crate::git_tree::git_tree(root.to_str().unwrap().to_owned()).unwrap();
    let scan = Emitted::listed_for(&root, Some(tree.listing()), true);
    // A changed path's object name is an identity, not a proof of a stored
    // regular-file blob. The link also names its target rather than JSON.
    crate::git_fixture::write(&root, "tsconfig.json", br#"{"compilerOptions":{"customConditions":["later"]}}"#);
    assert_eq!(scan.configs.custom_conditions(&root.join("tsconfig.json")), Some(vec!["later".to_owned()]));
    assert_eq!(scan.configs.custom_conditions(&root.join("tsconfig.link.json")), Some(vec!["target".to_owned()]));
    assert_eq!(Emitted::default().read(&root.join("tsconfig.json")).unwrap(), scan.read(&root.join("tsconfig.json")).unwrap());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_config_transformed_by_git_is_not_read_as_its_clean_blob() {
    let root = crate::git_fixture::repository("listed-filtered-configuration", &[(".gitattributes", b"*.json filter=config-test\n")]);
    crate::git_fixture::git(&root, &["config", "filter.config-test.clean", "sed s/worktree/blob/g"]);
    crate::git_fixture::git(&root, &["config", "filter.config-test.smudge", "sed s/blob/worktree/g"]);
    let bytes = br#"{"compilerOptions":{"customConditions":["worktree"],"baseUrl":"./worktree"}}"#;
    crate::git_fixture::write(&root, "tsconfig.json", bytes);
    crate::git_fixture::commit(&root);
    assert!(crate::git_fixture::git(&root, &["show", "HEAD:tsconfig.json"]).contains("blob"));
    let tree = crate::git_tree::git_tree(root.to_str().unwrap().to_owned()).unwrap();
    assert!(tree.regular[*tree.at.get("tsconfig.json").unwrap() as usize]);
    let scan = Emitted::listed_for(&root, Some(tree.listing()), true);
    assert_eq!(scan.read(&root.join("tsconfig.json")).unwrap(), bytes);
    assert_eq!(scan.configs.custom_conditions(&root.join("tsconfig.json")), Some(vec!["worktree".to_owned()]));
    assert_eq!(tree.aliases_in(tree.named(Vec::new())).unwrap().bases, vec!["worktree"]);
    std::fs::remove_dir_all(root).unwrap();
}


#[test]
fn an_unreadable_indexed_blob_does_not_fall_back_to_its_worktree_file() {
    let root = crate::git_fixture::repository("listed-missing-configuration-blob", &[("package.json", br#"{"name":"on-disk"}"#)]);
    let mut tree = crate::git_tree::git_tree(root.to_str().unwrap().to_owned()).unwrap();
    tree.oids = Arc::new(vec![[0; 20]; tree.oids.len()]);
    let scan = Emitted::listed_for(&root, Some(tree.listing()), true);
    assert!(root.join("package.json").is_file());
    assert!(scan.read(&root.join("package.json")).is_err(), "an unreadable known blob is not permission to open its file");
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn explicit_worktree_reads_keep_the_namespace_and_do_not_open_blobs() {
    let root = crate::git_fixture::repository("listed-worktree-policy", &[("package.json", br#"{"name":"listed"}"#)]);
    let tree = crate::git_tree::git_tree(root.to_str().unwrap().to_owned()).unwrap();
    let scan = Emitted::listed_for(&root, Some(tree.listing()), false);
    crate::git_fixture::write(&root, "package.json", br#"{"name":"later"}"#);
    assert_eq!(scan.read(&root.join("package.json")).unwrap(), br#"{"name":"later"}"#);
    std::fs::remove_file(root.join("package.json")).unwrap();
    assert!(scan.metadata(&root.join("package.json")).unwrap().is_file(), "the namespace proof is still shared");
    assert!(scan.read(&root.join("package.json")).is_err(), "an explicit worktree read never opens a blob");
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn configuration_eol_rules_keep_the_raw_worktree_bytes() {
    let root = crate::git_fixture::repository("listed-config-eol", &[
        (".gitattributes", b"*.json text eol=crlf\n"),
        ("tsconfig.json", b"{\n  \"compilerOptions\": {}\n}\n"),
    ]);
    let tree = crate::git_tree::git_tree(root.to_str().unwrap().to_owned()).unwrap();
    assert!(tree.regular[*tree.at.get("tsconfig.json").unwrap() as usize]);
    let scan = Emitted::listed_for(&root, Some(tree.listing()), true);
    let checkout = b"{\r\n  \"compilerOptions\": {}\r\n}\r\n";
    crate::git_fixture::write(&root, "tsconfig.json", checkout);
    assert_eq!(scan.read(&root.join("tsconfig.json")).unwrap(), checkout, "JSON interpretation cannot waive a raw-byte difference");
    std::fs::remove_dir_all(root).unwrap();
}


#[test]
fn package_ownership_reads_the_active_indexed_manifest_bytes() {
    let root = crate::git_fixture::repository("listed-package-owner", &[
        ("package.json", br#"{"name":"listed","dependencies":{"external":"*"}}"#),
        ("src/index.ts", b"export {};\n"),
    ]);
    let tree = crate::git_tree::git_tree(root.to_str().unwrap().to_owned()).unwrap();
    let listing = tree.listing();
    std::fs::remove_file(root.join("package.json")).unwrap();
    let owners = crate::package_owners::owners_from(root.to_str().unwrap(), &tree.paths, Some(&listing));
    assert_eq!(owners.package_of("src/index.ts"), "listed");
    assert_eq!(owners.packages[0].depends, vec!["external"]);
    assert!(crate::package_owners::owners(root.to_str().unwrap(), &tree.paths).packages.is_empty());
    std::fs::remove_dir_all(root).unwrap();
}
