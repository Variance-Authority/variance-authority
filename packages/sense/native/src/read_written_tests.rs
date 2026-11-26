//! What `read_module` makes of a holder the file writes again: at a read, it
//! holds what the writes that may reach the read hold.

use oxc_allocator::Allocator;

use super::read_module;

/// Each `(request, name, line)` the module at `file` reads.
fn members(source: &str) -> Vec<(String, String, u32)> {
    let read = read_module("a.ts", source, &Allocator::default(), false);
    read.members.iter().map(|member| (read.requests[member.request as usize].value.clone(), member.name.clone(), member.line)).collect()
}

fn read(value: &str, name: &str, line: u32) -> (String, String, u32) {
    (value.to_owned(), name.to_owned(), line)
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
    assert_eq!(members(source), [read("./a", "before", 2), read("./a", "maybe", 4)]);
}

#[test]
fn a_read_off_a_holder_is_read_off_each_module_it_may_hold_there() {
    let source = concat!(
        "let m = await import('./a');\n",
        "if (offline) m = await import('./b');\n",
        "m.foo();\n",
    );
    assert_eq!(members(source), [read("./a", "foo", 3), read("./b", "foo", 3)]);
    let source = concat!(
        "let m = await import('./a');\n",
        "function later() {\n",
        "  m.inside();\n",
        "}\n",
        "m = other;\n",
        "m.after();\n",
    );
    assert_eq!(members(source), [read("./a", "inside", 3)]);
}

#[test]
fn a_write_in_a_branch_holds_in_that_branch_and_joins_what_was_held_after_it() {
    // `else` starts from what the binding held before `if`; `?:`, `&&` and
    // `??=` may not run.
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
    );
    assert_eq!(members(source), [read("./a", "otherwise", 6), read("./b", "inside", 4), read("./c", "both", 12), read("./d", "both", 12)]);
}

#[test]
fn a_break_or_a_continue_carries_what_is_held_where_it_jumps() {
    // Inside a loop, a `switch` or a label a write only adds: a jump from
    // above a later write carries what was held there past it.
    let jumped = |head: &str, tail: &str| format!("let m = await import('./a');\n{head}\n  m = await import('./b');\n  if (done()) break;\n  m = other;\n{tail}\nm.foo();\n");
    let both = [read("./a", "foo", 7), read("./b", "foo", 7)];
    assert_eq!(members(&jumped("while (more()) {", "}")), both);
    assert_eq!(members(&jumped("for (const next of list) {", "}")), both);
    assert_eq!(members(&jumped("for (const key in table) {", "}")), both);
    let source = concat!(
        "let m = await import('./a');\n",
        "switch (k) {\n",
        "  case 1:\n",
        "    m = await import('./b');\n",
        "    if (done()) break;\n",
        "    m = other;\n",
        "}\n",
        "m.foo();\n",
    );
    assert_eq!(members(source), [read("./a", "foo", 8), read("./b", "foo", 8)]);
    let source = concat!(
        "let m = await import('./a');\n",
        "while (more()) {\n",
        "  m = await import('./b');\n",
        "  if (skip()) continue;\n",
        "  m = other;\n",
        "}\n",
        "m.foo();\n",
    );
    assert_eq!(members(source), both);
    let source = concat!(
        "let m = await import('./a');\n",
        "found: {\n",
        "  if (x) break found;\n",
        "  m = await import('./b');\n",
        "  if (y) break found;\n",
        "  m = other;\n",
        "}\n",
        "m.foo();\n",
    );
    assert_eq!(members(source), [read("./a", "foo", 8), read("./b", "foo", 8)]);
    assert_eq!(members("let m = await import('./a');\nwhile (more()) m = other;\nm.foo();\n"), [read("./a", "foo", 3)]);
}

#[test]
fn a_catch_sees_what_the_try_held_anywhere_in_it() {
    // A throw may leave a `try` anywhere, so a write inside one only adds.
    let source = concat!(
        "let m = await import('./a');\n",
        "try {\n",
        "  m = await import('./b');\n",
        "  await risky();\n",
        "  m = other;\n",
        "} catch {\n",
        "  m.foo();\n",
        "}\n",
    );
    assert_eq!(members(source), [read("./a", "foo", 7), read("./b", "foo", 7)]);
    assert_eq!(members(&source.replace("catch", "finally")), [read("./a", "foo", 7), read("./b", "foo", 7)]);
    let source = concat!(
        "let m;\n",
        "try {\n",
        "  m = await import('./a');\n",
        "  m.ready();\n",
        "} catch {\n",
        "  m = await import('./b');\n",
        "}\n",
        "m.foo();\n",
    );
    assert_eq!(members(source), [read("./a", "foo", 8), read("./a", "ready", 4), read("./b", "foo", 8)]);
}

#[test]
fn a_function_may_run_at_any_time() {
    // A write inside one adds to what the binding holds from there on, which
    // no later write takes away; a read inside one sees what it was given above.
    let source = concat!(
        "let m = await import('./a');\n",
        "async function load() {\n",
        "  m = await import('./b');\n",
        "}\n",
        "m = other;\n",
        "await load();\n",
        "m.foo();\n",
    );
    assert_eq!(members(source), [read("./b", "foo", 7)]);
    let source = concat!(
        "let m = await import('./a');\n",
        "m = other;\n",
        "function later() {\n",
        "  m.foo();\n",
        "}\n",
    );
    assert_eq!(members(source), [read("./a", "foo", 4)]);
}

#[test]
fn a_write_inside_an_expression_that_may_not_run_only_adds() {
    // Only a write that is a statement of its own, an element of one's
    // sequence, or what a plain `=` there assigns surely runs where it stands:
    // an optional call's argument, a default, the right of a logical
    // assignment and an instance field's value may not.
    let source = concat!(
        "let m = await import('./a');\n",
        "maybe?.(m = other);\n",
        "const { y = (m = other) } = options;\n",
        "({ z = (m = other) } = options);\n",
        "[w = (m = other)] = list;\n",
        "k ??= (m = other);\n",
        "k ||= (m = other, 1);\n",
        "k &&= (m = other);\n",
        "class C { x = (m = other); }\n",
        "m.foo();\n",
    );
    assert_eq!(members(source), [read("./a", "foo", 10)]);
}

#[test]
fn a_type_query_off_a_written_holder_reads_each_module_it_is_given() {
    // A type names the binding's declared type, which no write narrows.
    assert_eq!(members("let m = await import('./a');\nm = createStub();\nlet x: typeof m.foo;\n"), [read("./a", "foo", 3)]);
}
