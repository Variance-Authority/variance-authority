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
