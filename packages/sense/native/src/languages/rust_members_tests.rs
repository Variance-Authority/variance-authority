use super::{member_declarations, member_uses};
use crate::grammar::{parse, Grammar};

fn declared(source: &str) -> Vec<(String, u32, String)> {
    let tree = parse(Grammar::Rust, source).expect("parses");
    member_declarations(&tree, source).into_iter().map(|it| (it.name, it.line, it.on)).collect()
}

fn used(source: &str) -> Vec<(String, u32, String, String)> {
    let tree = parse(Grammar::Rust, source).expect("parses");
    member_uses(&tree, source).into_iter().map(|it| (it.name, it.line, it.of, it.how)).collect()
}

fn one(name: &str, line: u32, of: &str, how: &str) -> (String, u32, String, String) {
    (name.to_owned(), line, of.to_owned(), how.to_owned())
}

#[test]
fn declares_named_fields_variants_and_the_fields_of_a_struct_like_variant() {
    let source = "struct P {\n    size: u32,\n}\nstruct T(u32);\nunion U { bits: u32 }\nenum E {\n    Dot,\n    Square { size: u32 },\n    Pair(u8, u8),\n}\nfn f() { struct Inner { deep: u8 } }\n";
    assert_eq!(declared(source), vec![
        ("size".to_owned(), 2, "P".to_owned()),
        ("bits".to_owned(), 5, "U".to_owned()),
        ("Dot".to_owned(), 7, "E".to_owned()),
        ("Square".to_owned(), 8, "E".to_owned()),
        ("size".to_owned(), 8, "E::Square".to_owned()),
        ("Pair".to_owned(), 9, "E".to_owned()),
        ("deep".to_owned(), 11, "Inner".to_owned()),
    ]);
}

#[test]
fn a_field_read_through_a_typed_parameter_a_reference_or_a_pointer_names_its_type() {
    let source = "fn f(a: P, b: &P, c: &mut P, d: Box<P>, e: std::rc::Rc<P>, g: Wrap<u8>) {\n    a.x;\n    b.x;\n    c.x;\n    d.x;\n    e.x;\n    g.x;\n}\n";
    assert_eq!(used(source), vec![
        one("x", 2, "P", "read"),
        one("x", 3, "P", "read"),
        one("x", 4, "P", "read"),
        one("x", 5, "P", "read"),
        one("x", 7, "Wrap", "read"),
    ]);
}

#[test]
fn self_and_self_paths_are_the_impl_type_and_a_trait_s_are_none() {
    let source = "impl P {\n    fn f(&mut self) {\n        self.x = 1;\n        self.y += 1;\n        let r = &mut self.z;\n        let s = &self.w;\n        Self { x: 1 };\n    }\n}\nimpl<T> Wrap<T> { fn g(&self) { self.x; } }\ntrait Tr { fn h(&self) { self.x; } }\n";
    assert_eq!(used(source), vec![
        one("x", 3, "P", "write"),
        one("y", 4, "P", "write"),
        one("z", 5, "P", "write"),
        one("w", 6, "P", "read"),
        one("x", 7, "P", "write"),
        one("x", 10, "Wrap", "read"),
    ]);
}

#[test]
fn a_method_call_a_tuple_field_and_an_untyped_receiver_are_no_field_use() {
    let source = "fn f(p: P, q: (u8,)) {\n    p.go();\n    q.0;\n    p.0;\n    make().x;\n    p.inner.x;\n}\n";
    assert_eq!(used(source), vec![one("inner", 6, "P", "read")]);
}

#[test]
fn a_binding_without_a_type_shadows_the_typed_one_for_its_scope() {
    let source = "fn f(p: P) {\n    { let p = 3; p.x; }\n    p.x;\n    let g = |p| p.x;\n    for p in v { p.x; }\n    match o { Some(p) => p.x, _ => 0 };\n    if let Some(p) = o { p.x; }\n    p.y;\n}\n";
    assert_eq!(used(source), vec![one("x", 3, "P", "read"), one("y", 8, "P", "read")]);
}

#[test]
fn a_let_types_its_name_by_its_annotation_or_by_the_struct_literal_of_one_name_it_binds() {
    let source = "fn f() {\n    let a: P = make();\n    a.x;\n    let b = Q { y: 1 };\n    b.y;\n    let c = m::R { z: 1 };\n    c.z;\n}\n";
    assert_eq!(used(source), vec![
        one("x", 3, "P", "read"),
        one("y", 4, "Q", "write"),
        one("y", 5, "Q", "read"),
        // A file cannot tell the module `m` from an enum `m`: the join can.
        one("R", 6, "m", "write"),
        one("z", 6, "m::R", "write"),
    ]);
}

#[test]
fn a_struct_literal_writes_and_a_struct_pattern_destructures_each_field_it_names() {
    let source = "fn f(p: P) {\n    let n = P {\n        x: 1,\n        y,\n        ..p\n    };\n    let P { x, y: renamed, .. } = p;\n    match p { P { x: 0, .. } => {}, _ => {} }\n}\n";
    assert_eq!(used(source), vec![
        one("x", 3, "P", "write"),
        one("y", 4, "P", "write"),
        one("x", 7, "P", "destructure"),
        one("y", 7, "P", "destructure"),
        one("x", 8, "P", "destructure"),
    ]);
}

#[test]
fn a_variant_is_built_in_an_expression_and_destructured_in_a_pattern() {
    let source = "impl E { fn d() -> Self { Self::Dot } }\nfn f(e: E) {\n    let a = E::Pair(1, 2);\n    let b = E::Square { size: 1 };\n    match e {\n        E::Dot => {}\n        E::Pair(x, _) => {}\n        E::Square { size } => {}\n        m::E::Dot => {}\n    }\n}\n";
    assert_eq!(used(source), vec![
        one("Dot", 1, "E", "write"),
        one("Pair", 3, "E", "write"),
        one("Square", 4, "E", "write"),
        one("size", 4, "E::Square", "write"),
        one("Dot", 6, "E", "destructure"),
        one("Pair", 7, "E", "destructure"),
        one("Square", 8, "E", "destructure"),
        one("size", 8, "E::Square", "destructure"),
    ]);
}

#[test]
fn a_macro_s_tokens_read_a_typed_receiver_s_field_and_name_a_variant() {
    let source = "fn f(p: &P) {\n    assert!(p.x > 0);\n    println!(\"{}\", p.go());\n    vec![E::Dot, m::E::Dot];\n    set!(p.y = 1);\n}\n";
    assert_eq!(used(source), vec![
        one("x", 2, "P", "read"),
        one("Dot", 4, "E", "read"),
        one("y", 5, "P", "write"),
    ]);
}

#[test]
fn a_use_path_names_no_variant() {
    assert_eq!(used("use shapes::Props;\nuse E::{Dot, Square};\n"), vec![]);
}

#[test]
fn a_variant_is_declared_and_reached_by_a_path_and_a_field_is_not() {
    let source = "struct P { size: u32 }\nenum E { Dot, Square { size: u32 } }\nfn f(p: &P) {\n    p.size;\n    E::Dot;\n    P::size(p);\n    E::Square { size: 1 };\n    vec![E::Dot];\n}\n";
    let tree = parse(Grammar::Rust, source).expect("parses");
    let variants: Vec<(String, String)> = member_declarations(&tree, source).into_iter().filter(|it| it.variant).map(|it| (it.name, it.on)).collect();
    assert_eq!(variants, vec![("Dot".to_owned(), "E".to_owned()), ("Square".to_owned(), "E".to_owned())]);
    let paths: Vec<(String, u32)> = member_uses(&tree, source).into_iter().filter(|it| it.variant).map(|it| (it.name, it.line)).collect();
    assert_eq!(paths, vec![("Dot".to_owned(), 5), ("size".to_owned(), 6), ("Square".to_owned(), 7), ("Dot".to_owned(), 8)]);
}

#[test]
fn a_match_guard_reads_and_binds_nothing() {
    let source = "fn f(p: &P, o: Option<u32>) {\n    match o {\n        Some(n) if p.size > n =>\n            p.size,\n        _ => 0,\n    };\n}\n";
    assert_eq!(used(source), vec![one("size", 3, "P", "read"), one("size", 4, "P", "read")]);
}

#[test]
fn an_if_let_binds_in_its_branch_and_not_in_its_else() {
    let source = "fn f(p: &P, o: Option<u32>) {\n    if let Some(p) = o { p.x; } else { p.y; }\n}\n";
    assert_eq!(used(source), vec![one("y", 2, "P", "read")]);
}

#[test]
fn a_for_loop_reads_its_iterable_before_its_pattern_binds() {
    let source = "fn f(p: &P) {\n    for p in p.children.iter() { p.x; }\n}\n";
    assert_eq!(used(source), vec![one("children", 2, "P", "read")]);
}

#[test]
fn a_field_through_a_field_names_the_type_the_file_declares_it_as() {
    let source = "struct Outer { inner: P, boxed: Box<Q>, n: u32 }\nimpl Outer { fn f(&self) { self.inner.size; self.boxed.deep.x; self.n.x; } }\nfn g(o: &Outer) { o.inner.size = 1; }\n";
    assert_eq!(used(source), vec![
        one("size", 2, "P", "read"),
        one("inner", 2, "Outer", "read"),
        one("deep", 2, "Q", "read"),
        one("boxed", 2, "Outer", "read"),
        one("n", 2, "Outer", "read"),
        one("size", 3, "P", "write"),
        one("inner", 3, "Outer", "read"),
    ]);
}
