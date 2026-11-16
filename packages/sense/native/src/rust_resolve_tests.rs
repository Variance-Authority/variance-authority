use std::collections::HashMap;

use crate::rust_resolve::RustWorld;

#[test]
fn rust_resolves_declared_modules_spelled_parents_inline_items_and_crate_names() {
    let sources = [
        ("Cargo.toml", "[package]\nname = \"test-kit\"\n"),
        ("src/lib.rs", "mod lexicon;\nmod compact;\nmod shapes;\n#[path = \"deeper/else.rs\"]\nmod relocated;\n#[path = \"extra.txt\"]\nmod extra;\n"),
        ("src/extra.txt", "pub struct Extra;\n"),
        ("src/deeper/else.rs", "mod child;\nmod inline { #[path = \"same.rs\"] mod hidden; }\n"),
        ("src/deeper/child.rs", "pub struct Child;\n"),
        ("src/deeper/inline/same.rs", "pub struct Hidden;\n"),
        ("src/lexicon.rs", "#[path = \"lexicon_catalogue.rs\"]\nmod catalogue;\n#[path = \"lexicon_view.rs\"]\nmod view;\n"),
        ("src/lexicon_catalogue.rs", "pub struct Catalogue;\n"),
        ("src/lexicon_view.rs", "use super::catalogue::Catalogue;\n"),
        ("src/compact.rs", "fn flag() {}\nmod inner { pub struct Thing; mod deep; }\n"),
        ("src/compact/inner/deep.rs", "use super::super::flag;\n"),
        ("src/shapes.rs", "fn inner() {}\nmod inner { pub struct Thing; }\n"),
        ("tests/run.rs", "mod helper;\n"),
        ("tests/helper.rs", "pub struct Help;\n"),
    ];
    let mut paths: Vec<String> = sources.iter().map(|(file, _)| (*file).to_owned()).collect();
    paths.sort_by(|left, right| crate::order::code_unit(left, right));
    let reads: HashMap<String, crate::languages::shape::Read> = sources.iter()
        .filter(|(file, _)| file.ends_with(".rs"))
        .map(|(file, source)| ((*file).to_owned(), crate::languages::read("rust", file, source).unwrap()))
        .collect();
    let root = crate::git_fixture::repository("rust-resolve", &sources.iter().map(|(file, source)| (*file, source.as_bytes())).collect::<Vec<_>>());
    let world = RustWorld::new(&paths, &reads, &root);
    for (from, request, item, expected) in [
        ("src/lexicon_view.rs", "super::catalogue::Catalogue", false, Some("src/lexicon_catalogue.rs")),
        ("src/compact/inner/deep.rs", "super::super::flag", false, Some("src/compact.rs")),
        ("src/lib.rs", "crate::compact::inner::Thing", true, Some("src/compact.rs")),
        ("src/lib.rs", "crate::compact::inner", true, None),
        ("src/lib.rs", "crate::shapes::inner::Thing", true, Some("src/shapes.rs")),
        ("src/lib.rs", "crate::shapes::inner", true, None),
        ("src/lib.rs", "crate::shapes::Missing", true, None),
        ("src/lib.rs", "crate::extra::Extra", false, Some("src/extra.txt")),
        ("tests/run.rs", "crate::helper::Help", false, Some("tests/helper.rs")),
        ("src/lexicon_view.rs", "test_kit::compact::flag", false, Some("src/compact.rs")),
        ("src/lexicon_view.rs", "serde::Deserialize", false, None),
        ("src/compact.rs", "self::flag", false, None),
        ("src/deeper/else.rs", "self::child::Child", false, Some("src/deeper/child.rs")),
        ("src/deeper/else.rs", "self::inline/same.rs", false, Some("src/deeper/inline/same.rs")),
        ("src/deeper/inline/same.rs", "super::super::child::Child", false, Some("src/deeper/child.rs")),
    ] {
        assert_eq!(world.resolve(from, request, item), expected.into_iter().map(str::to_owned).collect::<Vec<_>>(), "{from}: {request}");
    }
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn rust_uses_layout_only_where_no_read_declared_the_modules() {
    let paths: Vec<String> = ["src/lib.rs", "src/read.rs", "src/order/mod.rs", "src/order/sort.rs", "other/place.rs"]
        .into_iter().map(str::to_owned).collect();
    let world = RustWorld::new(&paths, &HashMap::new(), std::path::Path::new(""));
    for (from, request, item, expected) in [
        ("src/lib.rs", "self::read", false, Some("src/read.rs")),
        ("src/lib.rs", "self::order", false, Some("src/order/mod.rs")),
        ("src/lib.rs", "crate::order::sort::Sort", false, Some("src/order/sort.rs")),
        ("src/order/sort.rs", "super", false, Some("src/order/mod.rs")),
        ("src/order/sort.rs", "super::super::read::Read", false, Some("src/read.rs")),
        ("src/lib.rs", "self::helper", false, None),
        ("src/order/sort.rs", "super::sort::Sort", false, None),
        ("src/lib.rs", "other/place.rs", false, None),
        ("src/lib.rs", "crate::order::sort::Sort", true, Some("src/order/sort.rs")),
        ("src/lib.rs", "crate::order::sort", true, None),
        ("src/lib.rs", "crate::order::sort::Sort::new", true, None),
    ] {
        assert_eq!(world.resolve(from, request, item), expected.into_iter().map(str::to_owned).collect::<Vec<_>>(), "{from}: {request}");
    }
    for (request, expected) in [("self::order", true), ("crate::read::Read", true), ("other/place.rs", true), ("std::fmt::Display", false)] {
        assert_eq!(crate::rust_resolve::is_relative(request), expected);
    }
}
