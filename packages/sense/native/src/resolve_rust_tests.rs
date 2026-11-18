//! `where a Rust path lands` in `rust.test.ts`, case for case.

use std::collections::HashMap;

use super::resolve;
use crate::world::World;

fn known(paths: &[&str]) -> HashMap<String, u32> {
    paths.iter().map(|path| (*path).to_owned()).zip(0..).collect()
}

/// A world over a bare list of paths.
fn layout<R>(paths: &[&str], ask: impl FnOnce(&World) -> R) -> R {
    let known = known(paths);
    ask(&World::new(Some(&known), None))
}

/// A world whose files can be read: `worldOn` over a directory holding `files`.
#[cfg(feature = "grammars")]
fn written<R>(files: &[(&str, &str)], ask: impl FnOnce(&World) -> R) -> R {
    let held: HashMap<&str, &str> = files.iter().copied().collect();
    let paths: Vec<&str> = files.iter().map(|(path, _)| *path).collect();
    let known = known(&paths);
    let parsing = |paths: &[&str]| paths.iter().map(|path| held.get(path).map(|source| read(path, source))).collect();
    let texting = |path: &str| held.get(path).map(|text| (*text).to_owned());
    ask(&World::new(Some(&known), None).reading(&parsing, &texting))
}

#[cfg(feature = "grammars")]
fn read(file: &str, source: &str) -> crate::read::Read {
    crate::read_any::read_file(file, source, &oxc_allocator::Allocator::default(), true)
}

const LAID_OUT: [&str; 6] = ["Cargo.toml", "src/lib.rs", "src/read.rs", "src/order/mod.rs", "src/order/sort.rs", "other/place.rs"];

fn landed(from: &str, request: &str) -> Vec<String> {
    layout(&LAID_OUT, |world| resolve(world, from, request, false))
}

#[test]
fn finds_a_module_beside_its_declaration_and_a_directory_by_its_own_file() {
    assert_eq!(landed("src/lib.rs", "self::read"), ["src/read.rs"]);
    assert_eq!(landed("src/lib.rs", "self::order"), ["src/order/mod.rs"]);
}

#[test]
fn takes_the_longest_prefix_of_a_use_that_is_a_file() {
    assert_eq!(landed("src/lib.rs", "crate::order::sort::Sort"), ["src/order/sort.rs"]);
}

#[test]
fn climbs_with_super_to_the_module_a_file_sits_in() {
    assert_eq!(landed("src/order/sort.rs", "super"), ["src/order/mod.rs"]);
    assert_eq!(landed("src/order/sort.rs", "super::super::read::Read"), ["src/read.rs"]);
}

#[test]
fn never_lands_on_the_file_that_asks() {
    assert!(landed("src/lib.rs", "self::helper").is_empty());
    assert!(landed("src/order/sort.rs", "super::sort::Sort").is_empty());
}

#[cfg(feature = "grammars")]
#[test]
fn lands_an_inline_modules_super_on_the_file_that_holds_the_module() {
    let read = read("src/foo.rs", "mod tests {\n    use super::*;\n    use super::helper;\n    use super::super::bar::Bar;\n}\n");
    let reached: Vec<String> = layout(&["Cargo.toml", "src/lib.rs", "src/foo.rs", "src/bar.rs"], |world| {
        read.requests.iter().flat_map(|request| resolve(world, "src/foo.rs", &request.value, false)).collect()
    });
    assert_eq!(reached, ["src/bar.rs"]);
}

#[cfg(feature = "grammars")]
#[test]
fn lands_a_path_attribute_inside_an_inline_module_under_that_modules_directory() {
    let source = "#[path = \"elsewhere.rs\"]\nmod beside;\nmod inline {\n    #[path = \"other.rs\"]\n    mod inner;\n}\n";
    let tree = ["Cargo.toml", "src/lib.rs", "src/a.rs", "src/a/b.rs", "src/a/b/inline/other.rs", "src/a/elsewhere.rs"];
    let requests = read("src/a/b.rs", source).requests;
    let reached: Vec<String> =
        layout(&tree, |world| requests.iter().flat_map(|request| resolve(world, "src/a/b.rs", &request.value, false)).collect());
    assert_eq!(reached, ["src/a/elsewhere.rs", "src/a/b/inline/other.rs"]);
    // A `mod.rs` owns the directory it is in, so its inline modules sit there.
    let owned = ["Cargo.toml", "src/lib.rs", "src/a/mod.rs", "src/a/inline/other.rs", "src/a/elsewhere.rs"];
    let requests = read("src/a/mod.rs", source).requests;
    let reached: Vec<String> =
        layout(&owned, |world| requests.iter().flat_map(|request| resolve(world, "src/a/mod.rs", &request.value, false)).collect());
    assert_eq!(reached, ["src/a/elsewhere.rs", "src/a/inline/other.rs"]);
}

#[cfg(feature = "grammars")]
#[test]
fn takes_as_a_files_top_level_items_none_its_inline_modules_declare() {
    let read = read("src/shapes.rs", "fn top() {}\nmod tests {\n    fn fixture() {}\n    mod deep {}\n}\n");
    let items = super::top_level_items(&read.symbols, &std::collections::HashSet::new());
    assert_eq!(items.declared, ["top".to_owned()].into());
    assert_eq!(items.inline, ["tests".to_owned()].into());
}

#[test]
fn takes_a_spelled_path_as_a_path_relative_to_the_declaring_file() {
    assert!(landed("src/lib.rs", "other/place.rs").is_empty());
}

#[test]
fn lands_a_path_asked_for_as_an_item_only_where_one_segment_is_left_past_its_modules() {
    let asked = |request: &str| layout(&LAID_OUT, |world| resolve(world, "src/lib.rs", request, true));
    assert_eq!(asked("crate::order::sort::Sort"), ["src/order/sort.rs"]);
    assert!(asked("crate::order::sort").is_empty());
    assert!(asked("crate::order::sort::Sort::new").is_empty());
}

#[test]
fn is_silent_about_a_crate_this_tree_does_not_hold() {
    assert!(landed("src/lib.rs", "serde::Deserialize").is_empty());
}

/// `where a Rust path lands in the module tree its files declare`.
#[cfg(feature = "grammars")]
const DECLARED: [(&str, &str); 10] = [
    ("Cargo.toml", "[package]\nname = \"kit\"\nversion = \"0.1.0\"\n"),
    ("src/lib.rs", "mod lexicon;\nmod compact;\nmod shapes;\n"),
    ("src/shapes.rs", "fn inner() {}\n\nmod inner {\n    pub(crate) struct Thing;\n}\n"),
    ("src/lexicon.rs", "#[path = \"lexicon_catalogue.rs\"]\nmod catalogue;\n#[path = \"lexicon_view.rs\"]\nmod view;\n"),
    ("src/lexicon_catalogue.rs", "pub(crate) struct Catalogue;\n"),
    ("src/lexicon_view.rs", "use super::catalogue::Catalogue;\n"),
    ("src/compact.rs", "fn flag() {}\nmod inner {\n    pub(crate) struct Thing;\n    mod deep;\n}\n"),
    ("src/compact/inner/deep.rs", "use super::super::flag;\n"),
    ("tests/run.rs", "mod helper;\nuse crate::helper::Help;\n"),
    ("tests/helper.rs", "pub struct Help;\n"),
];

#[cfg(feature = "grammars")]
fn declared(from: &str, request: &str, item: bool) -> Vec<String> {
    let mut files = DECLARED.to_vec();
    files.sort_by(|left, right| crate::order::code_unit(left.0, right.0));
    written(&files, |world| resolve(world, from, request, item))
}

#[cfg(feature = "grammars")]
#[test]
fn finds_a_file_a_path_attribute_names_beside_the_file_that_declares_it() {
    assert_eq!(declared("src/lexicon.rs", "lexicon_view.rs", false), ["src/lexicon_view.rs"]);
}

#[cfg(feature = "grammars")]
#[test]
fn climbs_with_super_to_the_module_that_declared_the_file() {
    assert_eq!(declared("src/lexicon_view.rs", "super::catalogue::Catalogue", false), ["src/lexicon_catalogue.rs"]);
}

#[cfg(feature = "grammars")]
#[test]
fn climbs_out_of_an_inline_module_to_the_file_it_is_written_in() {
    assert_eq!(declared("src/compact/inner/deep.rs", "super::super::flag", false), ["src/compact.rs"]);
}

#[cfg(feature = "grammars")]
#[test]
fn lands_an_item_of_an_inline_module_on_its_file_and_the_module_itself_on_nothing() {
    let asked = |request: &str| declared("src/lib.rs", request, true);
    assert_eq!(asked("crate::compact::inner::Thing"), ["src/compact.rs"]);
    assert!(asked("crate::compact::inner").is_empty());
    assert_eq!(asked("crate::shapes::inner::Thing"), ["src/shapes.rs"]);
    assert!(asked("crate::shapes::inner").is_empty());
    assert!(asked("crate::shapes::Missing").is_empty());
}

#[cfg(feature = "grammars")]
#[test]
fn takes_crate_from_a_file_no_module_declares_as_that_file() {
    assert_eq!(declared("tests/run.rs", "crate::helper::Help", false), ["tests/helper.rs"]);
}

/// Not a case of its own in `rust.test.ts`: the crate's `[package]` name is
/// how a `use` from another crate of the tree reaches it.
#[cfg(feature = "grammars")]
#[test]
fn reaches_a_crate_by_the_name_its_manifest_gives() {
    assert_eq!(declared("tests/run.rs", "kit::lexicon", false), ["src/lexicon.rs"]);
    assert_eq!(super::manifest_name("[workspace]\nmembers = []\n[package]\nname = 'a-b'\n[dependencies]\nname = \"c\"\n"), Some("a-b"));
    assert_eq!(super::manifest_name("[workspace]\nname = \"w\"\n"), None);
}
