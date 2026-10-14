//! Probes placed on what a project's transforms wrote, for regions cut from
//! what its author wrote.
//!
//! A compiler that reads syntax, such as a CSS-in-JS extractor or a memoising
//! compiler, reads the probes too when they go in first, and either refuses
//! the code or compiles it into something the project does not ship. So the
//! regions are cut from the authored text exactly as [`crate::cut`] cuts it —
//! same ordinals, names, digests and offsets, same module id — and the probes
//! go into the transformed text, where the project's own composed source map
//! says each authored region's code went.
//!
//! The transformed text is walked as the authored one is, and each region of it
//! fires the authored regions its code came from:
//!
//! 1. every mapped position fires the innermost authored region its origin
//!    sits in, through the innermost transformed region holding it that the
//!    author wrote: a function, or a branch, loop or case some code directly in
//!    which came from one of the same kind no region around it stands for. A
//!    compiler's own branch — a
//!    memoising compiler's `if ($[0] !== v)`, skipped on a cache hit — runs
//!    less often than the code it holds was written to, so that code fires at
//!    the region around the compiler's, and so does a branch the author wrote
//!    inside a compiler's, which runs only on a miss as well;
//! 2. a region with no text of its own — the `else` or `default` the walk adds
//!    — fires the authored one of the same kind and step whose siblings, the
//!    `then` or the cases of the same decision, its own siblings fire;
//! 3. an authored region no origin falls in — an extractor that moved a
//!    function's text maps what it wrote to the declaration — is fired by the
//!    entry of the transformed function holding the nearest origin in front of
//!    it that sits in the code of a region enclosing it in the same function —
//!    past any function the compiler wrote around that code, a closure called
//!    later or never, to the one around it that runs on every call.
//!    That code runs on every call that can run the region, so a test that ran
//!    the region ran it too. A region with no such origin — a function, which
//!    can be called before any code in front of it runs: hoisted above it, or
//!    handed out while an earlier test ran — is module code, fired when the
//!    module loads and so charged to every test that loaded it.
//!
//! A region that ran is never recorded as not running. Some are over-charged.
//! A transformed region that fires none was written by the project and carries
//! no probe.

use std::collections::HashMap;

use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::GetSpan;

use crate::cut::{self, Cut, Utf16};
use crate::dialect::dialect;
use crate::header::header;
use crate::walk::{Block, Kind, Walker};

/// One module's probes, placed on its transformed text.
pub struct Placed {
    /// The authored text's cut, with `code` the transformed text carrying the
    /// header and the probes.
    pub cut: Cut,
    /// The map from `cut.code` back to the transformed text, one source.
    pub mappings: String,
    /// With `carry`, the project's composed map moved onto `cut.code`: the
    /// same sources and names, each generated position past the probes in
    /// front of it.
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
    let mut segments = segments(mappings, source, &starts(transformed), &starts(authored), &units);
    // An import runs when the module loads, so it can only vouch for module
    // code. One a compiler wrote names the code that asked for it — esbuild maps
    // the `react/jsx-runtime` import to the first JSX element — and read as that
    // code it fires a component's body on every load. One the author wrote, moved
    // below Vitest's hoisted mocks, still names itself and is kept.
    let table = (!transformed.is_ascii()).then(|| Utf16::new(transformed));
    let unit = |offset: u32| table.as_ref().map_or(offset, |table| table.at(offset));
    let imports: Vec<(u32, u32)> = program
        .body
        .iter()
        .filter(|statement| cut::is_import(statement))
        .map(|statement| (unit(statement.span().start), unit(statement.span().end)))
        .collect();
    let in_import = |segment: &Segment| imports.iter().any(|&(start, end)| start <= segment.generated && segment.generated < end);
    let named = innermost(&cut.blocks, &segments.iter().map(|it| it.original).collect::<Vec<_>>());
    let mut kept = named.iter().map(|it| *it == Some(0));
    segments.retain(|segment| kept.next().unwrap_or(false) || !in_import(segment));
    let fires = fired(&cut.blocks, &regions, &segments);

    // The module's own probe is the header's: an authored region the module's
    // code carries fires once the header has run.
    let mut head = header(module, cut.blocks.len());
    for ordinal in fires.first().into_iter().flatten().filter(|it| **it != 0) {
        head.push_str(&format!("__va({ordinal});"));
    }
    let walker = cut::walk_firing(program, false, entries, Some(fires));
    let mut spliced = cut::splice(transformed, program, walker, true);
    spliced.code.insert_str(spliced.header_byte, &head);
    let mut edits = spliced.edits;
    let at = edits.partition_point(|(offset, _)| *offset < spliced.header_source);
    edits.insert(at, (spliced.header_source, head));
    let (own, shifts) = crate::cadence_map::shifted(transformed, &edits);
    let carried = carry.then(|| crate::carry::carried(mappings, &shifts));
    cut.code = spliced.code;
    cut.header_at = spliced.header_at;
    cut.header_byte = spliced.header_byte;
    cut.module = parsed.module_record.has_module_syntax;
    Some(Placed { cut, mappings: own, carried })
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

/// The decision a region belongs to: its owner, and its path without the last step.
fn label(block: &Block) -> (Option<u32>, &str) {
    (block.owner, block.path.rsplit_once('/').map_or("", |it| it.0))
}

/// The regions with text of their own, by the decision they belong to.
fn decisions(blocks: &[Block]) -> HashMap<(Option<u32>, &str), Vec<u32>> {
    let mut out: HashMap<(Option<u32>, &str), Vec<u32>> = HashMap::new();
    for (index, block) in blocks.iter().enumerate().filter(|(_, it)| it.start != it.end) {
        out.entry(label(block)).or_default().push(index as u32);
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
    // A branch, loop or case is the author's when code directly in it came from
    // one of the same kind that no region around it already stands for. One
    // that is not — a memoising compiler's `if ($[0] !== v)`, skipped on a cache
    // hit — vouches for nothing it holds: that code fires where the region
    // holding the compiler's runs.
    let mut kinds: Vec<Vec<u32>> = vec![Vec::new(); transformed.len()];
    for (to, from) in into.iter().zip(&from) {
        if let (Some(to), Some(from)) = (to, from) {
            if transformed[*to as usize].kind == authored[*from as usize].kind {
                kinds[*to as usize].push(*from);
            }
        }
    }
    for list in &mut kinds {
        list.sort_unstable();
        list.dedup();
    }
    let own: Vec<bool> = (0..transformed.len())
        .map(|at| {
            kinds[at].iter().any(|origin| {
                let mut around = transformed[at].owner;
                while let Some(outer) = around {
                    if kinds[outer as usize].binary_search(origin).is_ok() {
                        return false;
                    }
                    around = transformed[outer as usize].owner;
                }
                true
            })
        })
        .collect();
    // The innermost region the author wrote with no compiler's branch between
    // it and its function: an author's branch inside a compiler's runs only on
    // a cache miss too, so what it holds fires at the region around the
    // compiler's, as code directly in the compiler's does.
    let lift = |mut at: u32| {
        let mut chosen = None;
        loop {
            let block = &transformed[at as usize];
            if matches!(block.kind, Kind::Module | Kind::Function | Kind::Resume) {
                return chosen.unwrap_or(at);
            }
            if !own[at as usize] {
                chosen = None;
            } else if chosen.is_none() {
                chosen = Some(at);
            }
            at = block.owner.unwrap_or(0);
        }
    };
    for (to, from) in into.iter().zip(&from) {
        if let (Some(to), Some(from)) = (to, from) {
            let to = lift(*to);
            fires[to as usize].push(*from);
            reached[*from as usize] = true;
        }
    }
    for list in &mut fires {
        list.sort_unstable();
        list.dedup();
    }

    // 2. The regions the walk adds with no text: an `else`, a `default`. One
    // stands for the authored one whose own siblings — the `then`, the cases —
    // its siblings fire: the decision the project compiled from the author's.
    let (ours, theirs) = (decisions(authored), decisions(transformed));
    let candidates: Vec<usize> = (0..authored.len()).filter(|it| authored[*it].start == authored[*it].end).collect();
    for (ordinal, region) in transformed.iter().enumerate() {
        if region.start != region.end {
            continue;
        }
        let in_front = segments.partition_point(|it| it.generated <= region.start);
        let Some(origin) = in_front.checked_sub(1).map(|it| segments[it].original) else { continue };
        let mut fired: Vec<u32> =
            theirs.get(&label(region)).into_iter().flatten().flat_map(|it| fires[*it as usize].iter().copied()).collect();
        fired.sort_unstable();
        let nearest = candidates
            .iter()
            .map(|it| (*it, &authored[*it]))
            .filter(|(_, it)| it.kind == region.kind && step(&it.path) == step(&region.path))
            .filter(|(_, it)| ours.get(&label(it)).into_iter().flatten().any(|it| fired.binary_search(it).is_ok()))
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

    // 3. An authored region no origin falls in: the nearest origin in front of
    // it whose own region encloses it, within the same function, so the code it
    // names runs on every call that can run the region. Its probe is the entry
    // of the transformed function holding that code, not a branch a compiler
    // wrapped around it. A region across a function from any such origin — a
    // declaration hoisted above it, a callback handed out — is module code.
    let mut by_origin: Vec<usize> = (0..segments.len()).collect();
    by_origin.sort_by_key(|it| (segments[*it].original, *it));
    // A function a compiler wrote around the code — a closure holding code of
    // a function another region already stands for, called later or never —
    // is passed for the one around it, which runs on every call.
    let entry = |mut at: u32| loop {
        let block = &transformed[at as usize];
        let compilers = block.kind == Kind::Function && !own[at as usize];
        if !compilers && matches!(block.kind, Kind::Module | Kind::Function | Kind::Resume) {
            return at;
        }
        at = block.owner.unwrap_or(0);
    };
    for (index, region) in authored.iter().enumerate() {
        if reached[index] {
            continue;
        }
        let local = |holder: u32| {
            let mut at = index as u32;
            loop {
                if at == holder {
                    return true;
                }
                let block = &authored[at as usize];
                if block.kind == Kind::Function {
                    return false;
                }
                match block.owner {
                    Some(owner) => at = owner,
                    None => return false,
                }
            }
        };
        let behind = by_origin.partition_point(|it| segments[*it].original <= region.start);
        let encloses = |it: &usize| from[*it].is_some_and(local);
        let Some(last) = by_origin[..behind].iter().rposition(encloses) else {
            if let Some(module) = fires.first_mut() {
                module.push(index as u32);
            }
            continue;
        };
        let origin = segments[by_origin[last]].original;
        let first = by_origin.partition_point(|it| segments[*it].original < origin);
        let mut holders: Vec<u32> = by_origin[first..behind]
            .iter()
            .filter(|it| segments[**it].original == origin)
            .filter_map(|it| into[*it].map(entry))
            .collect();
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
