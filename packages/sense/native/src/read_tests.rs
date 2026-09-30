//! What `read_module` makes of a request's type-only spelling.

use oxc_allocator::Allocator;

use super::{read_module, Read};

fn read(source: &str) -> Read {
    read_module("a.ts", source, &Allocator::default(), false)
}

fn kinds(source: &str) -> Vec<(String, &'static str)> {
    read(source)
        .requests
        .into_iter()
        .map(|request| (request.value, request.kind.as_str()))
        .collect()
}

#[test]
fn only_the_statement_keyword_makes_a_request_type_only() {
    let source = concat!(
        "import type { A } from './a';\n",
        "import { type B } from './b';\n",
        "import { type C, D } from './c';\n",
        "import type {} from './d';\n",
        "export type { E } from './e';\n",
        "export { type F } from './f';\n",
        "export type * from './g';\n",
    );
    assert_eq!(
        kinds(source),
        [
            ("./a", "type"),
            ("./b", "imports"),
            ("./c", "imports"),
            ("./d", "type"),
            ("./e", "type"),
            ("./f", "reexports"),
            ("./g", "type"),
        ]
        .map(|(value, kind)| (value.to_owned(), kind))
    );
}

#[test]
fn an_inline_type_name_is_still_type_only_itself() {
    let bindings = &read("import { type B } from './b';\n").requests[0].bindings;
    assert!(bindings.iter().all(|binding| binding.type_only));
}

#[test]
fn a_republished_request_is_type_only_when_every_statement_says_so() {
    assert_eq!(
        kinds("export type { A } from './x';\nexport { type B } from './x';\n"),
        [("./x".to_owned(), "reexports")]
    );
    assert_eq!(
        kinds("export type { A } from './x';\nexport type * from './x';\n"),
        [("./x".to_owned(), "type")]
    );
}
