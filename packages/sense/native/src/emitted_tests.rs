//! The rule, against a workspace on disk and against a listing git would give.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use super::{Emitted, Listing};
use crate::resolve::Resolvers;

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
    let resolvers = Resolvers::new(None, None);
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
    let published = Resolvers::new(None, None).resolution(&from, "@p/lib").map(|found| found.path().to_owned());
    assert_eq!(published, Some(root.join("node_modules/@p/lib/dist/index.js")));
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn a_directory_git_lists_is_read_from_the_listing() {
    let root = workspace("listed");
    // Git lists `packages/b` without its second config, and nothing under
    // `packages/d`, which is then read from the disk. A config git could not
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
        let resolvers = Resolvers::over(None, None, Emitted::listed(&root, Some(Arc::new(listing))));
        let from = root.join("packages/a/src/x.ts");
        ["@s/b", "@s/b/esm", "@s/d"].map(|request| resolvers.resolve(&root, &from, request, None))
    };
    let (b, d) = (Some("packages/b/src/index.ts".to_owned()), Some("packages/d/src/index.ts".to_owned()));
    assert_eq!(answers(&[]), [b.clone(), None, d.clone()]);
    assert_eq!(answers(&["packages/b/tsconfig.esm.json".to_owned()]), [b.clone(), b, d]);
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
        let resolvers = Resolvers::over(None, None, Emitted::listed(&root, Some(Arc::new(listing))));
        resolvers.resolve(&root, &root.join("packages/a/src/x.ts"), "../../b/dist/index.js", None)
    };
    assert_eq!(answer(true), None);
    assert_eq!(answer(false), Some("packages/b/src/index.ts".to_owned()));
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
    let answer = Resolvers::new(None, None).resolve(&root, &root.join("packages/a/src/x.ts"), "@s/e", None);
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
        ["@s/f", "@s/g", "@s/g/types"].map(|request| Resolvers::new(None, None).resolve(&root, &from, request, None))
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
    let answers = ["@s/h", "../../h/src/index.ts"].map(|request| Resolvers::new(None, None).resolve(&root, &from, request, Some(&known)));
    assert_eq!(answers, [Some("shared/h.ts".to_owned()), Some("shared/h.ts".to_owned())]);
    let _ = std::fs::remove_dir_all(&root);
}
