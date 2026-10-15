//! What one file declares of a member: the line and the container it is on.

use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;

use super::member_declarations_in;
use crate::read::Lines;

fn on(text: &str, name: &str) -> Vec<(u32, String)> {
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, text, SourceType::ts()).parse();
    member_declarations_in(&parsed.program, &Lines::new(text))
        .into_iter()
        .filter(|declared| declared.name == name)
        .map(|declared| (declared.line, declared.on))
        .collect()
}

#[test]
fn names_the_container_of_each_declaration() {
    let text = "interface Scanner {\n  m?(): void;\n}\ntype Held = {\n  m: number;\n};\nclass Impl {\n  m() {}\n}\nfunction f(x: { m: 1 }) {}\nconst o = { m: 1 };\nx.m();\n";
    let found = on(text, "m");
    let found: Vec<(u32, &str)> = found.iter().map(|(line, on)| (*line, on.as_str())).collect();
    assert_eq!(found, vec![(2, "Scanner"), (5, "Held"), (8, "Impl"), (10, "a type literal")]);
}

#[test]
fn a_constraint_is_not_the_alias_body() {
    let found = on("type X<T extends { m: 1 }> = {\n  m: 2;\n};\n", "m");
    assert_eq!(found, vec![(1, "a type literal".to_owned()), (2, "X".to_owned())]);
}

#[test]
fn a_constructor_parameter_property_is_a_member() {
    let found = on("class Held {\n  constructor(private m: string, n: number) {}\n}\n", "m");
    assert_eq!(found, vec![(2, "Held".to_owned())]);
    assert!(on("class Held {\n  constructor(m: string) {}\n}\n", "m").is_empty());
}

#[test]
fn records_every_member_by_name() {
    let allocator = Allocator::default();
    let text = "interface A {\n  x: 1;\n  y(): void;\n}\nclass B {\n  ['computed' + 1] = 2;\n  z = 3;\n}\n";
    let parsed = Parser::new(&allocator, text, SourceType::ts()).parse();
    let names: Vec<String> = member_declarations_in(&parsed.program, &Lines::new(text)).into_iter().map(|declared| declared.name).collect();
    assert_eq!(names, ["x", "y", "z"]);
}
