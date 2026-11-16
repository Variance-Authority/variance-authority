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
    pub(crate) fallback: Option<u64>,
    /// Per module, run `at` holds `values[at]` from region `starts[at]`.
    pub(crate) segments: BTreeMap<u32, (Vec<u64>, Vec<u32>)>,
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
    module_lines(lines, module).value(block)
}

/// The lines of one module of a case, to read many of its regions' values.
#[derive(Clone, Copy)]
pub(crate) enum ModuleLines<'a> {
    Fallback(Option<u64>),
    Runs(&'a [u64], &'a [u32]),
}

impl ModuleLines<'_> {
    /// `value_at` for a region of this module.
    pub(crate) fn value(self, block: u32) -> Option<u64> {
        match self {
            ModuleLines::Fallback(value) => value,
            ModuleLines::Runs(values, starts) => values.get(starts.partition_point(|start| *start <= block).max(1) - 1).copied(),
        }
    }
}

pub(crate) fn module_lines(lines: &Lines, module: u32) -> ModuleLines<'_> {
    match lines.segments.get(&module) {
        None => ModuleLines::Fallback(lines.fallback),
        Some((values, starts)) => ModuleLines::Runs(values, starts),
    }
}

/// Which of two values one region keeps: the case's own crossing over a hook's,
/// then the earlier line.
pub(crate) fn earlier(left: u64, right: u64) -> u64 {
    if (left & 1, left) <= (right & 1, right) { left } else { right }
}

/// The bytes of a case that crossed `values`, each region by `(module, block)`,
/// written as `CaseLinesBuilder` and `encodeCaseLines` write them.
pub(crate) fn encode(values: &BTreeMap<(u32, u32), u64>) -> Vec<u8> {
    let mut builder = Builder::default();
    for (&(module, block), &value) in values {
        builder.add(module, block, value).expect("a map hands its regions over in order");
    }
    builder.finish(None)
}

const OUT_OF_ORDER: &str = "case lines are handed over out of order";

/// One case's lines from its crossings, handed over in module order and,
/// within a module, in region order; or, for a module carried as it was
/// stored, as its segment whole.
#[derive(Default)]
pub(crate) struct Builder {
    alone: BTreeMap<u64, Vec<u32>>,
    mixed: Vec<(u32, (Vec<u64>, Vec<u32>))>,
    module: Option<u32>,
    open: bool,
    values: Vec<u64>,
    starts: Vec<u32>,
}

impl Builder {
    /// A region of `module` the case crossed, at `value`.
    pub(crate) fn add(&mut self, module: u32, block: u32, value: u64) -> Result<(), String> {
        if self.module != Some(module) || !self.open {
            self.begin(module)?;
            self.values.push(value);
            self.starts.push(0);
            return Ok(());
        }
        if self.starts[self.starts.len() - 1] > block {
            return Err(OUT_OF_ORDER.to_owned());
        }
        if self.values[self.values.len() - 1] != value {
            self.values.push(value);
            self.starts.push(block);
        }
        Ok(())
    }

    /// A module's segment as it was stored, every region of it at the values it held.
    pub(crate) fn segment(&mut self, module: u32, values: &[u64], starts: &[u32]) -> Result<(), String> {
        self.begin(module)?;
        self.values.extend_from_slice(values);
        self.starts.extend_from_slice(starts);
        self.close();
        Ok(())
    }

    /// The case's bytes. `fallback` is the value of modules handed over by
    /// nobody, which a case carried from a held index keeps; without it, the
    /// value most modules hold alone, the lower of two that tie.
    pub(crate) fn finish(mut self, fallback: Option<u64>) -> Vec<u8> {
        self.close();
        let mut chosen = fallback;
        if chosen.is_none() {
            let mut most = 0;
            for (value, modules) in &self.alone {
                if modules.len() > most {
                    (chosen, most) = (Some(*value), modules.len());
                }
            }
            chosen = chosen.or_else(|| self.mixed.first().map(|(_, (values, _))| values[0]));
        }
        let mut table: Vec<u64> = self.alone.keys().copied().chain(chosen).chain(self.mixed.iter().flat_map(|(_, (values, _))| values.iter().copied())).collect();
        table.sort_unstable();
        table.dedup();
        let mut segments: BTreeMap<u32, (Vec<u64>, Vec<u32>)> = self.mixed.into_iter().collect();
        for (value, modules) in self.alone {
            if Some(value) != chosen {
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
            put(&mut out, index(chosen.expect("a case with values has a fallback")));
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

    /// The entries the case holds: a module index per module alone, and a
    /// value per run of the others.
    #[cfg(test)]
    pub(crate) fn held(&self) -> usize {
        self.alone.values().map(Vec::len).sum::<usize>() + self.mixed.iter().map(|(_, (values, _))| values.len()).sum::<usize>() + self.values.len()
    }

    fn begin(&mut self, module: u32) -> Result<(), String> {
        if self.module.is_some_and(|current| module <= current) {
            return Err(OUT_OF_ORDER.to_owned());
        }
        self.close();
        self.module = Some(module);
        self.open = true;
        Ok(())
    }

    fn close(&mut self) {
        if !self.open {
            return;
        }
        self.open = false;
        let (values, starts) = (std::mem::take(&mut self.values), std::mem::take(&mut self.starts));
        let module = self.module.expect("an open builder names its module");
        if values.len() == 1 {
            self.alone.entry(values[0]).or_default().push(module);
        } else {
            self.mixed.push((module, (values, starts)));
        }
    }
}

#[cfg(test)]
#[path = "case_lines_tests.rs"]
mod tests;
