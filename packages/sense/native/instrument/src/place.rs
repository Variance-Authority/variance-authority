//! Probes placed on what a project's transforms wrote, for regions cut from
//! what its author wrote.
//!
//! A compiler that reads syntax — a CSS-in-JS extractor, a macro, a memoising
//! compiler — reads the probes too when they go in first, and either refuses
//! the code or compiles it into something the project does not ship. So the
//! regions are cut from the authored text exactly as [`crate::cut`] cuts it —
//! same ordinals, names, digests and offsets, same module id — and the probes
//! go into the transformed text, where the project's own composed source map
//! says each authored region's code went.
//!
//! The transformed text is walked as the authored one is, and each region of it
//! fires the authored regions its code came from:
//!
//! 1. every mapped position in a transformed region fires the innermost
//!    authored region its origin sits in, through the innermost transformed
//!    region holding it;
//! 2. a region with no text of its own — the `else` or `default` the walk adds
//!    — fires the authored one of the same kind and step, under an owner its
//!    own owner fires, nearest to the origin of the code in front of it;
//! 3. an authored region no origin falls in — a compiler that inlined a
//!    function maps all it wrote to the declaration — is fired by the deepest
//!    transformed regions holding the nearest origin in front of it.
//!
//! A transformed region that fires none was written by the project and carries
//! no probe. An authored region nothing fires is answered in
//! [`Placed::unplaced`], and the seam refuses the module by name.

use oxc_allocator::Allocator;
use oxc_parser::Parser;

use crate::cut::{self, Cut, Utf16};
use crate::dialect::dialect;
use crate::header::header;
use crate::walk::{Block, Walker};

/// One module's probes, placed on its transformed text.
pub struct Placed {
    /// The authored text's cut, with `code` the transformed text carrying the
    /// header and the probes.
    pub cut: Cut,
    /// The authored ordinals no transformed region fires.
    pub unplaced: Vec<u32>,
    /// The map from `cut.code` back to the transformed text, one source, or
    /// nothing when the header needed a line of its own.
    pub mappings: Option<String>,
}

/// Place the probes of `authored`'s regions in `transformed`.
///
/// `mappings` is the composed map from `transformed` to its sources, and
/// `source` the index of `authored` among them. Nothing when either text does
/// not parse.
pub fn place(
    authored: &str,
    transformed: &str,
    file: &str,
    mappings: &str,
    source: u32,
    module: &str,
    entries: bool,
) -> Option<Placed> {
    let mut cut = cut::cut(authored, file, entries)?;
    let allocator = Allocator::new();
    let parsed = [dialect("transformed.js"), dialect(file)].into_iter().flatten().find_map(|source_type| {
        let parsed = Parser::new(&allocator, transformed, source_type).parse();
        (!parsed.panicked && parsed.diagnostics.is_empty()).then_some(parsed)
    })?;
    let program = &parsed.program;

    let mut walked = cut::walk(program, false, entries);
    let mut regions = std::mem::take(&mut walked.blocks);
    if !transformed.is_ascii() {
        let table = Utf16::new(transformed);
        for block in &mut regions {
            block.start = table.at(block.start);
            block.end = table.at(block.end);
        }
    }
    let segments = segments(mappings, source, &starts(transformed), &starts(authored));
    let fires = fired(&cut.blocks, &regions, &segments);

    let mut fired_any = vec![false; cut.blocks.len()];
    for authored in fires.iter().flatten() {
        fired_any[*authored as usize] = true;
    }
    let unplaced = (0..cut.blocks.len() as u32).filter(|it| !fired_any[*it as usize]).collect();

    let walker = cut::walk_firing(program, false, entries, Some(fires));
    let mut spliced = cut::splice(transformed, program, walker, true);
    let head = header(module, cut.blocks.len());
    spliced.code.insert_str(spliced.header_byte, &head);
    let mappings = (!spliced.edits.iter().any(|(_, text)| text.contains('\n'))).then(|| {
        let mut edits = spliced.edits;
        let at = edits.partition_point(|(offset, _)| *offset < spliced.header_source);
        edits.insert(at, (spliced.header_source, head));
        crate::cadence_map::mappings(transformed, &edits).0
    });
    cut.code = spliced.code;
    cut.header_at = spliced.header_at;
    cut.header_byte = spliced.header_byte;
    Some(Placed { cut, unplaced, mappings })
}

/// A mapped position: generated and original offsets, in UTF-16 code units.
#[derive(Clone, Copy)]
struct Segment {
    generated: u32,
    original: u32,
}

/// Where each line starts, in UTF-16 code units. A map's lines end at `\n`.
fn starts(text: &str) -> Vec<u32> {
    let mut out = vec![0];
    let mut at = 0u32;
    for character in text.chars() {
        at += character.len_utf16() as u32;
        if character == '\n' {
            out.push(at);
        }
    }
    out
}

/// The segments of `mappings` whose source is `source`, ordered by generated offset.
fn segments(mappings: &str, source: u32, generated: &[u32], original: &[u32]) -> Vec<Segment> {
    let mut out = Vec::new();
    let (mut from, mut original_line, mut original_column) = (0i64, 0i64, 0i64);
    for (index, text) in mappings.split(';').enumerate() {
        let mut column = 0i64;
        for field in text.split(',').filter(|it| !it.is_empty()) {
            let Some(values) = decode(field) else { continue };
            column += values[0];
            if values.len() < 4 {
                continue;
            }
            from += values[1];
            original_line += values[2];
            original_column += values[3];
            if from != source as i64 || column < 0 || original_column < 0 {
                continue;
            }
            let (Some(g), Some(o)) = (generated.get(index), usize::try_from(original_line).ok().and_then(|it| original.get(it)))
            else {
                continue;
            };
            out.push(Segment { generated: g + column as u32, original: o + original_column as u32 });
        }
    }
    out.sort_by_key(|it| it.generated);
    out
}

/// One segment's fields, or nothing when it is not Base64 VLQ.
fn decode(field: &str) -> Option<Vec<i64>> {
    let mut values = Vec::with_capacity(5);
    let (mut value, mut shift) = (0i64, 0u32);
    for byte in field.bytes() {
        let digit = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        } as i64;
        value += (digit & 31) << shift;
        if digit & 32 == 0 {
            values.push(if value & 1 == 1 { -(value >> 1) } else { value >> 1 });
            (value, shift) = (0, 0);
        } else {
            shift += 5;
            if shift > 60 {
                return None;
            }
        }
    }
    (shift == 0 && !values.is_empty()).then_some(values)
}

/// The innermost region with text of its own holding each offset.
///
/// Regions nest, so one sweep answers every offset: a region is on the stack
/// while the sweep is inside it. Of two regions over one span, the later one is
/// the inner, as the walk opens it inside the other.
fn innermost(blocks: &[Block], offsets: &[u32]) -> Vec<Option<u32>> {
    let mut order: Vec<u32> = (0..blocks.len() as u32).filter(|it| blocks[*it as usize].end > blocks[*it as usize].start).collect();
    order.sort_by(|l, r| {
        let (lb, rb) = (&blocks[*l as usize], &blocks[*r as usize]);
        lb.start.cmp(&rb.start).then(rb.end.cmp(&lb.end)).then(l.cmp(r))
    });
    let mut queries: Vec<usize> = (0..offsets.len()).collect();
    queries.sort_by_key(|it| offsets[*it]);
    let mut out = vec![None; offsets.len()];
    let mut stack: Vec<u32> = Vec::new();
    let mut next = 0;
    for query in queries {
        let at = offsets[query];
        while next < order.len() && blocks[order[next] as usize].start <= at {
            let block = &blocks[order[next] as usize];
            while stack.last().is_some_and(|top| blocks[*top as usize].end <= block.start) {
                stack.pop();
            }
            stack.push(order[next]);
            next += 1;
        }
        while stack.last().is_some_and(|top| blocks[*top as usize].end <= at) {
            stack.pop();
        }
        out[query] = stack.last().copied();
    }
    out
}

fn step(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// The authored ordinals each transformed region fires, sorted.
fn fired(authored: &[Block], transformed: &[Block], segments: &[Segment]) -> Vec<Vec<u32>> {
    let mut fires: Vec<Vec<u32>> = vec![Vec::new(); transformed.len()];
    let mut reached = vec![false; authored.len()];
    let into = innermost(transformed, &segments.iter().map(|it| it.generated).collect::<Vec<_>>());
    let from = innermost(authored, &segments.iter().map(|it| it.original).collect::<Vec<_>>());
    for (to, from) in into.iter().zip(&from) {
        if let (Some(to), Some(from)) = (to, from) {
            fires[*to as usize].push(*from);
            reached[*from as usize] = true;
        }
    }
    for list in &mut fires {
        list.sort_unstable();
        list.dedup();
    }

    // 2. The regions the walk adds with no text: an `else`, a `default`.
    for (ordinal, region) in transformed.iter().enumerate() {
        if region.start != region.end {
            continue;
        }
        let in_front = segments.partition_point(|it| it.generated <= region.start);
        let Some(origin) = in_front.checked_sub(1).map(|it| segments[it].original) else { continue };
        let owners = &fires[region.owner.unwrap_or(0) as usize];
        let nearest = authored
            .iter()
            .enumerate()
            .filter(|(_, it)| it.start == it.end && it.kind == region.kind && step(&it.path) == step(&region.path))
            .filter(|(_, it)| it.owner.is_some_and(|owner| owners.binary_search(&owner).is_ok()))
            .min_by_key(|(index, it)| (it.start.abs_diff(origin), *index));
        if let Some((index, _)) = nearest {
            fires[ordinal].push(index as u32);
            reached[index] = true;
        }
    }
    if !fires.is_empty() && !fires[0].contains(&0) {
        fires[0].insert(0, 0);
    }
    if !reached.is_empty() {
        reached[0] = true;
    }

    // 3. An authored region no origin falls in.
    let mut by_origin: Vec<usize> = (0..segments.len()).collect();
    by_origin.sort_by_key(|it| (segments[*it].original, *it));
    for (index, region) in authored.iter().enumerate() {
        if reached[index] {
            continue;
        }
        let behind = by_origin.partition_point(|it| segments[*it].original <= region.start);
        let Some(last) = behind.checked_sub(1) else { continue };
        let origin = segments[by_origin[last]].original;
        let first = by_origin.partition_point(|it| segments[*it].original < origin);
        let mut holders: Vec<u32> = by_origin[first..behind].iter().filter_map(|it| into[*it]).collect();
        holders.sort_unstable();
        holders.dedup();
        let inside = |outer: &Block, inner: &Block| {
            outer.start <= inner.start && inner.end <= outer.end && inner.end - inner.start < outer.end - outer.start
        };
        for holder in &holders {
            let block = &transformed[*holder as usize];
            if holders.iter().any(|other| other != holder && inside(block, &transformed[*other as usize])) {
                continue;
            }
            fires[*holder as usize].push(index as u32);
        }
    }
    for list in &mut fires {
        list.sort_unstable();
        list.dedup();
    }
    fires
}


impl Walker {
    /// The probe expression for a region: `__va(n)` for its own ordinal, or, on
    /// a transformed text, one call for each authored region it fires — and
    /// `void 0` for a region it fires none of, which only the project wrote.
    pub(crate) fn probe(&self, ordinal: u32) -> String {
        let Some(fires) = &self.fires else { return format!("__va({ordinal})") };
        match fires[ordinal as usize].as_slice() {
            [] => "void 0".to_string(),
            fired => fired.iter().map(|it| format!("__va({it})")).collect::<Vec<_>>().join(","),
        }
    }

    /// What wraps an `await`: `__vaR(` and `,n)` for its own ordinal, one
    /// wrapper for each authored region it fires on a transformed text, and a
    /// bare pair of parentheses for a resume only the project wrote.
    pub(crate) fn resume(&self, ordinal: u32) -> (String, String) {
        let fired = match &self.fires {
            None => vec![ordinal],
            Some(fires) => fires[ordinal as usize].clone(),
        };
        match fired.as_slice() {
            [] => ("(".to_string(), ")".to_string()),
            _ => ("__vaR(".repeat(fired.len()), fired.iter().map(|it| format!(",{it})")).collect()),
        }
    }
}

#[cfg(test)]
mod tests {
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
        let placed = place(source, source, "f.js", &identity(source), 0, "f.js@00", false).expect("it parses");
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
        let placed = place(authored, transformed, "f.ts", &map(&points), 0, "f.ts@00", false).expect("it parses");
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
        let placed = place(authored, transformed, "a.js", "AAAA", 0, "a.js@00", false).expect("it parses");
        assert!(placed.cut.code.contains("function helper() {void 0; return 2 }"), "{}", placed.cut.code);
        assert_eq!(placed.cut.blocks.len(), 1);
    }

    #[test]
    fn a_region_nothing_maps_into_is_unplaced() {
        let authored = "export function f() { return 1 }\nexport function g() { return 2 }\n";
        let transformed = "export function f() { return 1 }\n";
        // Only the module's start is mapped, in front of both functions, so both
        // are carried by the region holding it: the module fires them.
        let placed = place(authored, transformed, "a.js", "AAAA", 0, "a.js@00", false).expect("it parses");
        assert!(placed.unplaced.is_empty());
        let none = place(authored, transformed, "a.js", "", 0, "a.js@00", false).expect("it parses");
        assert_eq!(none.unplaced, vec![1, 2]);
    }

    #[test]
    fn an_awaited_resume_fires_each_authored_one_and_none_for_its_own() {
        let authored = "export async function f(p) { return await p }\n";
        let placed = place(authored, authored, "a.js", &identity(authored), 0, "a.js@00", false).expect("it parses");
        assert!(placed.cut.code.contains("__vaR(await p,2)"), "{}", placed.cut.code);
        let helper = "export async function f(p) { return await p }\nasync function h(q) { await q }\n";
        let placed = place(authored, helper, "a.js", &identity(authored), 0, "a.js@00", false).expect("it parses");
        assert!(placed.cut.code.contains("(await q)"), "{}", placed.cut.code);
        assert!(!placed.cut.code.contains("__vaR(await q"), "{}", placed.cut.code);
    }

    #[test]
    fn the_map_back_names_the_transformed_columns() {
        let source = "export const a = () => 1;\n";
        let placed = place(source, source, "a.js", &identity(source), 0, "a.js@00", false).expect("it parses");
        assert!(placed.mappings.is_some_and(|it| it.starts_with("AAAA")));
    }

    #[test]
    fn segments_read_only_the_named_source() {
        // Two segments on line 0: source 1 at column 0, then source 0 at column 4.
        let found = segments("ACAA,IDAA", 0, &[0], &[0]);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].generated, 4);
    }
}
