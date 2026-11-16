//! The rule, against a workspace on disk and against a listing git would give.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use oxc_resolver::FileSystem;

use super::{Emitted, Listing};
use crate::resolve::{Resolvers, Tsconfig};

fn write(root: &Path, files: &[(&str, &str)]) {
    for (path, text) in files {
        let at = root.join(path);
        std::fs::create_dir_all(at.parent().unwrap()).unwrap();
        std::fs::write(at, text).unwrap();
    }
}

fn workspace(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("sense-emitted-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    let root = std::fs::canonicalize(root).unwrap();
    write(&root, &[
        ("package.json", r#"{ "private": true, "workspaces": ["packages/*"] }"#),
        ("tsconfig.base.json", r#"{ "compilerOptions": { "outDir": "${configDir}/dist" } }"#),
        ("packages/a/package.json", r#"{ "name": "@s/a" }"#),
        ("packages/a/src/x.ts", "import '@s/b';\n"),
        ("packages/b/package.json", r#"{ "name": "@s/b", "exports": {
            ".": "./dist/index.js", "./sub": "./dist/sub/index.js",
            "./data": "./dist/data.json", "./esm": "./dist/esm/index.js", "./*": "./dist/*.js" } }"#),
        ("packages/b/tsconfig.json", r#"{ "extends": "../../tsconfig.base.json",
            "compilerOptions": { "rootDir": "./src" } }"#),
        ("packages/b/tsconfig.esm.json", r#"{ "compilerOptions": { "outDir": "./dist/esm", "rootDir": "./src" } }"#),
        ("packages/b/src/index.ts", "export {};\n"),
        ("packages/b/src/sub/index.ts", "export {};\n"),
        ("packages/b/src/tool.tsx", "export {};\n"),
        ("packages/b/src/data.json", "{}\n"),
        ("packages/c/package.json", r#"{ "name": "@s/c", "exports": "./dist/index.js" }"#),
        ("packages/c/tsconfig.json", r#"{ "compilerOptions": { "outDir": "./dist" } }"#),
        ("packages/c/src/index.ts", "export {};\n"),
        ("tsconfig.check.json", r#"{ "extends": "./tsconfig.base.json", "compilerOptions": { "noEmit": true } }"#),
        ("packages/d/package.json", r#"{ "name": "@s/d", "exports": "./dist/index.js" }"#),
        ("packages/d/tsconfig.json", r#"{ "extends": "../../tsconfig.check.json",
            "compilerOptions": { "rootDir": "." } }"#),
        ("packages/d/tsconfig.build.json", r#"{ "extends": "../../tsconfig.check.json",
            "compilerOptions": { "noEmit": false, "rootDir": "./src" } }"#),
        ("packages/d/src/index.ts", "export {};\n"),
        ("node_modules/@p/lib/package.json", r#"{ "name": "@p/lib", "exports": "./dist/index.js" }"#),
        ("node_modules/@p/lib/tsconfig.json", r#"{ "compilerOptions": { "outDir": "./dist", "rootDir": "./src" } }"#),
        ("node_modules/@p/lib/dist/index.js", "export {};\n"),
    ]);
    for name in ["b", "c", "d"] {
        std::fs::create_dir_all(root.join("node_modules/@s")).unwrap();
        std::os::unix::fs::symlink(format!("../../packages/{name}"), root.join("node_modules/@s").join(name)).unwrap();
    }
    root
}

fn answers(root: &Path) -> Vec<Option<String>> {
    let resolvers = Resolvers::new(Tsconfig::Auto, None);
    let from = root.join("packages/a/src/x.ts");
    ["@s/b", "@s/b/sub", "@s/b/tool", "@s/b/data", "@s/b/esm", "@s/b/gone", "@s/c", "@s/d"]
        .into_iter()
        .map(|request| resolvers.resolve(root, &from, request, None))
        .collect()
}

#[test]
fn output_answers_from_its_source_built_or_not() {
    let root = workspace("disk");
    let expected: Vec<Option<String>> = [
        Some("packages/b/src/index.ts"),
        Some("packages/b/src/sub/index.ts"),
        Some("packages/b/src/tool.tsx"),
        Some("packages/b/src/data.json"),
        Some("packages/b/src/index.ts"),
        None,
        None,
        Some("packages/d/src/index.ts"),
    ]
    .into_iter()
    .map(|answer| answer.map(str::to_owned))
    .collect();
    assert_eq!(answers(&root), expected, "unbuilt");

    write(&root, &[
        ("packages/b/dist/index.js", "export {};\n"),
        ("packages/b/dist/sub/index.js", "export {};\n"),
        ("packages/b/dist/gone.js", "export {};\n"),
        ("packages/b/dist/package.json", r#"{ "type": "module" }"#),
        ("packages/c/dist/index.js", "export {};\n"),
        ("packages/d/dist/index.js", "export {};\n"),
    ]);
    let mut built = expected.clone();
    built[6] = None;
    assert_eq!(answers(&root), built, "built, with a stale file");

    let from = root.join("packages/a/src/x.ts");
    let published = Resolvers::new(Tsconfig::Auto, None).resolution(&from, "@p/lib").map(|found| found.path().to_owned());
    assert_eq!(published, Some(root.join("node_modules/@p/lib/dist/index.js")));
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn a_directory_git_lists_is_read_from_the_listing() {
    let root = workspace("listed");
    // Git lists `packages/b` without its second config. A config git could not
    // hash leaves its directory to the disk as well.
    let paths = [
        "package.json",
        "packages/a/package.json",
        "packages/a/src/x.ts",
        "packages/b/package.json",
        "packages/b/tsconfig.json",
        "packages/b/src/index.ts",
    ]
    .map(str::to_owned);
    let answers = |unhashed: &[String]| {
        let regular = vec![true; paths.len()];
        let files = paths.iter().cloned().zip(0..).collect();
        let listing = Listing::of(Arc::new(files), Arc::new(regular), unhashed);
        let resolvers = Resolvers::over(Tsconfig::Auto, None, Emitted::listed(&root, Some(Arc::new(listing))));
        let from = root.join("packages/a/src/x.ts");
        ["@s/b", "@s/b/esm"].map(|request| resolvers.resolve(&root, &from, request, None))
    };
    let b = Some("packages/b/src/index.ts".to_owned());
    assert_eq!(answers(&[]), [b.clone(), None]);
    assert_eq!(answers(&["packages/b/tsconfig.esm.json".to_owned()]), [b.clone(), b]);
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn a_path_git_vouches_is_a_file_holds_nothing() {
    let root = workspace("file");
    // A listing no checkout would produce, so the answer shows who gave it:
    // a regular file declares nothing without the disk being asked, and a
    // symbolic link, which git lists as a blob too, is asked of the disk.
    let answer = |regular: bool| {
        let files = HashMap::from([("packages/b".to_owned(), 0)]);
        let listing = Listing::of(Arc::new(files), Arc::new(vec![regular]), &[]);
        let resolvers = Resolvers::over(Tsconfig::Auto, None, Emitted::listed(&root, Some(Arc::new(listing))));
        resolvers.resolve(&root, &root.join("packages/a/src/x.ts"), "../../b/dist/index.js", None)
    };
    assert_eq!(answer(true), None);
    assert_eq!(answer(false), Some("packages/b/src/index.ts".to_owned()));
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn metadata_uses_the_listing_only_for_unchanged_regular_files() {
    let root = crate::git_fixture::repository("emitted-metadata", &[
        ("kept.ts", b"export {};\n"),
        ("edited.ts", b"export {};\n"),
        ("removed.ts", b"export {};\n"),
        ("target.ts", b"export {};\n"),
    ]);
    std::os::unix::fs::symlink("target.ts", root.join("linked.ts")).unwrap();
    crate::git_fixture::commit(&root);
    write(&root, &[("edited.ts", "export const edited = true;\n"), ("untracked.ts", "export {};\n")]);
    std::fs::remove_file(root.join("removed.ts")).unwrap();
    let listed = || {
        let snapshot = crate::git::snapshot(root.to_str().unwrap()).unwrap();
        let files = snapshot.paths.into_iter().zip(0..).collect();
        Emitted::listed(&root, Some(Arc::new(Listing::of(Arc::new(files), Arc::new(snapshot.regular), &snapshot.unhashed))))
    };
    let scan = listed();
    assert!(scan.vouched(&root.join("kept.ts")));
    for path in ["edited.ts", "untracked.ts", "linked.ts", "removed.ts"] {
        assert!(!scan.vouched(&root.join(path)), "{path} is not an unchanged regular file");
    }
    // A scan keeps the listing's identity even if a listed file disappears.
    // Dirty, untracked and symbolic paths still take their type from the OS.
    std::fs::remove_file(root.join("kept.ts")).unwrap();
    for path in ["edited.ts", "untracked.ts"] {
        std::fs::remove_file(root.join(path)).unwrap();
        std::fs::create_dir(root.join(path)).unwrap();
        assert!(scan.metadata(&root.join(path)).unwrap().is_dir());
        assert!(scan.symlink_metadata(&root.join(path)).unwrap().is_dir());
    }
    assert!(scan.metadata(&root.join("linked.ts")).unwrap().is_file());
    assert!(scan.symlink_metadata(&root.join("linked.ts")).unwrap().is_symlink());
    assert!(scan.metadata(&root.join("removed.ts")).is_err());
    assert!(scan.metadata(&root.join("kept.ts")).unwrap().is_file());
    let kept = scan.symlink_metadata(&root.join("kept.ts")).unwrap();
    assert!(kept.is_file());
    assert!(!kept.is_symlink());
    assert!(listed().metadata(&root.join("kept.ts")).is_err(), "a later scan observes the deletion");
    let _ = std::fs::remove_dir_all(&root);
}

fn snapshot(root: &Path, paths: &[(&str, bool)]) -> Emitted {
    let files = paths.iter().map(|(path, _)| (*path).to_owned()).zip(0..).collect();
    let regular = paths.iter().map(|(_, regular)| *regular).collect();
    Emitted::listed(root, Some(Arc::new(Listing::of(Arc::new(files), Arc::new(regular), &[]))))
}

#[test]
fn listing_delegates_uncertain_paths_to_the_filesystem() {
    let root = workspace("listed-boundaries");
    write(&root, &[("real/kept.ts", "export {};"), ("src/ignored.ts", "export {};")]);
    std::os::unix::fs::symlink("real", root.join("linked")).unwrap();
    let held = snapshot(&root, &[("src/kept.ts", true), ("dirty/edited.ts", false), ("linked/kept.ts", false)]);
    let scan = Emitted::listed(&root, held.listed.as_ref().map(|(_, listing)| Arc::clone(listing)));
    for path in ["dirty", "dirty/edited.ts", "linked", "linked/kept.ts", "SRC", "src/KEPT.ts", "src/package.json", "src/tsconfig.build.json", "node_modules/pkg/index.ts"] {
        let called = std::cell::Cell::new(false);
        let _ = scan.disk_metadata(&root.join(path), |_| { called.set(true); Err(super::not_found()) });
        assert!(called.get(), "filesystem boundary: {path}");
    }
    assert_eq!(scan.canonicalize(&root.join("linked/kept.ts")).unwrap(), root.join("real/kept.ts"));
    assert_eq!(scan.canonicalize(&root.join("linked")).unwrap(), root.join("real"));
    assert_eq!(scan.canonicalize(&root.join("src/ignored.ts")).unwrap(), root.join("src/ignored.ts"));
    assert!(scan.canonicalize(&root.join("dirty/edited.ts")).is_err());
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn listing_answers_proved_regular_directories_without_stats() {
    let root = workspace("listed-directory-proof");
    let held = snapshot(&root, &[("src/kept.ts", true), ("src/deeper/other.ts", true)]);
    let scan = Emitted::listed(&root, held.listed.as_ref().map(|(_, listing)| Arc::clone(listing)));
    for (path, file) in [("src/kept.ts", true), ("src/deeper", false), ("src", false), ("", false)] {
        let metadata = scan.disk_metadata(&root.join(path), |_| panic!("listing proves {path}")).unwrap();
        assert_eq!((metadata.is_file(), metadata.is_dir(), metadata.is_symlink()), (file, !file, false));
    }
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn listed_regular_paths_canonicalize_without_rediscovering_the_disk() {
    let root = workspace("listed-canonical-proof");
    let scan = snapshot(&root, &[
        ("package.json", true), ("tsconfig.base.json", true), ("packages/b/package.json", true),
        ("packages/b/tsconfig.json", true), ("packages/b/src/index.ts", true),
    ]);
    let output = root.join("packages/b/dist/index.js");
    assert!(matches!(scan.origin(&output), super::Origin::Source(_)));
    std::fs::remove_dir_all(root.join("packages/b")).unwrap();
    for path in ["packages/b/src/index.ts", "packages/b/src", "packages/b"] {
        assert_eq!(scan.canonicalize(&root.join(path)).unwrap(), root.join(path));
    }
    assert_eq!(scan.canonicalize(&output).unwrap(), output);
    let resolvers = Resolvers::over(Tsconfig::Auto, None, scan);
    assert_eq!(resolvers.resolve(&root, &root.join("packages/a/src/x.ts"), "../../b/src/index.ts", None), Some("packages/b/src/index.ts".to_owned()));
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn snapshot_answers_files_directories_and_absence_without_candidate_stats() {
    let root = workspace("snapshot-metadata");
    let scan = snapshot(&root, &[("src/kept.ts", true), ("src/uncertain.ts", false), ("src/Mixed.ts", true), ("linked", false)]);
    for (path, file, directory) in [("src/kept.ts", true, false), ("src", false, true), ("", false, true)] {
        let answer = scan.disk_metadata(&root.join(path), |_| panic!("snapshot must answer {path}" )).unwrap();
        assert_eq!((answer.is_file(), answer.is_dir()), (file, directory));
    }
    for path in ["src/missing.ts", "src/missing/deeper.ts", "src/kept.ts/child.ts"] {
        assert!(scan.disk_metadata(&root.join(path), |_| panic!("snapshot must disprove {path}")).is_err());
    }
    for path in ["src/uncertain.ts", "linked/child.ts", "src/package.json", "src/tsconfig.build.json", "node_modules/pkg/index.ts", "src/mixed.ts"] {
        let called = std::cell::Cell::new(false);
        let _ = scan.disk_metadata(&root.join(path), |_| { called.set(true); Err(super::not_found()) });
        assert!(called.get(), "filesystem boundary: {path}");
    }
    let outside = root.parent().unwrap().join("outside.ts");
    let called = std::cell::Cell::new(false);
    let _ = scan.disk_metadata(&outside, |_| { called.set(true); Err(super::not_found()) });
    assert!(called.get());
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn a_complete_listing_owns_source_candidates_for_the_walk_and_code_map() {
    let root = workspace("snapshot-domain");
    write(&root, &[("src/choice.tsx", "export {};"), ("src/choice.ts", "export {};")]);
    let scan = snapshot(&root, &[("src/choice.tsx", true)]);
    for path in ["src/choice.ts", "src/missing.ts", "src/missing/deeper.ts"] {
        assert!(scan.disk_metadata(&root.join(path), |_| panic!("the complete listing disproves {path}")).is_err());
    }
    let resolvers = Resolvers::over(Tsconfig::Off, None, scan);
    assert_eq!(resolvers.resolve(&root, &root.join("src/importer.ts"), "./choice", None), Some("src/choice.tsx".to_owned()));
    assert!(Emitted::default().metadata(&root.join("src/choice.ts")).unwrap().is_file(), "a reader without a listing keeps the filesystem's answer");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn unhashed_paths_keep_their_filesystem_boundary() {
    let root = workspace("unhashed-boundary");
    let files = HashMap::from([("src/kept.ts".to_owned(), 0)]);
    let unhashed = ["src/unreadable.ts", "linked", "uncertain/child.ts", "unicode/K.ts"].map(str::to_owned);
    let listing = Arc::new(Listing::of(Arc::new(files), Arc::new(vec![true]), &unhashed));
    let scan = Emitted::listed(&root, Some(listing));
    for path in ["src/unreadable.ts", "src/UNREADABLE.ts", "linked", "linked/nested.ts", "LINKED/nested.ts", "uncertain", "UNCERTAIN/child.ts", "unicode/K.ts"] {
        let called = std::cell::Cell::new(false);
        let _ = scan.disk_metadata(&root.join(path), |_| { called.set(true); Err(super::not_found()) });
        assert!(called.get(), "Git gave no file type for {path}");
    }
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn snapshot_symlinks_and_virtual_output_sources_keep_their_owners() {
    let root = workspace("snapshot-output");
    write(&root, &[("shared/target.ts", "export {};")]);
    std::os::unix::fs::symlink("shared", root.join("linked")).unwrap();
    let scan = snapshot(&root, &[
        ("package.json", true), ("tsconfig.base.json", true),
        ("packages/b/package.json", true), ("packages/b/tsconfig.json", true),
        ("packages/b/src/index.ts", true), ("shared/target.ts", true), ("linked", false),
    ]);
    assert!(scan.metadata(&root.join("linked/target.ts")).unwrap().is_file());
    assert!(scan.symlink_metadata(&root.join("linked")).unwrap().is_symlink());
    // A deliberately removed source proves that output-source checks use the
    // same listing answer, rather than independently rediscovering the disk.
    std::fs::remove_file(root.join("packages/b/src/index.ts")).unwrap();
    assert!(matches!(scan.origin(&root.join("packages/b/dist/index.js")), super::Origin::Source(_)));
    assert!(matches!(scan.origin(&root.join("packages/b/dist/missing.js")), super::Origin::Nowhere));
    assert!(scan.declared(&root.join("packages/b/src/fabricated")).is_empty());
    let resolvers = Resolvers::over(Tsconfig::Off, None, scan);
    let from = root.join("packages/b/src/importer.ts");
    for (request, expected) in [
        ("../dist/index.js", Some("packages/b/src/index.ts")),
        ("./fabricated/missing.js", None),
        ("../../../linked/target.ts", Some("shared/target.ts")),
        ("../../../linked/fabricated/missing.js", None),
        ("../../../SHARED/target.ts", Some("shared/target.ts")),
    ] {
        assert_eq!(resolvers.resolve(&root, &from, request, None).as_deref(), expected, "{request}");
    }
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn output_uses_its_listed_source_before_the_outputs_file_type() {
    let root = workspace("listed-source");
    write(&root, &[("packages/b/dist/index.js", "export {};\n")]);
    let source = root.join("packages/b/src/index.ts");
    let output = root.join("packages/b/dist/index.js");
    let listed = |keep_source: bool| {
        let mut paths = vec!["package.json", "packages/b/package.json", "packages/b/tsconfig.json", "packages/b/dist/index.js"];
        if keep_source {
            paths.push("packages/b/src/index.ts");
        }
        let regular = vec![true; paths.len()];
        let files = paths.into_iter().map(str::to_owned).zip(0..).collect();
        Emitted::listed(&root, Some(Arc::new(Listing::of(Arc::new(files), Arc::new(regular), &[]))))
    };
    let scan = listed(true);
    std::fs::remove_file(&source).unwrap();
    assert!(matches!(scan.origin(&output), super::Origin::Source(found) if found == source));
    assert!(scan.metadata(&output).unwrap().is_file());
    assert!(listed(false).metadata(&output).is_err(), "a listed output cannot replace its missing source");
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn an_out_dir_two_levels_inside_another_is_its_own() {
    let root = workspace("nested");
    // `dist/lib/esm` lies inside `dist`, but not directly, and `dist/lib`
    // declares nothing between them.
    write(&root, &[
        ("packages/e/package.json", r#"{ "name": "@s/e", "exports": "./dist/lib/esm/index.js" }"#),
        ("packages/e/tsconfig.json", r#"{ "compilerOptions": { "outDir": "./dist", "rootDir": "./src" } }"#),
        ("packages/e/tsconfig.esm.json", r#"{ "compilerOptions": { "outDir": "./dist/lib/esm", "rootDir": "./src" } }"#),
        ("packages/e/src/index.ts", "export {};\n"),
    ]);
    std::os::unix::fs::symlink("../../packages/e", root.join("node_modules/@s/e")).unwrap();
    let answer = Resolvers::new(Tsconfig::Auto, None).resolve(&root, &root.join("packages/a/src/x.ts"), "@s/e", None);
    assert_eq!(answer, Some("packages/e/src/index.ts".to_owned()));
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn configs_naming_one_out_dir_answer_in_turn() {
    let root = workspace("shared");
    // `f`'s first config mirrors the package root, where no source is, and the
    // one read after it mirrors `src`. `g`'s config writes declarations only,
    // so its code is a bundler's and is read from the disk.
    write(&root, &[
        ("packages/f/package.json", r#"{ "name": "@s/f", "exports": "./dist/index.js" }"#),
        ("packages/f/tsconfig.json", r#"{ "compilerOptions": { "outDir": "./dist", "rootDir": "." } }"#),
        ("packages/f/tsconfig.build.json", r#"{ "extends": "./tsconfig.json", "compilerOptions": { "rootDir": "./src" } }"#),
        ("packages/f/src/index.ts", "export {};\n"),
        ("packages/g/package.json", r#"{ "name": "@s/g", "exports": { ".": "./dist/index.js", "./types": "./dist/index.d.ts" } }"#),
        ("packages/g/tsconfig.json", r#"{ "compilerOptions": { "outDir": "./dist", "rootDir": "./src", "emitDeclarationOnly": true } }"#),
        ("packages/g/src/index.ts", "export {};\n"),
    ]);
    for name in ["f", "g"] {
        std::os::unix::fs::symlink(format!("../../packages/{name}"), root.join("node_modules/@s").join(name)).unwrap();
    }
    let answers = || {
        let from = root.join("packages/a/src/x.ts");
        ["@s/f", "@s/g", "@s/g/types"].map(|request| Resolvers::new(Tsconfig::Auto, None).resolve(&root, &from, request, None))
    };
    let expected = [Some("packages/f/src/index.ts".to_owned()), None, Some("packages/g/src/index.ts".to_owned())];
    assert_eq!(answers(), expected, "unbuilt");
    write(&root, &[("packages/g/dist/index.js", "export {};\n")]);
    assert_eq!(answers(), expected, "bundled");
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn a_source_that_links_elsewhere_is_read_where_it_points() {
    let root = workspace("linked");
    // Git lists both paths, the link as a blob, and an import of the output
    // reaches the file an import of the link would.
    write(&root, &[
        ("packages/h/package.json", r#"{ "name": "@s/h", "exports": "./dist/index.js" }"#),
        ("packages/h/tsconfig.json", r#"{ "compilerOptions": { "outDir": "./dist", "rootDir": "./src" } }"#),
        ("shared/h.ts", "export {};\n"),
    ]);
    std::fs::create_dir_all(root.join("packages/h/src")).unwrap();
    std::os::unix::fs::symlink("../../../shared/h.ts", root.join("packages/h/src/index.ts")).unwrap();
    std::os::unix::fs::symlink("../../packages/h", root.join("node_modules/@s/h")).unwrap();
    let known = HashMap::from([("packages/h/src/index.ts".to_owned(), 0), ("shared/h.ts".to_owned(), 1)]);
    let from = root.join("packages/a/src/x.ts");
    let answers = ["@s/h", "../../h/src/index.ts"].map(|request| Resolvers::new(Tsconfig::Auto, None).resolve(&root, &from, request, Some(&known)));
    assert_eq!(answers, [Some("shared/h.ts".to_owned()), Some("shared/h.ts".to_owned())]);
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn a_base_two_packages_extend_is_read_once_in_a_scan() {
    let root = workspace("once");
    // `b` and `i` build through one base. Whoever asks first reads it, and a
    // scan that read it answers the second package from that reading, where a
    // second read would find the base no longer naming an `outDir`.
    write(&root, &[
        ("packages/i/package.json", r#"{ "name": "@s/i", "exports": "./dist/index.js" }"#),
        ("packages/i/tsconfig.json", r#"{ "extends": "../../tsconfig.base.json",
            "compilerOptions": { "rootDir": "./src" } }"#),
        ("packages/i/src/index.ts", "export {};\n"),
    ]);
    std::os::unix::fs::symlink("../../packages/i", root.join("node_modules/@s/i")).unwrap();
    let from = root.join("packages/a/src/x.ts");
    let scan = Resolvers::new(Tsconfig::Auto, None);
    assert_eq!(scan.resolve(&root, &from, "@s/b", None), Some("packages/b/src/index.ts".to_owned()));
    write(&root, &[("tsconfig.base.json", "{}")]);
    assert_eq!(scan.resolve(&root, &from, "@s/i", None), Some("packages/i/src/index.ts".to_owned()), "the same scan");
    let later = Resolvers::new(Tsconfig::Auto, None);
    assert_eq!(later.resolve(&root, &from, "@s/i", None), None, "a later scan reads the disk again");
    let _ = std::fs::remove_dir_all(&root);
}
