//! The component names a module declares, as `read_module` reads them.

use oxc_allocator::Allocator;

use crate::read::read_module;

fn declares(file: &str, source: &str) -> Vec<String> {
    read_module(file, source, &Allocator::default(), false).declares
}

#[test]
fn a_declaration_in_a_block_comment_is_not_declared() {
    let source = concat!(
        "/*\n",
        "export function Retired() { return null; }\n",
        "class Old {}\n",
        "*/\n",
        "export function Button() { return null; }\n",
    );
    assert_eq!(declares("Button.tsx", source), ["Button"]);
}

#[test]
fn a_declaration_in_a_line_comment_is_not_declared() {
    let source = concat!(
        "// export const Retired = () => null;\n",
        "    // function Old() {}\n",
        "export const Button = () => null;\n",
    );
    assert_eq!(declares("Button.tsx", source), ["Button"]);
}

#[test]
fn a_declaration_in_a_template_literal_is_not_declared() {
    let source = concat!(
        "export const snippet = `\n",
        "export function Generated() { return null; }\n",
        "const Other = 1;\n",
        "class Emitted {}\n",
        "`;\n",
    );
    assert_eq!(declares("snippet.ts", source), Vec::<String>::new());
}

#[test]
fn a_declaration_in_a_jsdoc_example_is_not_declared() {
    // Written both ways a JSDoc block is: an example under a leading `*` and
    // one without it, which is the form a line scan read as code.
    let source = concat!(
        "/**\n",
        " * @example\n",
        " * const Usage = () => <Button />;\n",
        " */\n",
        "export function Button() { return null; }\n",
        "/**\n",
        "  @example\n",
        "  function Demo() { return <Card />; }\n",
        "*/\n",
        "export class Card {}\n",
    );
    assert_eq!(declares("Button.tsx", source), ["Button", "Card"]);
}

#[test]
fn every_shape_a_component_is_written_in_is_declared() {
    let source = concat!(
        "export function Exported() { return null; }\n",
        "export default function Defaulted() { return null; }\n",
        "function Local() { return null; }\n",
        "export async function Served() { return null; }\n",
        "export const Arrow = () => null;\n",
        "let Typed: Component = () => null;\n",
        "const First = 1, Second = 2;\n",
        "export class Shown {}\n",
        "class Hidden {}\n",
        "function helper() {}\n",
        "const lower = 1;\n",
        "var Legacy = 1;\n",
        "const { Destructured } = props;\n",
    );
    assert_eq!(
        declares("Shapes.tsx", source),
        ["Arrow", "Defaulted", "Exported", "First", "Hidden", "Local", "Second", "Served", "Shown", "Typed"],
    );
    assert_eq!(declares("Classy.tsx", "export default class Panel {}\n"), ["Panel"]);
}

#[test]
fn a_name_bound_inside_a_function_is_not_declared_by_the_module() {
    let source = concat!(
        "export function Outer() {\n",
        "  const Inner = () => null;\n",
        "  function Nested() { return null; }\n",
        "  class Local {}\n",
        "  return Inner;\n",
        "}\n",
    );
    assert_eq!(declares("Outer.tsx", source), ["Outer"]);
}

#[test]
fn a_test_story_or_declaration_file_declares_nothing() {
    let source = "export function Button() { return null; }\n";
    for file in ["Button.test.tsx", "Button.spec.tsx", "Button.stories.tsx", "button.d.ts"] {
        assert_eq!(declares(file, source), Vec::<String>::new(), "{file}");
    }
}
