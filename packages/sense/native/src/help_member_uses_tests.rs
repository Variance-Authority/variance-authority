//! What one file uses of a member, through a value whose type it writes.

use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;

use super::typed_in;
use crate::read::Lines;

fn uses(text: &str) -> Vec<(String, u32, String, String)> {
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, text, SourceType::ts()).parse();
    typed_in(&parsed.program, &Lines::new(text))
        .uses
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

fn uses_tsx(text: &str) -> Vec<(String, u32, String, String)> {
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, text, SourceType::tsx()).parse();
    typed_in(&parsed.program, &Lines::new(text))
        .uses
        .into_iter()
        .map(|found| (found.name, found.line, found.of, found.how))
        .collect()
}

fn carried(text: &str) -> Vec<(String, String)> {
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, text, SourceType::tsx()).parse();
    typed_in(&parsed.program, &Lines::new(text)).carries.into_iter().map(|carry| (carry.on, carry.of)).collect()
}

fn carry(on: &str, of: &str) -> (String, String) {
    (on.to_owned(), of.to_owned())
}

#[test]
fn a_return_type_types_the_literal_returned() {
    let found = uses("function f(): Props {\n  const inner = (): Other => ({ label: '' });\n  return { size: 1 };\n}\nconst g = (): Props | undefined => ({ size: 2 });\nfunction h() {\n  return { size: 3 };\n}\n");
    assert_eq!(found, vec![one("label", 2, "Other", "write"), one("size", 3, "Props", "write"), one("size", 5, "Props", "write")]);
}

#[test]
fn this_inside_a_class_is_the_class_and_every_type_it_carries() {
    let found = uses("class Box extends Base implements Props, ns.Skip {\n  grow() {\n    const f = () => this.size;\n    return function () { return this.size; };\n  }\n}\nfunction free(this: Props) {\n  return this.label;\n}\n");
    assert_eq!(found, vec![one("size", 3, "Box", "read"), one("size", 3, "Base", "read"), one("size", 3, "Props", "read"), one("label", 8, "Props", "read")]);
}

#[test]
fn a_react_component_type_types_its_first_parameter() {
    let text = "import type { FC as Comp } from 'react';\nimport * as React from 'react';\nimport { FC } from './mine';\nexport const A: Comp<Props> = ({ size }) => size;\nexport const B: React.FunctionComponent<Props> = function (props) { return props.size; };\nexport const C: FC<Props> = (props) => props.size;\nexport const D: React.FC<Props> = (props: Other) => props.size;\n";
    assert_eq!(uses_tsx(text), vec![one("size", 4, "Props", "destructure"), one("size", 5, "Props", "read"), one("size", 7, "Other", "read")]);
}

#[test]
fn a_jsx_attribute_writes_a_member_of_the_component_it_renders() {
    let found = uses_tsx("export const page = (\n  <Box size={1} label=\"\" {...rest}>\n    <div size={2} />\n    <Lib.Item size={3} />\n  </Box>\n);\n");
    assert_eq!(found, vec![one("size", 2, "Box", "write"), one("label", 2, "Box", "write")]);
}

#[test]
fn an_indexed_access_type_reads_the_member_it_names() {
    let found = uses("type Size = Props['size'];\ntype Many = Props[number];\n");
    assert_eq!(found, vec![one("size", 1, "Props", "read")]);
}

#[test]
fn a_container_carries_the_members_of_each_type_it_extends_implements_or_takes() {
    let text = "interface Wide extends Props, ns.Skip {}\ntype Mixed = Props & Other & { label: string };\ntype Same = Props;\nclass Box extends Base implements Props {}\nimport type { FC } from 'react';\nconst Button: FC<Props> = () => null;\nfunction Plain(props: Props) { return null; }\nconst Arrow = ({ size }: Props) => size;\nconst none = () => null;\n";
    assert_eq!(
        carried(text),
        vec![
            carry("Wide", "Props"),
            carry("Mixed", "Props"),
            carry("Mixed", "Other"),
            carry("Same", "Props"),
            carry("Box", "Base"),
            carry("Box", "Props"),
            carry("Button", "Props"),
            carry("Plain", "Props"),
            carry("Arrow", "Props"),
        ]
    );
}
