//! What `read_module` makes of a name read off a value inside a module: `ns.x`
//! after `import { ns } from 'm'`, or `lib.ns.x` after `import * as lib from
//! 'm'`, which reads `x` of a module only when `m` passes `ns` on as a
//! namespace, which the query decides.

use oxc_allocator::Allocator;

use super::read_module;

/// Each `(request, binding.within…, name, line)` the module reads off a value inside a module.
fn binding_members(source: &str) -> Vec<(String, String, String, u32)> {
    let read = read_module("a.tsx", source, &Allocator::default(), false);
    read.binding_members
        .iter()
        .map(|member| {
            let path = std::iter::once(member.binding.as_str()).chain(member.within.iter().map(String::as_str)).collect::<Vec<_>>().join(".");
            (read.requests[member.request as usize].value.clone(), path, member.name.clone(), member.line)
        })
        .collect()
}

fn read(value: &str, path: &str, name: &str, line: u32) -> (String, String, String, u32) {
    (value.to_owned(), path.to_owned(), name.to_owned(), line)
}

#[test]
fn a_name_read_off_a_named_binding_is_recorded_under_the_name_it_imports() {
    let source = concat!(
        "import { shout, other as renamed } from './lib';\n",
        "shout.greet('a');\n",
        "const { quiet } = shout;\n",
        "shout['loud'];\n",
        "renamed.size;\n",
        "const held = shout;\n",
        "held.again;\n",
    );
    assert_eq!(
        binding_members(source),
        [
            read("./lib", "other", "size", 5),
            read("./lib", "shout", "again", 7),
            read("./lib", "shout", "greet", 2),
            read("./lib", "shout", "loud", 4),
            read("./lib", "shout", "quiet", 3),
        ]
    );
}

#[test]
fn a_type_query_off_a_named_binding_reads_each_name_off_the_one_before() {
    let source = "import type { shout } from './lib';\nexport type Greet = typeof shout.greet.length;\n";
    assert_eq!(binding_members(source), [read("./lib", "shout", "greet", 2), read("./lib", "shout.greet", "length", 2)]);
}

#[test]
fn a_name_read_off_a_name_read_off_a_namespace_import_is_recorded_under_the_first() {
    let source = concat!(
        "import * as lib from './lib';\n",
        "lib.shout.greet('a');\n",
        "const { quiet } = lib.shout;\n",
        "const inner = lib.outer.inner;\n",
        "inner.deep;\n",
        "lib['shout']['loud'];\n",
    );
    assert_eq!(
        binding_members(source),
        [
            read("./lib", "outer", "inner", 4),
            read("./lib", "outer.inner", "deep", 5),
            read("./lib", "shout", "greet", 2),
            read("./lib", "shout", "loud", 6),
            read("./lib", "shout", "quiet", 3),
        ]
    );
}

#[test]
fn a_name_read_off_a_name_read_off_a_default_import_is_recorded_under_default() {
    let source = "import loud from './loud';\nloud.shout.greet('a');\n";
    assert_eq!(binding_members(source), [read("./loud", "default.shout", "greet", 2)]);
}

#[test]
fn a_jsx_or_type_name_read_off_a_name_read_off_a_holder_is_recorded_under_the_first() {
    let source = concat!(
        "import * as lib from './lib';\n",
        "import { outer } from './lib';\n",
        "export const a = <lib.ui.Button />;\n",
        "export type T = lib.types.Props;\n",
        "export type U = outer.inner.Props;\n",
    );
    assert_eq!(
        binding_members(source),
        [
            read("./lib", "types", "Props", 4),
            read("./lib", "ui", "Button", 3),
            read("./lib", "outer", "inner", 5),
            read("./lib", "outer.inner", "Props", 5),
        ]
    );
}

#[test]
fn a_named_binding_that_escapes_or_is_shadowed_reads_nothing_by_name() {
    let source = concat!(
        "import { shout } from './lib';\n",
        "export const all = [shout];\n",
        "export { shout };\n",
        "function f(shout: { x: number }) {\n",
        "  return shout.x;\n",
        "}\n",
        "shout.default.inner;\n",
    );
    assert_eq!(binding_members(source), [read("./lib", "shout", "default", 7)]);
    let read = read_module("a.ts", source, &Allocator::default(), false);
    assert_eq!(read.members, []);
}

#[test]
fn a_name_destructured_off_a_holder_holds_the_value_it_takes() {
    let source = concat!(
        "import * as lib from './lib';\n",
        "const { shout } = lib;\n",
        "shout.greet('a');\n",
        "const { quiet: { hush } } = lib;\n",
        "hush.deep;\n",
        "let loud;\n",
        "({ loud } = lib);\n",
        "loud.again;\n",
        "let still;\n",
        "({ calm: { still } } = lib);\n",
        "still.more;\n",
    );
    assert_eq!(
        binding_members(source),
        [
            read("./lib", "calm", "still", 10),
            read("./lib", "calm.still", "more", 11),
            read("./lib", "loud", "again", 8),
            read("./lib", "quiet", "hush", 4),
            read("./lib", "quiet.hush", "deep", 5),
            read("./lib", "shout", "greet", 3),
        ]
    );
    // A destructured binding is the module's value under a local name, as an
    // import binds one; a `let` it is assigned to later declares its own name.
    let read = read_module("a.ts", source, &Allocator::default(), true);
    let declared: Vec<_> = read.symbols.iter().map(|it| it.name.as_str()).collect();
    assert_eq!(declared, ["loud", "still"]);
}

#[test]
fn an_exported_destructured_binding_declares_its_name() {
    // The export publishes the binding, so the binding is what says what it is,
    // as `export const shout = lib.shout` would; the reads off it are followed all the same.
    let source = concat!(
        "import lib from './lib';\n",
        "export const { shout } = lib;\n",
        "const { quiet } = lib;\n",
        "export { quiet as hush };\n",
        "const { calm } = lib;\n",
        "shout.greet('a');\n",
    );
    let module = read_module("a.ts", source, &Allocator::default(), true);
    let declared: Vec<_> = module.symbols.iter().map(|it| it.name.as_str()).collect();
    assert_eq!(declared, ["shout", "quiet"]);
    assert_eq!(binding_members(source), [read("./lib", "default.shout", "greet", 6)]);
}
