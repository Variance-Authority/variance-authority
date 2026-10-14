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
    assert!(placed.unplaced.is_empty());
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
    assert!(placed.unplaced.is_empty(), "{:?}", placed.unplaced);
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
fn a_region_nothing_maps_into_is_unplaced() {
    let authored = "export function f() { return 1 }\nexport function g() { return 2 }\n";
    let transformed = "export function f() { return 1 }\n";
    // Only the module's start is mapped, in front of both functions, so both
    // are carried by the region holding it: the module fires them.
    let placed = place(authored, transformed, "a.js", "AAAA", 0, "a.js@00", false, false).expect("it parses");
    assert!(placed.unplaced.is_empty());
    let none = place(authored, transformed, "a.js", "", 0, "a.js@00", false, false).expect("it parses");
    assert_eq!(none.unplaced, vec![1, 2]);
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
    assert!(placed.mappings.is_some_and(|it| it.starts_with("AAAA")));
}

#[test]
fn a_region_without_an_origin_is_reported_with_the_code_in_front_of_it() {
    // `g`'s text carries no origin: it fires wherever the code holding the
    // nearest origin in front of it runs, so it can be reported present
    // when only `f` ran, and never missing when it ran.
    let authored = "export function f() { return 1 }\nexport function g() { return 2 }\n";
    let points: Vec<_> = (0..32).map(|column| (0, column, 0, column)).collect();
    let placed = place(authored, authored, "a.js", &map(&points), 0, "a.js@00", false, false).expect("it parses");
    assert!(placed.unplaced.is_empty(), "{:?}", placed.unplaced);
    assert!(placed.cut.code.contains("function f() {__va(1),__va(2); return 1 }"), "{}", placed.cut.code);
    assert!(placed.cut.code.contains("function g() {void 0; return 2 }"), "{}", placed.cut.code);
}

#[test]
fn the_carried_map_keeps_the_sources_and_moves_past_the_probes() {
    let source = "export const a = () => 1;\n";
    let placed = place(source, source, "a.js", &identity(source), 0, "a.js@00", false, true).expect("it parses");
    let own = placed.mappings.expect("one line");
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
    assert!(placed.unplaced.is_empty(), "{:?}", placed.unplaced);
    let entry = placed.cut.code.split("function f(v) {").nth(1).expect("the function").split('\n').next().unwrap();
    assert_eq!(entry.matches("__va(").count(), 1, "{}", placed.cut.code);
}
