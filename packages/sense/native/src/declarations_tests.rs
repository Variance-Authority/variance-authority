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
        "export abstract class Base {}\n",
        "abstract class Unexported {}\n",
        "function* Stepped() {}\n",
        "let Later;\n",
        "function helper() {}\n",
        "const lower = 1;\n",
        "var Legacy = 1;\n",
        "const { Destructured } = props;\n",
    );
    assert_eq!(
        declares("Shapes.tsx", source),
        [
            "Arrow", "Base", "Defaulted", "Exported", "First", "Hidden", "Later", "Local", "Second", "Served",
            "Shown", "Stepped", "Typed", "Unexported",
        ],
    );
    assert_eq!(declares("Classy.tsx", "export default class Panel {}\n"), ["Panel"]);
    assert_eq!(declares("Page.tsx", "export default async function Page() { return null; }\n"), ["Page"]);
}

#[test]
fn any_name_that_starts_with_a_capital_is_declared_whole() {
    // The parser decides what an identifier is; a capital first is all a
    // component's name needs, whatever the alphabet and whatever follows.
    let source = "export function Styled$Button() { return null; }\nexport const Ölçü = () => null;\nconst Δ = 1;\nconst lower = 2;\n";
    assert_eq!(declares("Unicode.tsx", source), ["Styled$Button", "Ölçü", "Δ"]);
}

#[test]
fn declared_names_sort_by_code_unit() {
    // `𝐀` (U+1D400) is a surrogate pair from U+D835 in UTF-16, so it sorts
    // before `Ａ` (U+FF21) the way JavaScript's `<` sorts them; UTF-8 bytes put
    // it after.
    let source = "export const Ａ = 1;\nexport const 𝐀 = 2;\n";
    assert_eq!(declares("Wide.tsx", source), ["𝐀", "Ａ"]);
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


#[test]
fn a_name_typescript_declares_as_living_elsewhere_is_not_declared() {
    let source = concat!(
        "declare function Foo(): void;\n",
        "export declare const Bar: number;\n",
        "declare class Baz {}\n",
    );
    assert_eq!(declares("ambient.ts", source), Vec::<String>::new());
}

/// Deliberate: the names are read off the tree, and a file the parser cannot
/// recover has none. Nothing is guessed from its text; its `unknown` says the
/// file was not read, which is what a reader needs to tell it from a file that
/// declares nothing.
#[test]
fn a_file_the_parser_cannot_recover_declares_nothing_and_says_why() {
    let source = concat!(
        "// @flow\n",
        "type Props = {| label: string |};\n",
        "export function Button(props: Props) { return null; }\n",
    );
    let read = read_module("Button.js", source, &Allocator::default(), false);
    assert_eq!(read.declares, Vec::<String>::new());
    assert!(read.unknown.as_deref().is_some_and(|reason| reason.contains("parse error")), "{:?}", read.unknown);
}
