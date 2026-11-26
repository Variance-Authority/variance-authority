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
fn a_write_in_a_loop_reaches_the_reads_above_it_the_next_time_round() {
    // The body of `while`, `for` and `for … of` may not run, and that of
    // `do … while` runs once at least. A `for` update runs after the body.
    let round = |head: &str, tail: &str| format!("let m = await import('./a');\n{head}\n  m.foo();\n  m = await import('./b');\n{tail}\nm.bar();\n");
    let around = [read("./a", "bar", 6), read("./a", "foo", 3), read("./b", "bar", 6), read("./b", "foo", 3)];
    assert_eq!(members(&round("while (more()) {", "}")), around);
    assert_eq!(members(&round("for (const next of list) {", "}")), around);
    assert_eq!(members(&round("do {", "} while (more());")), [read("./a", "foo", 3), read("./b", "bar", 6), read("./b", "foo", 3)]);
    let source = concat!(
        "let m = await import('./a');\n",
        "for (let i = 0; i < 2; m = await import('./b'), i++) {\n",
        "  m.foo();\n",
        "}\n",
    );
    assert_eq!(members(source), [read("./a", "foo", 3), read("./b", "foo", 3)]);
    let source = concat!(
        "let m = await import('./a');\n",
        "for (let i = 0; i < 3; m = other) {\n",
        "  m.foo();\n",
        "}\n",
        "m.bar();\n",
    );
    assert_eq!(members(source), [read("./a", "bar", 5), read("./a", "foo", 3)]);
    assert_eq!(members("let m = await import('./a');\nwhile (more()) m = other;\nm.foo();\n"), [read("./a", "foo", 3)]);
}

#[test]
fn a_break_or_a_continue_carries_what_is_held_where_it_jumps() {
    let source = concat!(
        "let m = await import('./a');\n",
        "found: {\n",
        "  if (x) break found;\n",
        "  m = other;\n",
        "}\n",
        "m.foo();\n",
    );
    assert_eq!(members(source), [read("./a", "foo", 6)]);
    let source = concat!(
        "let m = await import('./a');\n",
        "while (more()) {\n",
        "  m = await import('./b');\n",
        "  if (done()) break;\n",
        "  m = other;\n",
        "}\n",
        "m.foo();\n",
    );
    assert_eq!(members(source), [read("./a", "foo", 7), read("./b", "foo", 7)]);
    let source = concat!(
        "let m = await import('./a');\n",
        "while (more()) {\n",
        "  m.foo();\n",
        "  m = await import('./b');\n",
        "  if (skip()) continue;\n",
        "  m = other;\n",
        "}\n",
    );
    assert_eq!(members(source), [read("./a", "foo", 3), read("./b", "foo", 3)]);
    // A case is entered from the `switch`, or from the case above it when
    // that one does not break; with no `default`, none may run.
    let source = concat!(
        "let m = await import('./a');\n",
        "switch (k) {\n",
        "  case 1:\n",
        "    m = await import('./b');\n",
        "    break;\n",
        "  case 2:\n",
        "    m.foo();\n",
        "}\n",
        "m.bar();\n",
    );
    assert_eq!(members(source), [read("./a", "bar", 9), read("./a", "foo", 7), read("./b", "bar", 9)]);
    // A `break` leaves the innermost loop or `switch`, or the statement its
    // label names, and a `continue` goes back to the innermost loop's head,
    // or that of the loop its label names: no other.
    let source = concat!(
        "let m = await import('./a');\n",
        "while (more()) {\n",
        "  switch (k) {\n",
        "    case 1:\n",
        "      m = await import('./b');\n",
        "      break;\n",
        "  }\n",
        "  m = other;\n",
        "}\n",
        "m.foo();\n",
    );
    assert_eq!(members(source), [read("./a", "foo", 10)]);
    let source = concat!(
        "let m = await import('./a');\n",
        "outer: while (more()) {\n",
        "  m.foo();\n",
        "  while (again()) {\n",
        "    m = await import('./b');\n",
        "    continue outer;\n",
        "  }\n",
        "  m = other;\n",
        "}\n",
    );
    assert_eq!(members(source), [read("./a", "foo", 3), read("./b", "foo", 3)]);
}

#[test]
fn a_catch_sees_what_the_try_held_anywhere_in_it() {
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
fn a_function_or_an_instance_field_may_run_at_any_time() {
    // A read inside one sees every write of the binding, below it too, and a
    // write inside one reaches every read, above it too.
    let source = concat!(
        "let m = await import('./a');\n",
        "function later() {\n",
        "  m.foo();\n",
        "}\n",
        "m = await import('./b');\n",
        "later();\n",
    );
    assert_eq!(members(source), [read("./a", "foo", 3), read("./b", "foo", 3)]);
    let source = concat!(
        "let m = await import('./a');\n",
        "m = other;\n",
        "later();\n",
        "m.foo();\n",
        "function later() {\n",
        "  m = await import('./b');\n",
        "}\n",
    );
    assert_eq!(members(source), [read("./b", "foo", 4)]);
    // An instance field's value runs at `new`.
    assert_eq!(members("let m = await import('./a');\nclass C { x = (m = other); }\nm.foo();\n"), [read("./a", "foo", 3)]);
    let source = concat!(
        "let m = await import('./a');\n",
        "class C { x = m.foo(); }\n",
        "m = await import('./b');\n",
        "new C();\n",
    );
    assert_eq!(members(source), [read("./a", "foo", 2), read("./b", "foo", 2)]);
}

#[test]
fn a_write_inside_an_expression_that_may_not_run_only_adds() {
    // Only a write that is a statement of its own, or a `for` init, surely
    // runs where it stands: an optional call's argument and a default may not.
    let source = concat!(
        "let m = await import('./a');\n",
        "maybe?.(m = other);\n",
        "const { y = (m = other) } = options;\n",
        "({ z = (m = other) } = options);\n",
        "[w = (m = other)] = list;\n",
        "m.foo();\n",
    );
    assert_eq!(members(source), [read("./a", "foo", 6)]);
}

#[test]
fn an_exported_holder_goes_on_whole_with_every_module_it_is_given() {
    // An importer reads the binding at any time after the module ran.
    let source = concat!(
        "let m = await import('./a');\n",
        "export { m };\n",
        "m = await import('./b');\n",
    );
    assert_eq!(members(source), [read("./a", "*", 2), read("./b", "*", 2)]);
    assert_eq!(members("export let m = await import('./a');\nm = await import('./b');\n"), [read("./a", "*", 1), read("./b", "*", 1)]);
}

#[test]
fn a_type_query_off_a_written_holder_reads_each_module_it_is_given() {
    // A type names the binding's declared type, which no write narrows.
    assert_eq!(members("let m = await import('./a');\nm = createStub();\nlet x: typeof m.foo;\n"), [read("./a", "foo", 3)]);
}
