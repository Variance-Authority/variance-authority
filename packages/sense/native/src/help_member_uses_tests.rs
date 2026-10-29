//! What one file uses of a member, through a value whose type it writes.

use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;

use super::member_uses_in;
use crate::read::Lines;

fn uses(text: &str) -> Vec<(String, u32, String, String)> {
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, text, SourceType::ts()).parse();
    member_uses_in(&parsed.program, &Lines::new(text))
        .into_iter()
        .map(|found| (found.name, found.line, found.of, found.how))
        .collect()
}

fn one(name: &str, line: u32, of: &str, how: &str) -> (String, u32, String, String) {
    (name.to_owned(), line, of.to_owned(), how.to_owned())
}

#[test]
fn a_read_through_an_annotated_binding_names_its_type() {
    let found = uses("function f(props: Props, p?: Box<Props> | undefined) {\n  return props.size + p?.['size'] + props.size;\n}\n");
    assert_eq!(found, vec![one("size", 2, "Props", "read"), one("size", 2, "Box", "read")]);
}

#[test]
fn an_assignment_or_an_update_writes() {
    let found = uses("let props: Props;\nprops.size = 1;\nprops.size += 1;\nprops.count++;\nconst x = props.size;\n");
    assert_eq!(found, vec![one("size", 2, "Props", "write"), one("size", 3, "Props", "write"), one("count", 4, "Props", "write"), one("size", 5, "Props", "read")]);
}

#[test]
fn an_object_literal_written_as_a_type_writes_its_keys() {
    let found = uses("const a: Props = { size: 1 };\nconst b = { label: '' } as Props;\nconst c = { size: 2, ...a } satisfies Props;\nconst d = { size: 3 };\n");
    assert_eq!(found, vec![one("size", 1, "Props", "write"), one("label", 2, "Props", "write"), one("size", 3, "Props", "write")]);
}

#[test]
fn an_annotated_pattern_destructures() {
    let found = uses("const f = ({ size, label: shown = '' }: Props) => size;\nfunction g(props: Props) {\n  const { size } = props;\n}\n");
    assert_eq!(found, vec![one("size", 1, "Props", "destructure"), one("label", 1, "Props", "destructure"), one("size", 3, "Props", "destructure")]);
}

#[test]
fn a_cast_types_the_value_it_casts() {
    let found = uses("const f = (value: unknown) => (value as Props).size + (<Props>value).label + (value as Props)!.size;\n");
    assert_eq!(found, vec![one("size", 1, "Props", "read"), one("label", 1, "Props", "read")]);
}

#[test]
fn a_binding_that_shadows_an_annotated_one_names_no_type() {
    let found = uses("function f(props: Props) {\n  [1].map((props) => props.size);\n  { let props = 1; props.size; }\n  for (const props of []) props.size;\n  return props.size;\n}\n");
    assert_eq!(found, vec![one("size", 5, "Props", "read")]);
}

#[test]
fn a_type_the_source_does_not_name_is_no_use() {
    let found = uses("function f(o: { size: number }, n: ns.Props, u: A | B, a: Props) {\n  const copy = a;\n  return o.size + n.size + u.size + copy.size + make().size + a.b.size;\n}\n");
    assert_eq!(found, vec![one("b", 3, "Props", "read")]);
}

#[test]
fn a_class_that_implements_a_type_implements_each_instance_member_it_names() {
    let found = uses(
        "class Real extends Base implements Deps, ns.Other, Box<Props> {\n  constructor() { super(); }\n  static readJourney() {}\n  readJourney() {}\n  size = 1;\n  accessor count = 2;\n  #hidden = 3;\n  ['computed']() {}\n}\nclass Plain { readJourney() {} }\n",
    );
    assert_eq!(
        found,
        vec![
            one("readJourney", 4, "Deps", "implement"),
            one("size", 5, "Deps", "implement"),
            one("count", 6, "Deps", "implement"),
            one("readJourney", 4, "Box", "implement"),
            one("size", 5, "Box", "implement"),
            one("count", 6, "Box", "implement"),
        ]
    );
}
