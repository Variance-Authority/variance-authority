//! The placement's tests: where probes go in a transformed text.

use super::*;

/// A map from `(generated line, column, original line, column)` points,
/// all of source 0, in generated order.
fn map(points: &[(u32, u32, u32, u32)]) -> String {
    let mut out = String::new();
    let (mut line, mut column, mut original_line, mut original_column) = (0u32, 0i64, 0i64, 0i64);
    for &(g_line, g_column, o_line, o_column) in points {
        while line < g_line {
            out.push(';');
            line += 1;
            column = 0;
        }
        if !out.is_empty() && !out.ends_with(';') {
            out.push(',');
        }
        out.push_str(&vlq(g_column as i64 - column));
        out.push('A');
        out.push_str(&vlq(o_line as i64 - original_line));
        out.push_str(&vlq(o_column as i64 - original_column));
        (column, original_line, original_column) = (g_column as i64, o_line as i64, o_column as i64);
    }
    out
}

/// The identity map of a text, one point per character.
fn identity(text: &str) -> String {
    let mut points = Vec::new();
    for (line, content) in text.split('\n').enumerate() {
        for column in 0..content.chars().count() as u32 {
            points.push((line as u32, column, line as u32, column));
        }
    }
    map(&points)
}

fn vlq(value: i64) -> String {
    let mut text = String::new();
    let mut rest = if value < 0 { ((-value) << 1) | 1 } else { value << 1 } as u64;
    loop {
        let mut digit = (rest & 31) as usize;
        rest >>= 5;
        if rest > 0 {
            digit |= 32;
        }
        text.push(b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"[digit] as char);
        if rest == 0 {
            return text;
        }
    }
}

#[test]
fn a_text_no_transform_changed_is_placed_as_it_is_cut() {
    let source = "export function f(x) {\n  if (x) return 1;\n  return 0;\n}\n";
    let placed = place(source, source, "f.js", &identity(source), 0, "f.js@00", false, false).expect("it parses");
    let mut cut = cut::cut(source, "f.js", false).expect("it parses");
    cut.code.insert_str(cut.header_byte, &header("f.js@00", cut.blocks.len()));
    assert_eq!(placed.cut.code, cut.code);
}

#[test]
fn a_type_the_transform_erased_keeps_its_regions_on_the_authored_text() {
    let authored = "export function f(x: number): number {\n  if (x) return 1;\n  return 0;\n}\n";
    let transformed = "export function f(x) {\n  if (x) return 1;\n  return 0;\n}\n";
    let mut points = vec![(0, 0, 0, 0), (0, 21, 0, 37)];
    for line in 1..4 {
        for column in 0..20 {
            points.push((line, column, line, column));
        }
    }
    let placed = place(authored, transformed, "f.ts", &map(&points), 0, "f.ts@00", false, false).expect("it parses");
    let cut = cut::cut(authored, "f.ts", false).expect("it parses");
    assert_eq!(placed.cut.blocks.len(), cut.blocks.len());
    assert_eq!(placed.cut.source_digest, cut.source_digest);
    let mut expected = cut::cut(transformed, "f.js", false).expect("it parses");
    expected.code.insert_str(expected.header_byte, &header("f.ts@00", cut.blocks.len()));
    assert_eq!(placed.cut.code, expected.code);
}

#[test]
fn code_only_the_transform_wrote_carries_no_probe() {
    let authored = "export const a = 1;\n";
    let transformed = "export const a = 1;\nfunction helper() { return 2 }\n";
    let placed = place(authored, transformed, "a.js", "AAAA", 0, "a.js@00", false, false).expect("it parses");
    assert!(placed.cut.code.contains("function helper() {void 0; return 2 }"), "{}", placed.cut.code);
    assert_eq!(placed.cut.blocks.len(), 1);
}

#[test]
fn a_region_with_no_origin_in_front_of_it_in_an_enclosing_region_is_module_code() {
    // With no map at all, nothing vouches for either function: both fire when
    // the module loads, over-charged rather than recorded as never running.
    let authored = "export function f() { return 1 }\nexport function g() { return 2 }\n";
    let transformed = "export function f() { return 1 }\n";
    let none = place(authored, transformed, "a.js", "", 0, "a.js@00", false, false).expect("it parses");
    assert!(none.cut.code.contains("__vaB);__va(1);__va(2);"), "{}", none.cut.code);
}

#[test]
fn an_awaited_resume_fires_each_authored_one_and_none_for_its_own() {
    let authored = "export async function f(p) { return await p }\n";
    let placed = place(authored, authored, "a.js", &identity(authored), 0, "a.js@00", false, false).expect("it parses");
    assert!(placed.cut.code.contains("__vaR(await p,2)"), "{}", placed.cut.code);
    let helper = "export async function f(p) { return await p }\nasync function h(q) { await q }\n";
    let placed = place(authored, helper, "a.js", &identity(authored), 0, "a.js@00", false, false).expect("it parses");
    assert!(placed.cut.code.contains("(await q)"), "{}", placed.cut.code);
    assert!(!placed.cut.code.contains("__vaR(await q"), "{}", placed.cut.code);
}

#[test]
fn the_map_back_names_the_transformed_columns() {
    let source = "export const a = () => 1;\n";
    let placed = place(source, source, "a.js", &identity(source), 0, "a.js@00", false, false).expect("it parses");
    assert!(placed.mappings.starts_with("AAAA"));
}

#[test]
fn a_region_without_an_origin_is_fired_by_the_code_enclosing_it_in_front_of_it() {
    // `g`'s text carries no origin. The nearest origin in front of it inside a
    // region enclosing it is the module's own code, `export function f() `,
    // so the module fires `g` when it loads: present whenever the module ran.
    // `f`'s body is in front of `g` too, but does not enclose it.
    let authored = "export function f() { return 1 }\nexport function g() { return 2 }\n";
    let points: Vec<_> = (0..32).map(|column| (0, column, 0, column)).collect();
    let placed = place(authored, authored, "a.js", &map(&points), 0, "a.js@00", false, false).expect("it parses");
    assert!(placed.cut.code.contains("__vaK.g(2147483648|__vaB);__va(2);"), "{}", placed.cut.code);
    assert!(placed.cut.code.contains("function f() {__va(1); return 1 }"), "{}", placed.cut.code);
    assert!(placed.cut.code.contains("function g() {void 0; return 2 }"), "{}", placed.cut.code);
}

#[test]
fn a_region_with_only_a_sibling_in_front_of_it_is_module_code() {
    // Only `f`'s body is mapped: the one origin in front of `g` is in a region
    // that does not enclose it, so `g` fires when the module loads.
    let authored = "export function f() { return 1 }\nexport function g() { return 2 }\n";
    let points: Vec<_> = (20..32).map(|column| (0, column, 0, column)).collect();
    let placed = place(authored, authored, "a.js", &map(&points), 0, "a.js@00", false, false).expect("it parses");
    assert!(placed.cut.code.contains("__vaB);__va(2);"), "{}", placed.cut.code);
    assert!(placed.cut.code.contains("function f() {__va(1); return 1 }"), "{}", placed.cut.code);
}

#[test]
fn an_outlined_callback_is_module_code_not_the_component_s() {
    // An extractor that hoists a callback out of a component maps what it
    // wrote to the component's code. The component hands the callback out,
    // and a later test can call it without entering the component, so it is
    // fired when the module loads — not by the component, nor the sibling `h`.
    let authored = "export function h() { return 0 }\nexport function C(p) { const on = () => p; return on }\n";
    let transformed = "export function h() { return 0 }\nconst _on = (p) => () => p;\nexport function C(p) { const on = _on(p); return on }\n";
    let mut points: Vec<_> = (0..33).map(|column| (0, column, 0, column)).collect();
    // `C`'s line maps onto `C`'s authored line, up to `const on = `.
    points.extend((0..33).map(|column| (2, column, 1, column)));
    let placed = place(authored, transformed, "a.js", &map(&points), 0, "a.js@00", false, false).expect("it parses");
    let body = placed.cut.code.split("export function C(p) {").nth(1).expect("C");
    assert!(body.starts_with("__va(2);"), "{}", placed.cut.code);
    assert!(placed.cut.code.contains("__vaB);__va(3);"), "{}", placed.cut.code);
}

#[test]
fn the_carried_map_keeps_the_sources_and_moves_past_the_probes() {
    let source = "export const a = () => 1;\n";
    let placed = place(source, source, "a.js", &identity(source), 0, "a.js@00", false, true).expect("it parses");
    let own = placed.mappings;
    let carried = placed.carried.expect("carried");
    assert_eq!(carried.split(',').count(), identity(source).split(',').count());
    assert_ne!(carried, identity(source));
    let none = place(source, source, "a.js", &identity(source), 0, "a.js@00", false, false).expect("it parses");
    assert!(none.carried.is_none() && !own.is_empty());
}

#[test]
fn segments_read_only_the_named_source() {
    // Two segments on line 0: source 1 at column 0, then source 0 at column 4.
    let found = segments("ACAA,IDAA", 0, &[0], &[0], &[vec![], vec![]]);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].generated, 4);
}

#[test]
fn a_segment_in_a_line_s_indentation_is_read_at_the_token_after_it() {
    // esbuild maps column 0 of an indented line to its first token's origin.
    // Read there, the indentation sits in the function's region, and the
    // continuation after the `if` would fire on entry.
    let authored = "export function f(v) {\n  if (v) {\n    return 1;\n  }\n  return 2;\n}\n";
    let mut points = Vec::new();
    for (line, content) in authored.split('\n').enumerate() {
        let indent = content.len() - content.trim_start().len();
        if indent > 0 {
            points.push((line as u32, 0, line as u32, indent as u32));
        }
        for column in indent as u32..content.chars().count() as u32 {
            points.push((line as u32, column, line as u32, column));
        }
    }
    let placed = place(authored, authored, "a.js", &map(&points), 0, "a.js@00", false, false).expect("it parses");
    let entry = placed.cut.code.split("function f(v) {").nth(1).expect("the function").split('\n').next().unwrap();
    assert_eq!(entry.matches("__va(").count(), 1, "{}", placed.cut.code);
}

#[test]
fn a_header_on_a_line_of_its_own_keeps_both_maps() {
    // A module that is only a hashbang takes its header on the next line: the
    // maps still say where everything went.
    let source = "#!/usr/bin/env node";
    let placed = place(source, source, "a.js", &identity(source), 0, "a.js@00", false, true).expect("it parses");
    assert!(placed.cut.code.starts_with("#!/usr/bin/env node\n"), "{}", placed.cut.code);
    assert!(placed.mappings.starts_with("AAAA") && placed.mappings.contains(';'), "{}", placed.mappings);
    assert!(placed.carried.expect("carried").ends_with(';'));
}

#[test]
fn an_import_a_compiler_wrote_fires_nothing_from_the_code_it_names() {
    // esbuild maps the `react/jsx-runtime` import it adds to the first JSX
    // element: read as that code, the module would fire `f` on every load.
    let authored = "export function f() { return 1 }\n";
    let transformed = "import 'rt';\nexport function f() { return 1 }\n";
    let mut points = vec![(0, 0, 0, 22)];
    points.extend((0..32).map(|column| (1, column, 0, column)));
    let placed = place(authored, transformed, "a.js", &map(&points), 0, "a.js@00", false, false).expect("it parses");
    assert!(!placed.cut.code.contains("__vaB);__va(1);"), "{}", placed.cut.code);
    assert!(placed.cut.code.contains("function f() {__va(1); return 1 }"), "{}", placed.cut.code);
}

#[test]
fn an_import_the_author_wrote_still_fires_the_module_code_behind_it() {
    // Vitest hoists `vi.hoisted` above the imports and maps only the import it
    // moved: the factory behind it is fired by the module code in front of it.
    let authored = "import 'a';\nconst x = h(() => 1);\n";
    let transformed = "const x = h(() => 1);\nimport 'a';\n";
    let points: Vec<_> = (0..11).map(|column| (1, column, 0, column)).collect();
    let placed = place(authored, transformed, "a.js", &map(&points), 0, "a.js@00", false, false).expect("it parses");
    assert!(placed.cut.code.contains("__vaB);__va(1);"), "{}", placed.cut.code);
}

#[test]
fn a_hoisted_declaration_with_no_origin_fires_at_load_not_at_its_holder_s_entry() {
    // `outer` hands out `inner`, hoisted above the code in front of it: a later
    // test calls `inner` without entering `outer`. Fired at `outer`'s entry, a
    // test that ran only `inner` would be recorded as not running it.
    let authored = "export function outer() { const v = 1; return inner; function inner() { return v } }\n";
    let points: Vec<_> = (0..51).map(|column| (0, column, 0, column)).collect();
    let placed = place(authored, authored, "a.js", &map(&points), 0, "a.js@00", false, false).expect("it parses");
    assert!(placed.cut.code.contains("__vaB);__va(2);"), "{}", placed.cut.code);
    assert!(placed.cut.code.contains("function outer() {__va(1); const"), "{}", placed.cut.code);
}

#[test]
fn a_branch_with_no_origin_fires_at_its_function_s_entry_not_a_compiler_s_branch() {
    // A memoising compiler wraps the code in front of the `if` in a branch of
    // its own, which a later render skips. The `if`, its `else` and what follows
    // run on every call, so they fire at the function's entry — and the
    // compiler's own `else` stands for no `else` the author wrote.
    let authored = "export function f(v) { g(v); if (v) { return 1 } return 2 }\n";
    let transformed = "export function f(v) { if ($) { g(v); } if (v) { return 1 } return 2 }\n";
    let mut points: Vec<_> = (0..23).map(|column| (0, column, 0, column)).collect();
    points.extend((32..37).map(|column| (0, column, 0, column - 9)));
    let placed = place(authored, transformed, "a.js", &map(&points), 0, "a.js@00", false, false).expect("it parses");
    assert!(placed.cut.code.contains("function f(v) {__va(1),__va(2),__va(3),__va(4);__vaL&&__vaL(1,\"v\",v); if ($) {void 0; g(v); } else{void 0;}"), "{}", placed.cut.code);
}

#[test]
fn code_a_compiler_s_branch_holds_fires_at_the_function_s_entry() {
    // Only `g(v)` is mapped, and it sits in a memoising compiler's branch that a
    // cache hit skips. Fired there, a render that hit the cache would record `f`
    // as not running; fired at `f`'s entry, every call records it.
    let authored = "export function f(v) { g(v) }\n";
    let transformed = "export function f(v) { if ($) { g(v) } }\n";
    let points: Vec<_> = (32..36).map(|column| (0, column, 0, column - 9)).collect();
    let placed = place(authored, transformed, "a.js", &map(&points), 0, "a.js@00", false, false).expect("it parses");
    assert!(placed.cut.code.contains("function f(v) {__va(1);__vaL&&__vaL(1,\"v\",v); if ($) {void 0; g(v) }"), "{}", placed.cut.code);
}

#[test]
fn a_compiler_s_branch_inside_the_author_s_fires_at_the_author_s() {
    // The compiler's `if ($)` holds code from the author's `if (v)`, as the
    // author's `if (v)` itself does: it stands for no branch of its own.
    let authored = "export function f(v) { if (v) { g(v) } }\n";
    let transformed = "export function f(v) { if (v) { if ($) { g(v) } } }\n";
    let mut points: Vec<_> = (0..32).map(|column| (0, column, 0, column)).collect();
    points.extend((41..45).map(|column| (0, column, 0, column - 9)));
    let placed = place(authored, transformed, "a.js", &map(&points), 0, "a.js@00", false, false).expect("it parses");
    assert!(placed.cut.code.contains("if (v) {__va(2); if ($) {void 0; g(v) }"), "{}", placed.cut.code);
}

#[test]
fn an_author_s_branch_inside_a_compiler_s_branch_fires_at_the_region_around_the_compiler_s() {
    // The author's `if (v)` sits inside the compiler's `if ($)`, which a cache
    // hit skips: fired there, a render that hit the cache would record the
    // `then` as not running.
    let authored = "export function f(v) { if (v) { g(v) } }\n";
    let transformed = "export function f(v) { if ($) { if (v) { g(v) } } }\n";
    let mut points: Vec<_> = (0..23).map(|column| (0, column, 0, column)).collect();
    points.extend((32..47).map(|column| (0, column, 0, column - 9)));
    let placed = place(authored, transformed, "a.js", &map(&points), 0, "a.js@00", false, false).expect("it parses");
    assert!(placed.cut.code.contains("function f(v) {__va(1),__va(2),__va(3);__vaL&&__vaL(1,\"v\",v); if ($) {void 0; if (v) {void 0; g(v) }"), "{}", placed.cut.code);
}

#[test]
fn a_region_whose_origin_a_compiler_moved_into_a_closure_fires_at_the_function_s_entry() {
    // The code in front of the `if` went into a closure the compiler wrote,
    // called later or never: fired at its entry, a call of `f` that never
    // called it would record the `if` as not running.
    let authored = "export function f(v) { g(v); if (v) { h() } }\n";
    let transformed = "export function f(v) { const k = () => { g(v); }; if (v) { h() } }\n";
    let mut points: Vec<_> = (0..23).map(|column| (0, column, 0, column)).collect();
    points.extend((41..46).map(|column| (0, column, 0, column - 18)));
    let placed = place(authored, transformed, "a.js", &map(&points), 0, "a.js@00", false, false).expect("it parses");
    assert!(placed.cut.code.contains("function f(v) {__va(1),__va(2),__va(3);__vaL&&__vaL(1,\"v\",v); const k = () => {"), "{}", placed.cut.code);
}
