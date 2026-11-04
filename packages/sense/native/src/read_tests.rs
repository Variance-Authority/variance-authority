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
            ("./destructured", "e"),
            ("./later", "f"),
        ]
            .map(|(value, name)| (value.to_owned(), name.to_owned()))
    );
}

#[test]
fn a_promise_is_not_the_module_it_loads() {
    // `.then` and `.x` off an `import()` that is not awaited read the promise:
    // neither is an export of the module.
    assert_eq!(members("import('./promised').x;\nconst { y } = import('./unawaited');\n"), []);
}

#[test]
fn a_destructured_import_call_takes_each_name_it_destructures() {
    let source = concat!(
        "const [{ a }, { b: local, c }, , whole, { d }] = await Promise.all([\n",
        "  import('./first'), import('./second'), import('./skipped'), import('./whole'), import('./fifth'),\n",
        "]);\n",
        "const { e, ...rest } = await import('./rested');\n",
        "rest.f;\n",
        "const { g } = (await import('./cast')) as typeof import('./cast');\n",
        "Promise.all([import('./then')]).then(([{ h }]) => h);\n",
        "const [{ i }] = await Promise.all([...spread, import('./after-spread')]);\n",
        "const [{ j }] = await Promise.allSettled([import('./settled')]);\n",
        "whole.k;\n",
    );
    assert_eq!(
        members(source),
        [
            ("./first", "a"),
            ("./second", "b"),
            ("./second", "c"),
            ("./whole", "k"),
            ("./fifth", "d"),
            ("./rested", "e"),
            ("./rested", "f"),
            ("./cast", "g"),
            ("./then", "h"),
            // Past a spread no position is known, and `allSettled` wraps each
            // module in a result: either holds it whole where the walk cannot follow.
            ("./after-spread", "*"),
            ("./settled", "*"),
        ]
            .map(|(value, name)| (value.to_owned(), name.to_owned()))
    );
}

#[test]
fn an_assignment_destructures_an_import_call_as_a_declaration_does() {
    let source = concat!(
        "let a, b, local, held;\n",
        "({ a } = await import('./assigned'));\n",
        "({ d: local } = await import('./renamed'));\n",
        "[{ b }] = await Promise.all([import('./all')]);\n",
        "held = await import('./held');\n",
        "held.c;\n",
    );
    assert_eq!(
        members(source),
        [("./assigned", "a"), ("./renamed", "d"), ("./all", "b"), ("./held", "c")].map(|(value, name)| (value.to_owned(), name.to_owned()))
    );
}

/// Each `(value, name, through default)` a read takes, in the order of the parse.
fn members_off(source: &str) -> Vec<(String, String, bool)> {
    let read = read_module("a.ts", source, &Allocator::default(), false);
    read.members
        .iter()
        .map(|member| (read.requests[member.request as usize].value.clone(), member.name.clone(), member.through_default))
        .collect()
}

#[test]
fn a_name_read_off_the_default_of_an_import_call_is_read_through_default() {
    // Under interop the `default` of a CommonJS module is its `module.exports`:
    // the names off it are the module's, and the read says it went through
    // `default`, one level deep; a name off one of those is a value's.
    let source = concat!(
        "const { a } = (await import('./off')).default;\n",
        "const { default: { b, c: local } } = await import('./keyed');\n",
        "(await import('./read')).default.d.deeper;\n",
        "const held = (await import('./held')).default;\n",
        "held.e;\n",
        "const { f } = (await import('./cast')).default as typeof import('./cast');\n",
    );
    let off = |value: &str, name: &str, through: bool| (value.to_owned(), name.to_owned(), through);
    assert_eq!(
        members_off(source),
        [
            off("./off", "a", true),
            off("./off", "default", false),
            off("./keyed", "b", true),
            off("./keyed", "c", true),
            off("./keyed", "default", false),
            off("./read", "d", true),
            off("./read", "default", false),
            off("./held", "default", false),
            off("./held", "e", true),
            off("./cast", "default", false),
            off("./cast", "f", true),
        ]
    );
}

#[test]
fn a_module_held_whole_that_escapes_is_a_read_of_star() {
    // Passed, returned, stored or read by a key the reader cannot spell, the
    // module is read whole where it goes, so the names it reads are not
    // recorded: `*` says so at the line it escapes. A discarded `import()` is
    // a side effect, and a read off the promise is the promise's.
    let source = concat!(
        "import * as ns from './ns';\n",
        "import * as kept from './kept';\n",
        "use(ns);\n",
        "kept.a;\n",
        "kept[key];\n",
        "const m = await import('./held');\n",
        "store.m = m;\n",
        "export const lazy = () => import('./lazy');\n",
        "this.x = await import('./member');\n",
        "import('./effect');\n",
        "await import('./awaited-effect');\n",
        "const p = import('./promise');\n",
        "import('./passed').then(load);\n",
        "import('./used').then(() => done());\n",
        "const all = await Promise.all([import('./array')]);\n",
        "const [first, ...others] = await Promise.all([import('./first'), import('./other')]);\n",
    );
    assert_eq!(
        members(source),
        [
            ("./ns", "*"),
            ("./kept", "*"),
            ("./kept", "a"),
            ("./held", "*"),
            ("./lazy", "*"),
            ("./member", "*"),
            ("./promise", "*"),
            ("./passed", "*"),
            ("./array", "*"),
            ("./other", "*"),
        ]
            .map(|(value, name)| (value.to_owned(), name.to_owned()))
    );
}

#[test]
fn a_member_is_read_through_an_import_equals_require() {
    // TypeScript's `import x = require('m')` holds the module whole, as a
    // namespace import does, from its own line on, as the `const` it compiles
    // to does; a type-only one holds it for its types. Its request follows the stated
    // ones and every `import()`, so `./later`'s read names the index past it.
    let source = concat!(
        "whole.early;\n",
        "import whole = require('./whole');\n",
        "import type typed = require('./typed');\n",
        "whole.a;\n",
        "whole['b'];\n",
        "type X = typeof typed.x;\n",
        "const later = await import('./later');\n",
        "later.c;\n",
    );
    assert_eq!(
        members(source),
        [("./later", "c"), ("./whole", "a"), ("./whole", "b"), ("./typed", "x")].map(|(value, name)| (value.to_owned(), name.to_owned()))
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

#[test]
fn a_module_held_whole_escapes_only_where_its_own_binding_is_read_as_a_value() {
    // A holder is the binding, not its spelling: a parameter named the same is
    // another value. A type query reads the type, a write replaces the value,
    // and `.catch`/`.finally` on the promise still hand on the module.
    let source = concat!(
        "import * as ns from './ns';\n",
        "const mod = await import('./mod');\n",
        "mod.a;\n",
        "xs.map((mod) => String(mod));\n",
        "function g(mod: unknown) { return mod; }\n",
        "type T = typeof mod;\n",
        "type U = typeof ns;\n",
        "let r = await import('./r');\n",
        "r.b;\n",
        "r = null;\n",
        "import('./caught').catch(() => {});\n",
        "await import('./finally').finally(done);\n",
        "import('./then').then(() => {}).catch(report);\n",
        "const k = await import('./k').catch(() => null);\n",
        "k.c;\n",
    );
    assert_eq!(
        members(source),
        [("./mod", "a"), ("./r", "b"), ("./k", "c")].map(|(value, name)| (value.to_owned(), name.to_owned()))
    );
}

#[test]
fn the_default_of_a_module_moving_is_a_use_of_default_not_the_module_passed_on() {
    // React.lazy and next/dynamic take the `default` and render it: that is a
    // use of `default`, certain, and the module's other names are not read.
    // `.default.default` is the same interop level, followed, not dropped.
    let source = concat!(
        "const { default: Page } = await import('./page');\n",
        "const view = <Page />;\n",
        "const Other = (await import('./other')).default;\n",
        "use(Other);\n",
        "const twice = await import('./twice');\n",
        "twice.default.default.x;\n",
    );
    let read = read_module("a.tsx", source, &Allocator::default(), false);
    let found: Vec<(String, String, bool)> = read.members
        .iter()
        .map(|member| (read.requests[member.request as usize].value.clone(), member.name.clone(), member.through_default))
        .collect();
    assert_eq!(
        found,
        [("./page", "default", false), ("./other", "default", false), ("./twice", "default", false), ("./twice", "x", true)]
            .map(|(value, name, off)| (value.to_owned(), name.to_owned(), off))
    );
}

#[test]
fn a_module_goes_on_whole_where_the_walk_does_not_follow_it() {
    // A promise held in a name is not the module, so awaiting it later is not
    // followed and the `import()` is the module going on whole; so is an
    // awaited `import()` handed to a call, an exported holder, and a rest
    // written to a property. A parameter that reuses a holder's name is
    // another value, so its read is no read of the module.
    let source = concat!(
        "const p = import('./promised');\n",
        "const { a } = await p;\n",
        "register(await import('./registered'));\n",
        "const mod = await import('./mod');\n",
        "xs.map((mod) => mod.z);\n",
        "export const exported = await import('./exported');\n",
        "({ b, ...o.rest } = await import('./rest'));\n",
        "const named = await import('./named');\n",
        "export { named };\n",
    );
    assert_eq!(
        members(source),
        [("./promised", "*"), ("./registered", "*"), ("./exported", "*"), ("./rest", "*"), ("./rest", "b"), ("./named", "*")]
            .map(|(value, name)| (value.to_owned(), name.to_owned()))
    );
}

#[test]
fn a_file_whose_only_holders_are_import_equals_resolves_them() {
    // The module record lists no `import m = require()`, so a file with no
    // `import()` and no namespace still resolves the holders it writes, bare
    // or exported; exported, the module goes on whole to every importer.
    let source = concat!("import bare = require('./bare');\n", "export import kept = require('./kept');\n", "bare.a;\n", "kept.b;\n");
    assert_eq!(members(source), [("./bare", "a"), ("./kept", "*"), ("./kept", "b")].map(|(value, name)| (value.to_owned(), name.to_owned())));
}

#[test]
fn a_namespace_imported_and_exported_by_its_local_name_is_passed_on_as_export_star_as() {
    // `import * as g; export { g }` is `export * as g from`: the record keeps
    // it a local export, since the name binds a namespace object, and the
    // reader passes it on as the module record passes a named import it exports.
    let source = concat!(
        "import * as g from './greet';\n",
        "import { other } from './greet';\n",
        "export { g, g as h, other };\n",
    );
    let read = read(source);
    let mut exports: Vec<_> = read
        .exports
        .iter()
        .map(|it| (it.exported.clone().unwrap_or_default(), it.from.clone().unwrap_or_default(), it.imported.clone().unwrap_or_default()))
        .collect();
    exports.sort();
    assert_eq!(
        exports,
        [("g", "./greet", "*"), ("h", "./greet", "*"), ("other", "./greet", "other")].map(|(a, b, c)| (a.to_owned(), b.to_owned(), c.to_owned()))
    );
    let republished: Vec<_> = read.requests.iter().filter(|it| it.republishes).map(|it| it.value.clone()).collect();
    assert_eq!(republished, ["./greet"]);
    // Passed on by name, the namespace does not go on whole from its import.
    assert_eq!(members(source), Vec::<(String, String)>::new());
}

#[test]
fn an_anonymous_default_export_binds_the_declaration_named_default() {
    // `export default function () {}` has no identifier, and the harvest names
    // its declaration `default`, so the export binds that name as a named
    // default binds its own.
    let read = read("export default function (name: string): string {\n  return name;\n}\n");
    let exports: Vec<_> = read.exports.iter().map(|it| (it.exported.clone(), it.local.clone())).collect();
    assert_eq!(exports, [(Some("default".to_owned()), Some("default".to_owned()))]);
}
