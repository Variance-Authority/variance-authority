//! What one Rust file uses of the items it declares at its top level.

use super::own_uses;
use crate::grammar::{self, Grammar};

fn uses(text: &str) -> Vec<(String, u32)> {
    let tree = grammar::parse(Grammar::Rust, text).expect("parses");
    own_uses(&tree, text).into_iter().map(|found| (found.name, found.line)).collect()
}

fn one(name: &str, line: u32) -> (String, u32) {
    (name.to_owned(), line)
}

#[test]
fn a_call_a_type_and_a_path_head_of_a_top_level_item_are_uses_and_its_declaration_is_not() {
    let found = uses(concat!(
        "pub fn passed_on(a: u32) -> u32 {\n",
        "    a\n",
        "}\n",
        "struct Shape { a: u32 }\n",
        "impl Shape {\n",
        "    fn new() -> Shape { Shape { a: passed_on(1) } }\n",
        "}\n",
        "fn make() -> u32 { Shape::new().a + self::passed_on(2) }\n",
    ));
    assert_eq!(found, vec![one("Shape", 5), one("Shape", 6), one("passed_on", 6), one("Shape", 8), one("passed_on", 8)]);
}

#[test]
fn a_local_of_the_same_name_shadows_the_top_level_item() {
    let found = uses(concat!(
        "fn greet() {}\n",
        "fn a(greet: fn()) { greet(); }\n",
        "fn b() { let greet = 1; greet; }\n",
        "fn c() { let f = |greet: u32| greet; }\n",
        "fn d(x: Option<u32>) { match x { Some(greet) => greet, None => 0 }; }\n",
        "fn e(x: Option<u32>) { if let Some(greet) = x { greet; } }\n",
        "fn f() { for greet in 0..1 { greet; } }\n",
        "fn g() { fn greet() {} greet(); }\n",
        "fn h() { let x = greet(); let greet = x; greet; }\n",
    ));
    assert_eq!(found, vec![one("greet", 9)]);
}

#[test]
fn a_field_a_method_and_a_path_tail_are_no_uses() {
    let found = uses(concat!(
        "fn size() -> u32 { 1 }\n",
        "struct Box { size: u32 }\n",
        "fn read(b: Box) -> u32 { b.size + b.size() + other::size() }\n",
        "fn build() -> Box { let size = 2; Box { size } }\n",
    ));
    assert_eq!(found, vec![one("Box", 3), one("Box", 4)]);
}

#[test]
fn a_generic_parameter_shadows_a_top_level_type() {
    let found = uses("struct T;\nfn f<T>(x: T) -> T { x }\nfn g(x: T) -> T { x }\n");
    assert_eq!(found, vec![one("T", 3)]);
}

#[test]
fn an_inline_module_sees_the_file_through_super() {
    let found = uses(concat!(
        "fn helper() -> u32 { 1 }\n",
        "mod plain {\n",
        "    fn x() -> u32 { helper() }\n",
        "}\n",
        "#[cfg(test)]\n",
        "mod tests {\n",
        "    use super::*;\n",
        "    #[test]\n",
        "    fn it() { assert_eq!(helper(), 1); }\n",
        "}\n",
        "mod named {\n",
        "    use super::helper as h;\n",
        "    fn y() -> u32 { h() + super::helper() }\n",
        "}\n",
    ));
    // `helper` in `plain` names nothing the file declares: an inline module
    // sees only what it imports.
    assert_eq!(found, vec![one("helper", 9), one("helper", 12), one("helper", 13)]);
}

#[test]
fn a_macro_argument_and_a_macro_of_the_file_are_uses() {
    let found = uses(concat!(
        "macro_rules! twice { ($e:expr) => { $e + $e }; }\n",
        "fn one() -> u32 { 1 }\n",
        "fn f() -> String { format!(\"{}\", twice!(one())) }\n",
        "fn g(x: u32) { println!(\"{x}\", x = x.one); }\n",
    ));
    assert_eq!(found, vec![one("one", 3), one("twice", 3)]);
}

#[test]
fn a_const_in_a_pattern_is_a_use_and_a_binding_of_another_name_is_not() {
    let found = uses("const LIMIT: u32 = 3;\nfn f(x: u32) -> bool { match x { LIMIT => true, other => other > LIMIT } }\n");
    assert_eq!(found, vec![one("LIMIT", 2)]);
}
