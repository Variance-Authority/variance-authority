use super::*;

#[test]
fn strips_build_suffixes() {
    assert_eq!(request_of(" ./button.ts?raw#x "), Some("./button.ts"));
    assert_eq!(request_of("node:fs"), None);
}

#[test]
fn a_build_directory_is_source_where_git_lists_it() {
    let root = std::env::temp_dir().join(format!("sense-listed-build-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    for (path, text) in [
        ("src/commands/b.ts", "import './build/a';\n"),
        ("src/commands/build/a.ts", "export {};\n"),
        ("src/commands/dist/c.ts", "export {};\n"),
    ] {
        std::fs::create_dir_all(root.join(path).parent().unwrap()).unwrap();
        std::fs::write(root.join(path), text).unwrap();
    }
    let root = std::fs::canonicalize(root).unwrap();
    let from = root.join("src/commands/b.ts");
    let listed = HashMap::from([
        ("src/commands/b.ts".to_owned(), 0),
        ("src/commands/build/a.ts".to_owned(), 1),
        ("src/commands/dist/c.ts".to_owned(), 2),
    ]);
    let unlisted = HashMap::from([("src/commands/b.ts".to_owned(), 0)]);
    let resolvers = Resolvers::new(Tsconfig::Auto, None);
    let ask = |request, known| resolvers.resolve(&root, &from, request, known);
    assert_eq!(ask("./build/a", Some(&listed)), Some("src/commands/build/a.ts".to_owned()));
    assert_eq!(ask("./build/a", Some(&unlisted)), None);
    assert_eq!(ask("./build/a", None), None);
    assert_eq!(ask("./dist/c", Some(&listed)), None);
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn a_declaration_stem_drops_the_whole_suffix() {
    assert_eq!(stem("context.d.ts"), "context");
    assert_eq!(stem("context.d.mts"), "context");
    assert_eq!(stem("context.ts"), "context");
    assert_eq!(stem(".d.ts"), ".d");
    assert!(case_folded("./Context", Path::new("/src/context.d.ts")));
    assert!(!case_folded("./context", Path::new("/src/context.d.ts")));
}

#[test]
fn keeps_a_subpath_import() {
    assert_eq!(request_of("#polyfill"), Some("#polyfill"));
    assert_eq!(request_of("#internal/a.js?raw#x"), Some("#internal/a.js"));
    assert_eq!(request_of("#"), Some("#"));
}
