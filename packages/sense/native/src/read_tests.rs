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

/// Each `(value, line)` a read takes for a request, and the reason it gives for
/// what it could not read.
fn required(file: &str, source: &str) -> (Vec<(String, u32)>, Option<String>) {
    let read = read_module(file, source, &Allocator::default(), false);
    let found = read.requests.into_iter().map(|request| (request.value, request.line)).collect();
    (found, read.unknown)
}

#[test]
fn a_require_written_in_a_comment_or_a_string_is_not_a_call() {
    let source = concat!(
        "// require('./line')\n",
        "/* require('./block') */\n",
        "const text = \"require('./string')\";\n",
        "const template = `require('./template')`;\n",
        "const real = require('./real');\n",
        "// require(name)\n",
        "const quoted = 'require(name)';\n",
    );
    assert_eq!(required("a.cjs", source), (vec![("./real".to_owned(), 5)], None));
}

#[test]
fn a_require_reads_a_template_without_expressions_and_skips_its_methods() {
    let source = concat!(
        "const a = require(`./plain`);\n",
        "const where = require.resolve('./resolved');\n",
        "const b = require(\n  './split'\n);\n",
    );
    assert_eq!(
        required("a.cjs", source),
        (vec![("./plain".to_owned(), 1), ("./split".to_owned(), 3)], None)
    );
}

#[test]
fn a_require_whose_specifier_is_not_a_constant_is_counted_unread() {
    let (found, unknown) = required("a.cjs", "const a = require(`./${name}`);\nconst b = require(name);\nconst c = require();\n");
    assert_eq!(found, []);
    assert_eq!(unknown.as_deref(), Some("3 `require()` call(s) with a specifier this cannot read"));
}

#[test]
fn an_import_equals_require_is_an_import() {
    let (found, unknown) = required("a.ts", "import fs = require('node:fs');\n// import x = require('./comment');\n");
    assert_eq!((found, unknown), (vec![("node:fs".to_owned(), 1)], None));
}

/// Each `(request value, name)` a read lists as a member, in the read's order.
fn members(source: &str) -> Vec<(String, String)> {
    let read = read_module("a.ts", source, &Allocator::default(), false);
    read.members
        .iter()
        .map(|member| (read.requests[member.request as usize].value.clone(), member.name.clone()))
        .collect()
}

#[test]
fn a_member_is_read_through_a_namespace_and_every_import_call_holder() {
    let source = concat!(
        "import * as ns from './ns';\n",
        "ns.a;\n",
        "const held = await import('./held');\n",
        "held.b;\n",
        "(await import('./awaited')).c;\n",
        "import('./then').then((loaded) => loaded.d);\n",
        "const { e } = await import('./destructured');\n",
        "const skipped = require('./required');\n",
        "const later = await import('./later');\n",
        "later.f;\n",
    );
    assert_eq!(
        members(source),
        [
            ("./ns", "a"),
            ("./held", "b"),
            ("./awaited", "c"),
            ("./then", "d"),
            ("./then", "then"),
            ("./destructured", "e"),
            ("./later", "f"),
        ]
            .map(|(value, name)| (value.to_owned(), name.to_owned()))
    );
}

#[test]
fn a_member_is_read_through_an_import_call_of_a_template() {
    assert_eq!(members("const t = await import(`./template`);\nt.f;\n"), [("./template".to_owned(), "f".to_owned())]);
}

/// Each `(value, kind, line)` a read takes, and the reason it gives for what it could not read.
fn loaded(file: &str, source: &str) -> (Vec<(String, &'static str, u32)>, Option<String>) {
    let read = read_module(file, source, &Allocator::default(), false);
    let found = read.requests.into_iter().map(|request| (request.value, request.kind.as_str(), request.line)).collect();
    (found, read.unknown)
}

#[test]
fn an_import_call_reads_a_template_without_expressions() {
    assert_eq!(loaded("a.ts", "const a = import(`./plain`);\n"), (vec![("./plain".to_owned(), "dynamic", 1)], None));
}

#[test]
fn an_import_call_of_a_joined_string_is_not_read() {
    // The text between the parentheses opens and closes with a quote, which is
    // all the text reading checked, so `a' + 'b` was a specifier.
    let (found, unknown) = loaded("a.ts", "const a = import('a' + 'b');\n");
    assert_eq!(found, []);
    assert_eq!(unknown.as_deref(), Some("an `import()` whose specifier is not a literal"));
}

#[test]
fn an_import_call_written_in_a_comment_or_a_string_is_not_a_call() {
    let source = concat!(
        "// import('./line')\n",
        "const text = \"import('./string')\";\n",
        "const real = import('./real');\n",
    );
    assert_eq!(loaded("a.ts", source), (vec![("./real".to_owned(), "dynamic", 3)], None));
}

#[test]
fn module_require_is_a_require_and_another_object_s_is_not() {
    let source = concat!(
        "const a = module.require('./module');\n",
        "const b = loader.require('./loader');\n",
        "const c = module.require(name);\n",
    );
    let (found, unknown) = loaded("a.cjs", source);
    assert_eq!(found, [("./module".to_owned(), "imports", 1)]);
    assert_eq!(unknown.as_deref(), Some("1 `require()` call(s) with a specifier this cannot read"));
}
