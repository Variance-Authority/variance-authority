//! What a path says to `containment`: its package, its tree, whether it is a
//! test or source, and the trees of `HEAD` that hold source.

use super::*;
use crate::git_fixture;

fn kinds() -> PathKinds {
    path_kinds(vec!["packages/a".into(), "packages/a/nested".into(), "packages/test".into()], vec![".ts".into(), ".go".into()])
}

#[test]
fn reads_a_path_by_the_deepest_package_its_extension_and_the_test_rule() {
    let kinds = kinds();
    assert_eq!(kinds.owner("packages/a/nested/src/x.ts".into()), "packages/a/nested");
    assert_eq!(kinds.owner("packages/a/src/x.ts".into()), "packages/a");
    assert_eq!(kinds.owner("tools/x.ts".into()), ".");
    assert_eq!(extension("src/.eslintrc"), "");
    assert_eq!(extension("src/a.b/file"), "");
    assert_eq!(extension("src/x.test.ts"), ".ts");
    for test in ["src/x.test.ts", "a/__tests__/x.ts", "a/Tests/x.ts", "x_test.go", "test_x.py", "a/FooTest.java", "spec/x_spec.rb", "a/fixtures/x.ts"] {
        assert!(is_test_path(test), "{test} is a test");
    }
    for source in ["src/x.ts", "src/latest.ts", "src/contest/x.ts", "Test.java"] {
        assert!(!is_test_path(source), "{source} is no test");
    }
    let kind = |owner: &str, tree: &str, test: bool, source: bool| PathKind { owner: owner.into(), tree: tree.into(), test, source };
    assert_eq!(
        kinds.of(vec!["packages/test/src/x.ts".into(), "packages/a/src/x.test.ts".into(), "tools/x.md".into(), "README.ts".into()]),
        vec![
            // A package named `test` is not its own test: the rule reads the path inside it.
            kind("packages/test", "packages/test", false, true),
            kind("packages/a", "packages/a", true, false),
            kind(".", "tools", false, false),
            kind(".", ".", false, true),
        ],
    );
}

#[test]
fn lists_the_trees_of_head_that_hold_source_and_names_what_git_refused() {
    let root = git_fixture::repository(
        "source-trees",
        &[("packages/a/src/x.ts", b"x\n"), ("packages/a/nested/x.test.ts", b"x\n"), ("e2e/x.ts", b"x\n"), ("tools/x.go", b"x\n"), ("docs/x.md", b"x\n")],
    );
    let read = kinds().source_trees(root.to_string_lossy().into_owned());
    assert_eq!((read.trees, read.refused), (vec!["packages/a".to_owned(), "tools".to_owned()], None));

    let bare = std::env::temp_dir().join(format!("sense-source-trees-none-{}", std::process::id()));
    std::fs::create_dir_all(&bare).unwrap();
    let refused = kinds().source_trees(bare.to_string_lossy().into_owned()).refused.expect("a refusal");
    assert!(refused.starts_with("`git ls-tree -r -z --name-only HEAD` said: fatal: not a git repository"), "{refused}");
    let _ = std::fs::remove_dir_all(&root);
    let _ = std::fs::remove_dir_all(&bare);
}
