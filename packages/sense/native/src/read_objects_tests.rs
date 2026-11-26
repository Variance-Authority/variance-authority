//! What `read_module` makes of a module held as an object: the `default` a
//! default import binds, a module a type names, and the object a module hands
//! out whole.

use oxc_allocator::Allocator;

use super::read_module;

/// Each `(request, name, line, through default)` the module at `file` reads.
fn members(file: &str, source: &str) -> Vec<(String, String, u32, bool)> {
    let read = read_module(file, source, &Allocator::default(), false);
    read.members
        .iter()
        .map(|member| (read.requests[member.request as usize].value.clone(), member.name.clone(), member.line, member.through_default))
        .collect()
}

fn read(value: &str, name: &str, line: u32, through: bool) -> (String, String, u32, bool) {
    (value.to_owned(), name.to_owned(), line, through)
}

#[test]
fn a_named_value_handed_out_whole_is_the_default_export_bound_to_its_name() {
    let exported = |file: &str, source: &str| -> Vec<(Option<String>, Option<String>, u32)> {
        let read = read_module(file, source, &Allocator::default(), false);
        read.exports.into_iter().map(|export| (export.exported, export.local, export.line)).collect()
    };
    let default = |local: &str, line: u32| (Some("default".to_owned()), Some(local.to_owned()), line);
    assert_eq!(exported("a.cts", "\nexport = function babel() {};\n"), [default("babel", 2)]);
    assert_eq!(exported("a.cts", "export = class Reader {};\n"), [default("Reader", 1)]);
    assert_eq!(exported("a.cjs", "module.exports = function babel() {};\n"), [default("babel", 1)]);
    assert!(exported("a.cts", "export = function () {};\n").is_empty());
    assert!(exported("a.cjs", "module.exports = function a() {};\nmodule.exports = function b() {};\n").is_empty());
}

#[test]
fn an_object_handed_out_whole_exports_each_key_it_spells() {
    let exported = |file: &str, source: &str| -> Vec<(Option<String>, Option<String>, u32)> {
        let read = read_module(file, source, &Allocator::default(), false);
        read.exports.into_iter().map(|export| (export.exported, export.local, export.line)).collect()
    };
    let one = |exported: &str, local: Option<&str>, line: u32| (Some(exported.to_owned()), local.map(str::to_owned), line);
    assert_eq!(
        exported("a.cts", "function a() {}\n\nexport = {\n  a,\n  b: a,\n  c() {},\n};\n"),
        [one("a", Some("a"), 4), one("b", Some("a"), 5), one("c", None, 6)]
    );
    // A spread or a computed key hands out names no reader can spell.
    assert!(exported("a.cts", "function a() {}\nexport = { a, ...rest };\n").is_empty());
    assert!(exported("a.cts", "function a() {}\nexport = { a, [key]: 1 };\n").is_empty());
    assert_eq!(exported("a.cjs", "function hush() {}\nmodule.exports = { hush };\n"), [one("hush", Some("hush"), 2)]);
    assert!(exported("a.cjs", "exports.hush = function () {};\nmodule.exports.quiet = 1;\n").is_empty());
}

#[test]
fn a_module_that_hands_itself_out_keeps_no_recorded_reach() {
    let reach = |source: &str| -> Vec<Option<&'static str>> {
        read_module("a.ts", source, &Allocator::default(), true).symbols.iter().map(|symbol| symbol.reach).collect()
    };
    assert_eq!(reach("import x from './x';\nfunction a() {}\n"), [Some("file")]);
    assert_eq!(reach("import x from './x';\nfunction a() {}\nmodule.exports = { a };\n"), [None]);
    assert_eq!(reach("import x from './x';\nfunction a() {}\nexport = { a };\n"), [None]);
}

#[test]
fn a_default_import_holds_the_module_default() {
    // A name read off it is read through `default`, and a type-only one holds
    // it for its types; passed on, it is the `default` moving, which the
    // binding already records.
    let source = concat!(
        "import kit from './kit';\n",
        "import type typed from './typed';\n",
        "kit.recorder();\n",
        "kit['scoped'];\n",
        "type X = typeof typed.x;\n",
        "use(kit);\n",
    );
    assert_eq!(members("a.ts", source), [read("./kit", "recorder", 3, true), read("./kit", "scoped", 4, true), read("./typed", "x", 5, true)]);
}

#[test]
fn a_type_query_reads_the_name_off_a_holder() {
    let source = concat!(
        "import * as ns from './ns';\n",
        "import kit from './kit';\n",
        "type A = ReturnType<typeof ns.a>;\n",
        "type B = typeof kit.b.deeper;\n",
        "type C = ns.C;\n",
        "import type * as types from './types';\n",
        "type D = ReturnType<typeof types.d>;\n",
    );
    assert_eq!(
        members("a.ts", source),
        [read("./ns", "C", 5, false), read("./ns", "a", 3, false), read("./kit", "b", 4, true), read("./types", "d", 7, false)]
    );
}

#[test]
fn a_typeof_import_reads_no_name_until_what_it_types_is_read() {
    // `typeof import('m')` names the module's type: it reads no name, and what
    // it types holds the module, whether a cast, an annotation or an alias
    // writes it, however late the alias is declared. Passed on, the value takes
    // the module whole. A cast holds in place, with no variable. What a call
    // returns is TypeScript's answer, so the reader does not establish what a
    // call given the type as its argument holds, and `M['g']` off a module
    // type reads `g`.
    let source = concat!(
        "const cast = load('./m') as typeof import('./m');\n",
        "cast.a();\n",
        "type Lib = typeof import('./m');\n",
        "export const use = (lib: Lib) => lib.b;\n",
        "const annotated: typeof import('./m') = load('./m');\n",
        "annotated.c;\n",
        "function late(held: Later) {\n  return held.d;\n}\n",
        "type Later = typeof import('./m');\n",
        "const spread = { ...(await original<typeof import('./m')>()) };\n",
        "const actual = await original<typeof import('./m')>();\nactual.f;\n",
        "function away(lib: Lib) {\n  return pass(lib);\n}\n",
        "type Named = typeof import('./m').e;\n",
        "type Picked = Parameters<Lib['g']>;\n",
        "(load('./m') as typeof import('./m')).h();\n",
    );
    let found = members("a.ts", source);
    assert_eq!(
        found,
        [
            read("./m", "a", 2, false),
            read("./m", "*", 15, false),
            read("./m", "b", 4, false),
            read("./m", "g", 18, false),
            read("./m", "c", 6, false),
            read("./m", "d", 8, false),
            read("./m", "e", 17, false),
            read("./m", "h", 19, false),
        ]
    );
}

#[test]
fn a_holder_written_with_another_value_reads_nothing_of_the_module_after_the_write() {
    // Before the write the binding holds the module. A write that may not run
    // leaves it holding the module where it still may. After a write on every
    // path it holds the other value, and a name read off it is not the module's.
    let source = concat!(
        "let m = await import('./a');\n",
        "m.before();\n",
        "if (x) m = other;\n",
        "m.maybe();\n",
        "m = other;\n",
        "m.after();\n",
    );
    assert_eq!(members("a.ts", source), [read("./a", "before", 2, false), read("./a", "maybe", 4, false)]);
}

#[test]
fn a_read_off_a_holder_is_read_off_each_module_it_may_hold_there() {
    // A write that may not run adds what it holds to what the binding held. A
    // function may run at any time, so a read inside one reads the module the
    // binding held above it, whatever a later write on every path holds.
    let source = concat!(
        "let m = await import('./a');\n",
        "if (offline) m = await import('./b');\n",
        "m.foo();\n",
    );
    assert_eq!(members("a.ts", source), [read("./a", "foo", 3, false), read("./b", "foo", 3, false)]);
    let source = concat!(
        "let m = await import('./a');\n",
        "function later() {\n",
        "  m.inside();\n",
        "}\n",
        "m = other;\n",
        "m.after();\n",
    );
    assert_eq!(members("a.ts", source), [read("./a", "inside", 3, false)]);
}

#[test]
fn a_write_in_a_branch_holds_in_that_branch_and_joins_what_was_held_after_it() {
    // `else` starts from what the binding held before `if`; `?:`, `&&` and
    // `??=` may not run; a write inside a function may run after any other.
    let source = concat!(
        "let m = await import('./a');\n",
        "if (x) {\n",
        "  m = await import('./b');\n",
        "  m.inside();\n",
        "} else {\n",
        "  m.otherwise();\n",
        "}\n",
        "m = other;\n",
        "x ? (m = await import('./c')) : m.unset();\n",
        "x && (m = other);\n",
        "m ??= await import('./d');\n",
        "m.both();\n",
        "const swap = async () => (m = await import('./e'));\n",
        "m = other;\n",
        "m.last();\n",
    );
    assert_eq!(
        members("a.ts", source),
        [
            read("./a", "otherwise", 6, false),
            read("./b", "inside", 4, false),
            read("./c", "both", 12, false),
            read("./d", "both", 12, false),
            read("./e", "last", 15, false),
        ]
    );
}
