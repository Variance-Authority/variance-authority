//! What `read_module` makes of a module held whole and handed to a function
//! the file declares: the names that function reads off its parameter are the
//! reads, at the lines that read them, and the module goes on whole only where
//! the walk cannot follow it further.

use oxc_allocator::Allocator;

use super::read_module;

/// Each `(request, its kind, name, line)` the module reads off a module it holds.
fn reads(source: &str) -> Vec<(String, &'static str, String, u32)> {
    let read = read_module("a.ts", source, &Allocator::default(), false);
    read.members
        .iter()
        .map(|member| {
            let request = &read.requests[member.request as usize];
            (request.value.clone(), request.kind.as_str(), member.name.clone(), member.line)
        })
        .collect()
}

fn read(value: &str, kind: &'static str, name: &str, line: u32) -> (String, &'static str, String, u32) {
    (value.to_owned(), kind, name.to_owned(), line)
}

#[test]
fn a_module_handed_to_a_function_the_file_declares_is_read_where_that_function_reads_it() {
    // `land.ts`'s shape: the parameter is typed by an alias of the module's
    // type, and the reads are the `import()`'s, not the type's; a function
    // declared above its call is followed as one declared below it.
    let source = concat!(
        "type M = typeof import('./m');\n",
        "function above(m: M) { return m.a; }\n",
        "export async function run() {\n",
        "  const m = await import('./m');\n",
        "  return above(m) + below(m);\n",
        "}\n",
        "function below(m: M) { return m.b; }\n",
    );
    assert_eq!(reads(source), [read("./m", "dynamic", "a", 2), read("./m", "dynamic", "b", 7)]);
}

#[test]
fn a_namespace_handed_on_through_functions_is_read_where_the_last_one_reads_it() {
    // A parameter handed on to another declared function, an arrow bound to a
    // `const` among them, and one that calls itself, is followed as far as it goes.
    let source = concat!(
        "import * as ns from './ns';\n",
        "const outer = (x: typeof ns, n: number): number => n > 0 ? outer(x, n - 1) : inner(x);\n",
        "function inner(y: typeof ns) { return y.deep; }\n",
        "outer(ns, 2);\n",
    );
    assert_eq!(reads(source), [read("./ns", "imports", "deep", 3)]);
}

#[test]
fn a_module_goes_on_whole_from_a_parameter_where_the_walk_cannot_follow_it() {
    // Handed to a function another module declares, stored in an object,
    // spread, or returned, the parameter is the module going on whole, at the
    // line that hands it on. A position the walk cannot pair — a pattern, a
    // rest, past a spread argument, or a method — goes on whole at the call.
    let source = concat!(
        "import * as ns from './ns';\n",
        "import { hold } from './hold';\n",
        "function handed(m: typeof ns) { hold(m); }\n",
        "function stored(m: typeof ns) { return { m }; }\n",
        "function spread(m: typeof ns) { return { ...m }; }\n",
        "function returned(m: typeof ns) { return m; }\n",
        "function pattern({ a }: typeof ns) { return a; }\n",
        "function rest(...all: unknown[]) { return all; }\n",
        "handed(ns); stored(ns); spread(ns); returned(ns);\n",
        "pattern(ns);\n",
        "rest(ns);\n",
        "handed(...[], ns);\n",
        "const o = { f(m: typeof ns) { return m.x; } };\n",
        "o.f(ns);\n",
    );
    let whole = |line| read("./ns", "imports", "*", line);
    assert_eq!(reads(source), [3, 4, 5, 6, 10, 11, 12, 14].map(whole));
}

#[test]
fn a_parameter_no_holder_reaches_reads_through_its_type_alone() {
    // A function whose callers are elsewhere keeps what its parameter's type
    // says it holds; a parameter a holder never reaches reads nothing.
    let source = concat!(
        "export function exported(m: typeof import('./typed')) { return m.t; }\n",
        "function plain(m: { z: number }) { return m.z; }\n",
        "plain({ z: 1 });\n",
    );
    assert_eq!(reads(source).into_iter().map(|(value, _, name, line)| (value, name, line)).collect::<Vec<_>>(), [("./typed".to_owned(), "t".to_owned(), 1)]);
}

#[test]
fn a_parameter_the_function_writes_is_not_followed() {
    // `m = {}` makes what `m` holds no longer the module, so a later `m.z` is
    // no read of it: the module goes on whole at the call instead.
    let source = concat!(
        "import * as ns from './ns';\n",
        "function rewritten(m: typeof ns) { m = {} as typeof ns; return m.z; }\n",
        "rewritten(ns);\n",
    );
    assert_eq!(reads(source), [read("./ns", "imports", "*", 3)]);
}

#[test]
fn a_parameter_only_an_empty_parameter_reaches_reads_through_its_type() {
    // `run`'s `x` holds no module, so handing it to `helper` hands nothing:
    // `helper` keeps what its parameter's type says it holds.
    let source = concat!(
        "function helper(m: typeof import('./lib')) { return m.a; }\n",
        "export function run(x) { return helper(x); }\n",
    );
    assert_eq!(reads(source), [read("./lib", "type", "a", 1)]);
}

#[test]
fn a_function_binding_the_file_reassigns_is_not_followed() {
    // After `f = other`, a call to `f` may not reach the body declared under
    // that name, so the module goes on whole at the call.
    let source = concat!(
        "import * as ns from './ns';\n",
        "import { other } from './other';\n",
        "function f(m: typeof ns) { return m.a; }\n",
        "f = other;\n",
        "f(ns);\n",
    );
    assert_eq!(reads(source), [read("./ns", "imports", "*", 5)]);
}
