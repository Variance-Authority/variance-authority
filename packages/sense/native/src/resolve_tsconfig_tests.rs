//! A `tsconfig.json` that fails to load, against a workspace on disk.

use std::collections::HashMap;

use super::{Resolvers, Tsconfig};

#[test]
fn a_tsconfig_that_fails_to_load_governs_no_request_from_its_first() {
    let root = std::env::temp_dir().join(format!("sense-failed-tsconfig-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    for (path, text) in [
        ("tsconfig.json", r#"{ "extends": "@missing/tsconfig-base/tsconfig.json" }"#),
        ("src/a.ts", "import './b';\n"),
        ("src/b.ts", "export {};\n"),
    ] {
        std::fs::create_dir_all(root.join(path).parent().unwrap()).unwrap();
        std::fs::write(root.join(path), text).unwrap();
    }
    let root = std::fs::canonicalize(root).unwrap();
    let from = root.join("src/a.ts");
    let listed = HashMap::from([("src/a.ts".to_owned(), 0), ("src/b.ts".to_owned(), 1)]);
    let resolvers = Resolvers::new(Tsconfig::Auto, None);
    let ask = || resolvers.resolve(&root, &from, "./b", Some(&listed));
    assert_eq!([ask(), ask()], [Some("src/b.ts".to_owned()), Some("src/b.ts".to_owned())]);
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn alias_candidates_belong_to_the_importers_effective_configuration() {
    use std::sync::OnceLock;
    let root = std::env::temp_dir().join(format!("sense-scoped-aliases-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let write = |file: &str, text: &str| {
        std::fs::create_dir_all(root.join(file).parent().unwrap()).unwrap();
        std::fs::write(root.join(file), text).unwrap();
    };
    write("config/base.json", r#"{"compilerOptions":{"baseUrl":"..","paths":{"@app/*":["src/*"],"@app/deep/*":["special/*"]}}}"#);
    write("tsconfig.json", r#"{"extends":"./config/base.json"}"#);
    write("src/a.ts", "import '@app/missing';");
    write("src/b.ts", "import '@app/missing';");
    for index in 0..32 {
        write(&format!("unrelated-{index}/tsconfig.json"), r#"{"compilerOptions":{"baseUrl":".","paths":{"@app/*":["other/*"]}}}"#);
    }
    let root = std::fs::canonicalize(&root).unwrap();
    for mode in [Tsconfig::Auto, Tsconfig::Named(root.join("tsconfig.json")), Tsconfig::Off] {
        let resolvers = Resolvers::new(mode.clone(), Some(vec!["import".into()]));
        for file in ["src/a.ts", "src/b.ts"] {
            let from = root.join(file);
            let governing = OnceLock::new();
            // Misses and shared answer-cache hits retain the same candidates.
            assert_eq!(resolvers.resolve_from(&root, &from, "@app/missing", None, &governing), None);
            let mut candidates = resolvers.alias_candidates(&root, &from, "@app/missing", &governing);
            candidates.sort();
            assert_eq!(candidates, if mode == Tsconfig::Off { vec![] } else { vec!["@app/missing", "src/missing"] });
            let mut deep = resolvers.alias_candidates(&root, &from, "@app/deep/x", &governing);
            deep.sort();
            assert_eq!(deep, if mode == Tsconfig::Off { vec![] } else { vec!["@app/deep/x", "special/x"] });
            let mut parent = resolvers.alias_candidates(&root, &from, "@app/../x", &governing);
            parent.sort();
            assert_eq!(parent, if mode == Tsconfig::Off { vec![] } else { vec!["x"] });
            assert!(resolvers.alias_candidates(&root, &from, "./relative", &governing).is_empty());
            assert!(resolvers.alias_candidates(&root, &from, "node:fs", &governing).is_empty());
        }
    }
    let _ = std::fs::remove_dir_all(&root);
}

/// The configuration is read where the resolver finds it, through links, so a
/// root handed through a link names the same candidates as its canonical path.
#[cfg(unix)]
#[test]
fn alias_candidates_under_a_root_reached_through_a_link_are_spelled_from_it() {
    use std::sync::OnceLock;
    let base = std::env::temp_dir().join(format!("sense-linked-aliases-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    let real = base.join("real");
    std::fs::create_dir_all(real.join("src")).unwrap();
    std::fs::write(real.join("tsconfig.json"), r#"{"compilerOptions":{"baseUrl":".","paths":{"@app/*":["src/*"]}}}"#).unwrap();
    std::fs::write(real.join("src/a.ts"), "import '@app/missing';").unwrap();
    let root = base.join("linked");
    std::os::unix::fs::symlink(&real, &root).unwrap();
    let resolvers = Resolvers::new(Tsconfig::Auto, None);
    let mut candidates = resolvers.alias_candidates(&root, &root.join("src/a.ts"), "@app/missing", &OnceLock::new());
    candidates.sort();
    assert_eq!(candidates, vec!["@app/missing", "src/missing"]);
    let _ = std::fs::remove_dir_all(&base);
}
