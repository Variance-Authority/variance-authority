//! Each answer against what `specifier.ts` and Node's `path` answer for it.

use std::collections::HashSet;

use super::{extname, is_relative, is_relative_in, kind_for, package_of, request_of};
use crate::read_any::Language;

fn set(values: &[&str]) -> HashSet<String> {
    values.iter().map(|value| (*value).to_owned()).collect()
}

#[test]
fn a_request_is_cut_where_requestof_cuts_it() {
    for (written, request) in [
        (" ./a?x ", Some("./a")),
        ("#a#b", Some("#a")),
        ("#", Some("#")),
        ("a#b?c", Some("a")),
        ("data:x", None),
        ("node:fs", None),
        ("?q", None),
        ("", None),
        ("@s/p/deep", Some("@s/p/deep")),
    ] {
        assert_eq!(request_of(written), request, "{written:?}");
    }
}

#[test]
fn trim_removes_what_javascript_removes() {
    assert_eq!(request_of("\u{feff}./x\u{85}"), Some("./x\u{85}"));
    assert_eq!(request_of("\u{2028}\t./x\u{3000}"), Some("./x"));
}

#[test]
fn relative_is_the_four_module_spellings() {
    for request in ["./a", "../a", ".", ".."] {
        assert!(is_relative(request), "{request}");
    }
    for request in [".a", "..a", "a", "/a"] {
        assert!(!is_relative(request), "{request}");
    }
}

#[test]
fn a_hole_is_a_path_the_language_spells_in_this_repository() {
    // Rust: a spelled path, or one from this crate; never a foreign crate.
    for request in ["self::order", "crate::read::Read", "super::Up", "other/place.rs"] {
        assert!(is_relative_in(Language::Rust, request), "{request}");
    }
    assert!(!is_relative_in(Language::Rust, "std::fmt::Display"));
    // Python: a leading dot, which in a module is a bare package name.
    assert!(is_relative_in(Language::Python, ".sibling"));
    assert!(!is_relative_in(Language::Module, ".sibling"));
    // Java, Kotlin and Swift spell a first-party import as a platform one is.
    for language in [Language::Java, Language::Kotlin, Language::Swift] {
        assert!(!is_relative_in(language, "./a"));
    }
    assert!(is_relative_in(Language::Style, "./a"));
}

#[test]
fn a_package_is_its_first_segment_or_its_scope_and_name() {
    let builtins = set(&["fs", "fs/promises"]);
    for (request, named) in [
        ("react/jsx-runtime", Some("react")),
        ("@s/p/deep", Some("@s/p")),
        ("@s", None),
        ("@s/", Some("@s/")),
        ("fs/promises", None),
        ("fs", None),
        ("./a", None),
        ("/abs", None),
        ("#internal", None),
        ("x://y", None),
    ] {
        assert_eq!(package_of(request, &builtins), named, "{request}");
    }
}

#[test]
fn a_target_read_as_code_keeps_its_kind() {
    let code = set(&[".ts", ".py"]);
    assert_eq!(kind_for("imports", "a/b.ts", &code), "imports");
    assert_eq!(kind_for("imports", "a/b.css", &code), "asset");
    assert_eq!(kind_for("type", "a/b.css", &code), "type");
    assert_eq!(kind_for("depends", "a/b.png", &code), "depends");
    assert_eq!(kind_for("dynamic", "a/b", &code), "asset");
}

#[test]
fn extname_is_nodes() {
    for (path, extension) in [
        ("..b", ".b"),
        ("...", "."),
        ("..", ""),
        (".a", ""),
        (".a.b", ".b"),
        ("a.", "."),
        ("a/b.c/", ".c"),
        ("a.b//", ".b"),
        ("x/..", ""),
        ("x/.b", ""),
        ("a..b", ".b"),
        ("", ""),
    ] {
        assert_eq!(extname(path), extension, "{path:?}");
    }
}
