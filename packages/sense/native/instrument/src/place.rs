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
    /// With `carry`, the project's composed map moved onto `cut.code`: the
    /// same sources and names, each generated column past the probes in front
    /// of it. Nothing when the header needed a line of its own.
    pub carried: Option<String>,
}

/// Place the probes of `authored`'s regions in `transformed`.
///
/// `mappings` is the composed map from `transformed` to its sources, and
/// `source` the index of `authored` among them. Nothing when either text does
/// not parse. With `carry`, [`Placed::carried`] is the composed map moved
/// onto the probed text, for a runner no bundler composes maps for.
#[allow(clippy::too_many_arguments)]
pub fn place(
    authored: &str,
    transformed: &str,
    file: &str,
    mappings: &str,
    source: u32,
    module: &str,
    entries: bool,
    carry: bool,
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
    let units: [Vec<u16>; 2] = [transformed.encode_utf16().collect(), authored.encode_utf16().collect()];
    let segments = segments(mappings, source, &starts(transformed), &starts(authored), &units);
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
    let one_line = !spliced.edits.iter().any(|(_, text)| text.contains('\n'));
    let (mappings, carried) = if one_line {
        let mut edits = spliced.edits;
        let at = edits.partition_point(|(offset, _)| *offset < spliced.header_source);
        edits.insert(at, (spliced.header_source, head));
        let (own, shifts) = crate::cadence_map::mappings(transformed, &edits);
        (Some(own), carry.then(|| crate::carry::carried(mappings, &shifts)))
    } else {
        (None, None)
    };
    cut.code = spliced.code;
    cut.header_at = spliced.header_at;
    cut.header_byte = spliced.header_byte;
    Some(Placed { cut, unplaced, mappings, carried })
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
///
/// A segment that starts in whitespace and names a token's origin — esbuild maps
/// column 0 of an indented line to its first token — is read where the token
/// after the whitespace starts, so the region enclosing the indentation does not
/// take the token's origin. `units` are the transformed and authored texts.
fn segments(mappings: &str, source: u32, generated: &[u32], original: &[u32], units: &[Vec<u16>; 2]) -> Vec<Segment> {
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
            let (mut at, from) = (g + column as u32, o + original_column as u32);
            if !blank(&units[1], from) {
                while blank(&units[0], at) {
                    at += 1;
                }
            }
            out.push(Segment { generated: at, original: from });
        }
    }
    out.sort_by_key(|it| it.generated);
    out
}

/// Whether a text holds a space or a tab at a UTF-16 offset.
fn blank(units: &[u16], at: u32) -> bool {
    matches!(units.get(at as usize), Some(&0x20 | &0x09))
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
#[path = "place_tests.rs"]
mod tests;
