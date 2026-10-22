//! One case's lines as `case-lines.ts` stores them, read and written where the
//! fold has to join two holdings of one case: the test line that first reached
//! each region the case crossed, as a value (the line shifted left once, its
//! low bit set where a hook's statement reached it rather than the case's own).
//!
//! The bytes say a value only for a region the case crossed; which regions it
//! crossed is the sets'. So two holdings join over the regions each crossed,
//! and a region both crossed takes the case's own crossing over a hook's, then
//! the earlier line.

use std::collections::BTreeMap;

use crate::case_shard::{put, Varints};

/// One case's lines: every value it holds, the value of a module without a
/// segment, and the modules that hold another, as runs over their regions.
pub(crate) struct Lines {
    fallback: Option<u64>,
    /// Per module, run `at` holds `values[at]` from region `starts[at]`.
    segments: BTreeMap<u32, (Vec<u64>, Vec<u32>)>,
}

/// One case's lines off its bytes; `None` for a case whose lines were not recorded.
pub(crate) fn decode(bytes: &[u8]) -> Result<Option<Lines>, String> {
    if bytes.is_empty() {
        return Ok(None);
    }
    let mut reader = Varints::new(bytes);
    let count = reader.take()?;
    if count > bytes.len() as u64 {
        return Err("case lines state more values than they hold".to_owned());
    }
    let mut table = Vec::with_capacity(count as usize);
    for at in 0..count {
        let step = reader.take()?;
        table.push(if at == 0 { step } else { table[at as usize - 1] + step });
    }
    let value = |index: u64| table.get(index as usize).copied().ok_or_else(|| "case lines name a value they do not hold".to_owned());
    if count <= 1 {
        reader.end()?;
        return Ok(Some(Lines { fallback: table.first().copied(), segments: BTreeMap::new() }));
    }
    let fallback = Some(value(reader.take()?)?);
    let modules = reader.take()?;
    if modules > bytes.len() as u64 {
        return Err("case lines state more segments than they hold".to_owned());
    }
    let mut segments = BTreeMap::new();
    let mut module = -1_i64;
    for _ in 0..modules {
        module += reader.take()? as i64 + 1;
        let runs = reader.take()?;
        if runs == 0 || runs > bytes.len() as u64 {
            return Err("case lines hold an invalid segment".to_owned());
        }
        let values = (0..runs).map(|_| reader.take().and_then(value)).collect::<Result<Vec<_>, _>>()?;
        let mut starts = vec![0_u32];
        for _ in 1..runs {
            starts.push(starts[starts.len() - 1] + reader.take()? as u32);
        }
        segments.insert(module as u32, (values, starts));
    }
    reader.end()?;
    Ok(Some(Lines { fallback, segments }))
}

/// The value of a region of `module`, for a region the case crossed; `None`
/// where the case crossed nothing.
pub(crate) fn value_at(lines: &Lines, module: u32, block: u32) -> Option<u64> {
    let Some((values, starts)) = lines.segments.get(&module) else {
        return lines.fallback;
    };
    let at = starts.partition_point(|start| *start <= block).max(1) - 1;
    values.get(at).copied()
}

/// Which of two values one region keeps: the case's own crossing over a hook's,
/// then the earlier line.
pub(crate) fn earlier(left: u64, right: u64) -> u64 {
    if (left & 1, left) <= (right & 1, right) { left } else { right }
}

/// The bytes of a case that crossed `values`, each region by `(module, block)`,
/// written as `CaseLinesBuilder` and `encodeCaseLines` write them.
pub(crate) fn encode(values: &BTreeMap<(u32, u32), u64>) -> Vec<u8> {
    let mut alone: BTreeMap<u64, Vec<u32>> = BTreeMap::new();
    let mut mixed: Vec<(u32, (Vec<u64>, Vec<u32>))> = Vec::new();
    let mut at = values.iter().peekable();
    while let Some((&(module, _), &value)) = at.next() {
        let (mut runs, mut starts) = (vec![value], vec![0_u32]);
        while let Some((&(next, block), &value)) = at.peek() {
            if next != module {
                break;
            }
            if runs[runs.len() - 1] != value {
                runs.push(value);
                starts.push(block);
            }
            at.next();
        }
        if runs.len() == 1 { alone.entry(runs[0]).or_default().push(module) } else { mixed.push((module, (runs, starts))) }
    }
    let mut fallback = None;
    let mut most = 0;
    for (value, modules) in &alone {
        if modules.len() > most {
            (fallback, most) = (Some(*value), modules.len());
        }
    }
    let fallback = fallback.or_else(|| mixed.first().map(|(_, (values, _))| values[0]));
    let mut table: Vec<u64> = alone.keys().copied().chain(fallback).chain(mixed.iter().flat_map(|(_, (values, _))| values.iter().copied())).collect();
    table.sort_unstable();
    table.dedup();
    let mut segments: BTreeMap<u32, (Vec<u64>, Vec<u32>)> = mixed.into_iter().collect();
    for (value, modules) in alone {
        if Some(value) != fallback {
            for module in modules {
                segments.insert(module, (vec![value], vec![0]));
            }
        }
    }
    let index = |value: u64| table.binary_search(&value).expect("every value is in the table") as u64;
    let mut out = Vec::new();
    put(&mut out, table.len() as u64);
    for (at, value) in table.iter().enumerate() {
        put(&mut out, if at == 0 { *value } else { value - table[at - 1] });
    }
    if table.len() > 1 {
        put(&mut out, index(fallback.expect("a case with values has a fallback")));
        put(&mut out, segments.len() as u64);
        let mut previous = -1_i64;
        for (module, (values, starts)) in segments {
            put(&mut out, (i64::from(module) - previous - 1) as u64);
            previous = i64::from(module);
            put(&mut out, values.len() as u64);
            for value in values {
                put(&mut out, index(value));
            }
            for pair in starts.windows(2) {
                put(&mut out, u64::from(pair[1] - pair[0]));
            }
        }
    }
    out
}

#[cfg(test)]
#[path = "case_lines_tests.rs"]
mod tests;
