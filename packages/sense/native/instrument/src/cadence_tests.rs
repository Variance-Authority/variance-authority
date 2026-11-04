//! The test cut's tests: where a test body's statements are cut.

use super::*;

fn cut(source: &str) -> String {
    cadence(source, "a.test.ts", false).expect("it parses and has a test").code
}

#[test]
fn each_statement_of_a_test_body_is_cut_on_its_own_line() {
    let source = "import { it } from 'vitest';\nit('adds', () => {\n  const x = add(1, 2);\n  expect(x).toBe(3);\n});\n";
    let out = cut(source);
    assert_eq!(out.lines().count(), source.lines().count());
    assert!(out.contains("  __vaC(3);const x = add(1, 2);\n  __vaC(4);expect(x).toBe(3);\n"), "{out}");
}

#[test]
fn a_probe_already_in_the_body_is_not_a_statement_of_the_test() {
    // In a page the probes go in first, so the cut reads them.
    let out = cut("it('adds', () => {__va(1);\n  add(1, 2);\n});\n");
    assert!(out.contains("() => {__va(1);\n  __vaC(2);add(1, 2);\n"), "{out}");
    // Nor is the dormant capture a body with parameters opens with.
    let out = cut("it('adds', ({ a }) => {__va(1);__vaL&&__vaL(1,\"a\",a);\n  add(a);\n});\n");
    assert!(out.contains("__vaL&&__vaL(1,\"a\",a);\n  __vaC(2);add(a);\n"), "{out}");
    assert!(!out.contains("__vaC(1)"), "{out}");
}

#[test]
fn a_probe_on_a_transformed_text_is_not_a_statement_of_the_test() {
    // A region that fires several authored ones probes each in a sequence, and
    // one that fires none, which only the project wrote, probes `void 0`.
    let out = cut("it('adds', () => {__va(1),__va(2);\n  add(1, 2);void 0;\n  done();\n});\n");
    assert!(out.contains("() => {__va(1),__va(2);\n  __vaC(2);add(1, 2);void 0;\n  __vaC(3);done();\n"), "{out}");
    assert!(!out.contains("__vaC(1)"), "{out}");
}

#[test]
fn a_call_the_test_makes_is_a_statement_whatever_it_is_named() {
    let out = cut("it('checks', () => {\n  __validate(x);\n  __vaLue && __vaLue(x);\n});\n");
    assert!(out.contains("__vaC(2);__validate(x);"), "{out}");
    assert!(out.contains("__vaC(3);__vaLue && __vaLue(x);"), "{out}");
}

#[test]
fn hooks_and_tests_inside_describe_are_cut() {
    let out = cut("describe('d', () => {\n  beforeEach(() => {\n    reset();\n  });\n  test('t', async function () {\n    await run();\n  });\n});\n");
    assert!(out.contains("__vaC(3,1);reset();"), "{out}");
    assert!(out.contains("__vaC(6);await run();"), "{out}");
    assert!(!out.contains("__vaC(2)"), "describe's own statements are not a test's: {out}");
}

#[test]
fn a_nested_function_is_not_cut_and_a_nested_block_is() {
    let out = cut("it('t', () => {\n  act(() => {\n    render();\n  });\n  if (x) {\n    y();\n  } else if (z) {\n    w();\n  }\n});\n");
    assert!(out.contains("__vaC(2);act("), "{out}");
    assert!(!out.contains("__vaC(3)"), "{out}");
    assert!(out.contains("__vaC(6);y();"), "{out}");
    assert!(out.contains("} else if (z)"), "an else-if is never cut in front of: {out}");
    assert!(out.contains("__vaC(8);w();"), "{out}");
}

#[test]
fn a_concise_body_is_cut_as_one_expression() {
    let out = cut("it('t', () => expect(f()).toBe(1));\ntest('o', () => ({ a: 1 }));\n");
    assert!(out.contains("() => (__vaC(1),expect(f()).toBe(1))"), "{out}");
    assert!(out.contains("() => (__vaC(2),({ a: 1 }))"), "{out}");
}

#[test]
fn each_and_modifiers_reach_the_body() {
    let out = cut("it.each([1])('n %i', (n) => {\n  check(n);\n});\ntest.only('o', () => {\n  one();\n});\ntest.each`a`('t', () => {\n  two();\n});\n");
    assert!(out.contains("__vaC(2);check(n);"), "{out}");
    assert!(out.contains("__vaC(5);one();"), "{out}");
    assert!(out.contains("__vaC(8);two();"), "{out}");
}

#[test]
fn an_unbraced_body_is_left_whole() {
    let out = cut("it('t', () => {\n  if (x) y();\n  for (;;) break;\n});\n");
    assert!(out.contains("__vaC(2);if (x) y();"), "{out}");
    assert!(out.contains("__vaC(3);for (;;) break;"), "{out}");
}

#[test]
fn the_cut_function_is_declared_after_the_last_statement() {
    let out = cut("it('t', () => {\n  a();\n})\n// end");
    assert!(out.contains("})\n") || out.contains("});"), "{out}");
    assert!(out.contains(";function __vaC(l,h){"), "{out}");
    assert_eq!(out.lines().count(), 4);
    assert!(out.ends_with("// end"), "{out}");
}

#[test]
fn lines_count_every_terminator() {
    let out = cut("it('t', () => {\r\n  a();\r\n  b();\u{2028}  c();\n});\n");
    assert!(out.contains("__vaC(2);a();"), "{out}");
    assert!(out.contains("__vaC(3);b();"), "{out}");
    assert!(out.contains("__vaC(4);c();"), "{out}");
}

#[test]
fn a_file_with_no_test_body_or_no_parse_is_left_alone() {
    assert!(cadence("export const a = 1;\n", "a.test.ts", false).is_none());
    assert!(cadence("it('t', () => {", "a.test.ts", false).is_none());
}

#[test]
fn jsx_in_a_test_parses_by_extension() {
    let out = cadence("it('t', () => {\n  render(<A />);\n});\n", "a.test.tsx", false).expect("tsx parses").code;
    assert!(out.contains("__vaC(2);render(<A />);"), "{out}");
}

#[test]
fn a_describe_off_a_test_is_walked_not_cut() {
    let out = cut("test.describe('d', () => {\n  test.beforeEach(async () => {\n    await reset();\n  });\n  test('t', async () => {\n    await run();\n  });\n  test.describe.serial('s', () => {\n    test('u', () => {\n      go();\n    });\n  });\n});\n");
    assert!(!out.contains("__vaC(2)") && !out.contains("__vaC(5)") && !out.contains("__vaC(8)"), "a describe's own statements are not a test's: {out}");
    assert!(out.contains("__vaC(3,1);await reset();"), "{out}");
    assert!(out.contains("__vaC(6);await run();"), "{out}");
    assert!(out.contains("__vaC(10);go();"), "{out}");
}

fn awaited(source: &str) -> String {
    cadence(source, "/repo/e2e/a.spec.ts", true).expect("it parses and has a test").code
}

#[test]
fn an_awaited_cut_waits_in_an_async_body_and_names_its_file() {
    let out = awaited("test('t', async ({ page }) => {\n  await page.goto('/');\n  check();\n});\ntest('s', () => {\n  go();\n});\ntest('c', async () => page.click());\n");
    assert!(out.contains("  __vaC(2)&&await __vaC.w;await page.goto('/');\n  __vaC(3)&&await __vaC.w;check();\n"), "{out}");
    assert!(out.contains("  __vaC(6);go();"), "a body that cannot wait is cut as it was: {out}");
    assert!(out.contains("async () => (__vaC(8)&&await __vaC.w,page.click())"), "{out}");
    assert!(out.contains("r.c(l,\"/repo/e2e/a.spec.ts\",h===1)"), "{out}");
    assert_eq!(out.lines().count(), 8);
}

#[test]
fn an_awaited_cut_in_a_hook_says_it_is_a_hook() {
    let out = awaited("import { beforeAll as once } from '@playwright/test';\ntest.beforeEach(async () => {\n  await a();\n});\nafterEach(() => {\n  b();\n});\nonce(() => {\n  c();\n});\ntest('t', async () => {\n  await d();\n});\n");
    assert!(out.contains("__vaC(3,1)&&await __vaC.w;await a();"), "{out}");
    assert!(out.contains("__vaC(6,1);b();"), "{out}");
    assert!(out.contains("__vaC(9,1);c();"), "an imported alias of a hook is a hook: {out}");
    assert!(out.contains("__vaC(12)&&await __vaC.w;await d();"), "a test's cut is not a hook's: {out}");
}

#[test]
fn a_cut_in_a_hook_says_it_is_a_hook_in_every_realm() {
    // A page runs a hook in the test's realm, so the cut says it, as an awaited one does.
    let out = cut("beforeEach(() => {\n  a();\n});\ntest('t', () => {\n  b();\n});\n");
    assert!(out.contains("__vaC(2,1);a();"), "{out}");
    assert!(out.contains("__vaC(5);b();"), "a test's cut is not a hook's: {out}");
    assert!(out.contains("r.c(l,void 0,h===1)"), "the declaration hands the mark on: {out}");
}

#[test]
fn an_awaited_cut_escapes_its_file_as_a_string() {
    let out = cadence("test('t', () => {\n  go();\n});\n", "C:\\e2e\\\"a\".spec.js", true).expect("it parses").code;
    assert!(out.contains("r.c(l,\"C:\\\\e2e\\\\\\\"a\\\".spec.js\",h===1)"), "{out}");
}

#[test]
fn jsx_in_a_javascript_test_parses() {
    let out = cadence("it('t', () => {\n  render(<A />);\n});\n", "a.test.js", false).expect("js parses with jsx").code;
    assert!(out.contains("__vaC(2);render(<A />);"), "{out}");
}
