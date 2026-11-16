use super::*;

fn paths(paths: &[&str]) -> Vec<String> {
    paths.iter().map(|path| (*path).to_owned()).collect()
}

#[test]
fn python_roots_relative_imports_and_stub_priority() {
    let paths = paths(&["a/pyproject.toml", "a/src/pkg/__init__.py", "a/src/pkg/child.py", "a/src/pkg/child.pyi", "pkg/child.py"]);
    let world = LanguageWorld::new(&paths, Path::new("/absent"));
    assert_eq!(world.python_roots(), &["a/src", "a", ""]);
    assert_eq!(world.resolve_python("main.py", "pkg.child"), ["a/src/pkg/child.py"]);
    assert_eq!(world.resolve_python("a/src/pkg/use.py", ".child"), ["a/src/pkg/child.py"]);
    assert_eq!(world.resolve_python("a/src/pkg/use.py", "."), ["a/src/pkg/__init__.py"]);
    assert!(world.resolve_python("use.py", "..child").is_empty());
}

#[test]
fn jvm_package_wildcards_and_kotlin_functions_reach_all_siblings() {
    let paths = paths(&["src/kit/A.java", "src/kit/B.kt", "src/kit/C.kt", "src/kit/nested/D.kt"]);
    let world = LanguageWorld::new(&paths, Path::new("/absent"));
    world.jvm.set(vec!["src".to_owned()]).unwrap();
    assert_eq!(world.resolve_jvm("src/kit/A.java", "kit.*"), ["src/kit/B.kt", "src/kit/C.kt"]);
    assert_eq!(world.resolve_jvm("other.kt", "kit.A.method"), ["src/kit/A.java"]);
    assert_eq!(world.resolve_jvm("src/kit/B.kt", "kit.parse"), ["src/kit/C.kt"]);
}

#[test]
fn swift_targets_project_recursively_and_loose_files_stay_beside_importer() {
    let paths = paths(&["Package.swift", "Sources/Core/A.swift", "Sources/Core/sub/B.swift", "Tests/Check/C.swift", "loose/A.swift", "loose/B.swift", "loose/sub/C.swift"]);
    let world = LanguageWorld::new(&paths, Path::new("/absent"));
    assert_eq!(world.resolve_swift("Tests/Check/C.swift", "Core"), ["Sources/Core/A.swift", "Sources/Core/sub/B.swift"]);
    assert_eq!(world.resolve_swift("Sources/Core/A.swift", "*"), ["Sources/Core/sub/B.swift"]);
    assert_eq!(world.resolve_swift("loose/A.swift", "*"), ["loose/B.swift"]);
    assert!(world.resolve_swift("Package.swift", "*").is_empty());
}

#[test]
fn a_module_request_does_not_build_or_copy_any_language_path_index() {
    let paths = paths(&["z.ts", "a.ts"]);
    let world = LanguageWorld::new(&paths, Path::new("/absent"));
    let read = SourceRead::Module(crate::read::Read {
        requests: vec![crate::read::Request { value: "./absent".to_owned(), kind: crate::read::Kind::Imports, bindings: Vec::new(), line: 1, republishes: false }],
        ..crate::read::Read::default()
    });
    let resolver = Resolvers::new(crate::resolve::Tsconfig::Off, None);
    assert!(world.resolve("a.ts", &read, 0, &resolver, None).is_empty());
    assert!(world.sorted.get().is_none());
    assert!(world.python.get().is_none());
    assert!(world.jvm.get().is_none());
    assert!(world.swift.get().is_none());
}

#[test]
fn jvm_source_roots_come_from_a_direct_childs_package_declaration() {
    let root = std::env::temp_dir().join(format!("sense-jvm-roots-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("code/kit/sub")).unwrap();
    std::fs::write(root.join("code/kit/A.java"), "package kit;\npublic class A {}").unwrap();
    std::fs::write(root.join("code/kit/sub/B.kt"), "package kit.sub\nclass B").unwrap();
    let paths = paths(&["code/kit/sub/B.kt", "code/kit/A.java"]);
    let world = LanguageWorld::new(&paths, &root);
    assert_eq!(world.jvm_roots(), &["code"]);
    assert_eq!(world.resolve_jvm("main.kt", "kit.A"), ["code/kit/A.java"]);
    assert_eq!(world.resolve_jvm("main.kt", "kit.*"), ["code/kit/A.java"]);
    std::fs::remove_dir_all(root).unwrap();
}

#[cfg(feature = "grammars")]
#[test]
fn swift_manifests_override_convention_targets_with_declared_paths() {
    let root = std::env::temp_dir().join(format!("sense-swift-targets-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("Package.swift"), "let package = Package(name: \"Example\", targets: [.target(name: \"Core\", path: \"custom\")])").unwrap();
    let paths = paths(&["Package.swift", "Sources/Core/Old.swift", "custom/A.swift", "custom/nested/B.swift"]);
    let world = LanguageWorld::new(&paths, &root);
    assert_eq!(world.resolve_swift("Tests/Main.swift", "Core"), ["custom/A.swift", "custom/nested/B.swift"]);
    std::fs::remove_dir_all(root).unwrap();
}
