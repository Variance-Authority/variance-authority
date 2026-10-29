//! What one file uses of the names it declares at its top level.

use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::SourceType;

use super::own_uses_in;
use crate::read::Lines;

fn uses(text: &str, source_type: SourceType) -> Vec<(String, u32)> {
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, text, source_type).parse();
    let built = SemanticBuilder::new().build(&parsed.program);
    own_uses_in(&parsed.program, built.semantic.scoping(), &Lines::new(text))
        .into_iter()
        .map(|found| (found.name, found.line))
        .collect()
}

fn one(name: &str, line: u32) -> (String, u32) {
    (name.to_owned(), line)
}

#[test]
fn a_call_a_value_and_a_type_of_a_top_level_name_are_uses_and_its_declaration_is_not() {
    let found = uses(
        "export function passedOn(a: number): number {\n  return a;\n}\ntype Shape = { a: number };\nconst held: Shape = { a: passedOn(1) };\nexport const twice = () => passedOn(held.a);\n",
        SourceType::ts(),
    );
    assert_eq!(found, vec![one("Shape", 5), one("passedOn", 5), one("held", 6), one("passedOn", 6)]);
}

#[test]
fn a_local_of_the_same_name_shadows_the_top_level_one() {
    let found = uses(
        "function greet() {}\nfunction a(greet: () => void) {\n  greet();\n}\nfunction b() {\n  const greet = 1;\n  return greet;\n}\nfunction c() {\n  function greet() {}\n  greet();\n}\nconst d = [1].map((greet) => greet);\ntry {} catch (greet) { greet; }\nfor (const { greet } of []) greet;\ngreet();\n",
        SourceType::ts(),
    );
    assert_eq!(found, vec![one("greet", 16)]);
}

#[test]
fn a_property_key_and_a_member_are_no_uses_and_neither_is_an_export_of_it() {
    let found = uses(
        "import { other } from './other.js';\nconst greet = 1;\nconst o = { greet: 2 };\no.greet;\nother(o);\nexport { greet };\nexport { greet as salute };\nexport default greet;\nconst short = { greet };\n",
        SourceType::ts(),
    );
    // The shorthand property is the value `greet`: a use. So is the call of
    // what the import binds, a use of the other file's name in this one.
    assert_eq!(found, vec![one("o", 4), one("o", 5), one("other", 5), one("greet", 9)]);
}

#[test]
fn a_file_that_only_imports_uses_what_its_imports_bind_under_the_name_it_binds() {
    let found = uses(
        "import { greet as hail } from './greet.js';
import type { Shape } from './shape.js';
import * as all from './all.js';
hail(all.x as Shape);
function local(hail: string) {
  return hail;
}
export { hail };
",
        SourceType::ts(),
    );
    assert_eq!(found, vec![one("Shape", 4), one("all", 4), one("hail", 4)]);
}

#[test]
fn a_jsx_tag_and_a_typeof_are_uses() {
    let found = uses(
        "function Card() { return null; }\nexport const Page = () => <Card />;\nconst size = 1;\ntype Size = typeof size;\n",
        SourceType::tsx(),
    );
    assert_eq!(found, vec![one("Card", 2), one("size", 4)]);
}

#[test]
fn two_uses_on_one_line_are_one_line() {
    let found = uses("const a = 1;\nconst b = a + a;\n", SourceType::ts());
    assert_eq!(found, vec![one("a", 2)]);
}

#[test]
fn a_file_whose_every_declaration_is_exported_uses_its_names() {
    let found = uses(
        "export function greet(name: string): string {\n  return name;\n}\nexport const hello = greet('hello');\nexport const hi = greet('hi');\nexport const hey = greet('hey');\n",
        SourceType::ts(),
    );
    assert_eq!(found, vec![one("greet", 4), one("greet", 5), one("greet", 6)]);
}

#[test]
fn a_key_of_the_object_the_module_hands_out_passes_the_name_on() {
    let found = uses(
        "function recorder() {}\nfunction scoped() {\n  return recorder();\n}\nexport = { recorder, scoped: scoped, later: () => recorder(), [`name`]: recorder.name };\n",
        SourceType::ts(),
    );
    assert_eq!(found, vec![one("recorder", 3), one("recorder", 5)]);
    let found = uses("function hush() {}\nmodule.exports = { hush };\nconst other = { hush };\n", SourceType::cjs());
    assert_eq!(found, vec![one("hush", 3)]);
}

#[test]
fn a_key_of_an_object_with_unspelled_keys_is_a_use() {
    // The object exports nothing, so naming a declaration in it passes nothing on.
    let found = uses("function a() {}\nexport = {\n  a,\n  ...rest,\n};\n", SourceType::ts());
    assert_eq!(found, vec![one("a", 3)]);
}
