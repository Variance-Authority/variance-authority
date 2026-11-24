//! The ranges and witnesses read from one recorded module.

// compass: variance-authority.reach

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;

use super::Target;
use crate::journey_read::{charge_line, Journey, Region};
use crate::order::code_unit;

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Span {
    pub(super) start_line: u32,
    pub(super) end_line: u32,
}

impl Span {
    pub(super) fn new(start_line: u32, end_line: u32) -> Self {
        Self { start_line, end_line }
    }
    pub(super) fn written(self) -> String {
        if self.start_line == self.end_line {
            self.start_line.to_string()
        } else {
            format!("{}-{}", self.start_line, self.end_line)
        }
    }
}

#[derive(PartialEq, Eq)]
pub(super) struct Witnesses {
    pub(super) tests: Vec<u32>,
    pub(super) loaders: Vec<u32>,
    pub(super) loaded: bool,
    pub(super) stopped: Option<Vec<u32>>,
    pub(super) overwritten: Vec<u32>,
}

impl Witnesses {
    pub(super) fn state(&self) -> Option<&'static str> {
        match (self.tests.len(), self.overwritten.is_empty(), self.stopped.as_deref()) {
            (0, false, _) => None,
            (0, true, _) if self.loaded => Some("loaded"),
            (0, true, Some([])) => Some("unwalked"),
            (0, true, Some(_)) => Some("hole"),
            (0, true, None) => None,
            (1, true, Some([])) => Some("alone"),
            (1, true, None) => None,
            _ => Some("walked"),
        }
    }
}

pub(super) struct Range {
    pub(super) span: Span,
    pub(super) named: Witnesses,
    pub(super) unentered: Vec<usize>,
}

pub(super) enum Body<'a> {
    File(Vec<Range>),
    At {
        target: Target<'a>,
        named: Witnesses,
        unrun: Vec<usize>,
        outside: Vec<Span>,
        file_grain: Vec<Span>,
        grain: bool,
        placed: bool,
    },
}

#[derive(Clone, Copy, Serialize)]
pub(super) struct Case<'a> {
    pub(super) id: &'a str,
    pub(super) file: &'a str,
    pub(super) name: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) stopped: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) duration: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) limit: Option<u32>,
}

impl Case<'_> {
    pub(super) fn label(&self) -> String {
        if self.id == format!("{} > {}", self.file, self.name) {
            self.name.to_owned()
        } else {
            format!("{} [{}]", self.name, self.id)
        }
    }
}

pub(super) struct View<'a> {
    pub(super) journey: &'a Journey,
    pub(super) regions: &'a [Region],
    pub(super) kinds: &'a [&'a str],
    pub(super) tests: Vec<Case<'a>>,
    pub(super) stopped: Option<Vec<u32>>,
    pub(super) loaders: Vec<u32>,
    pub(super) owns_load: bool,
}

impl<'a> View<'a> {
    pub(super) fn has_loads(&self, target: Option<Target<'a>>) -> bool {
        if !self.regions.iter().any(|region| region.loaded) {
            return false;
        }
        let span = match target {
            None => return true,
            Some(Target::Function { function }) => {
                return self.regions.iter().zip(self.kinds).any(|(region, kind)| {
                    region.loaded
                        && region.source
                        && *kind == "function"
                        && self.journey.text(region.name).is_ok_and(|name| under(name, function))
                })
            }
            Some(Target::Line { line }) => Span::new(line, line),
            Some(Target::Lines { lines }) => lines,
        };
        let mut charge = Vec::new();
        self.slices(Some(span)).iter().any(|&(line, _)| {
            charge_line(self.regions, self.kinds, line, &mut charge);
            charge.iter().any(|region| region.loaded)
        })
    }

    pub(super) fn read(&self, target: Option<Target<'a>>) -> Option<Body<'a>> {
        let Some(target) = target else { return Some(Body::File(self.ranges()?)) };
        let mut charge = Vec::new();
        let mut selected = BTreeSet::new();
        let mut outside = Vec::new();
        let mut file_grain = Vec::new();
        let mut starts = false;
        let mut grain = false;
        if let Target::Function { function } = target {
            selected.extend(
                self.regions
                    .iter()
                    .zip(self.kinds)
                    .filter(|(region, kind)| {
                        **kind == "function"
                            && region.source
                            && self.journey.text(region.name).is_ok_and(|name| under(name, function))
                    })
                    .map(|(region, _)| region.at),
            );
            if selected.is_empty() {
                return None;
            }
        } else {
            let span = match target {
                Target::Line { line } => Span::new(line, line),
                Target::Lines { lines } => lines,
                _ => unreachable!(),
            };
            for (start, end) in self.slices(Some(span)) {
                charge_line(self.regions, self.kinds, start, &mut charge);
                if charge.is_empty() {
                    include(&mut outside, start, end);
                } else {
                    starts = true;
                    selected.extend(charge.iter().map(|region| region.at));
                    if charge.iter().any(|region| region.source && self.kind(region.at) == "module") {
                        include(&mut file_grain, start, end);
                    }
                }
            }
            let measured = u64::from(span.end_line) - u64::from(span.start_line) + 1 - width(&outside);
            grain = starts && width(&file_grain) == measured;
            if grain {
                file_grain.clear();
            }
        }
        let placed = starts || matches!(target, Target::Function { .. });
        let mut named = self.witnesses(selected.iter().map(|row| self.region(*row)))?;
        // Line state and its unknowns use the same per-line record as the
        // checkout reader. Until that projection is wired, do not collapse
        // an overwritten crossing into a measured absence.
        if !named.overwritten.is_empty() {
            return None;
        }
        let unrun = match target {
            Target::Function { function } if !named.tests.is_empty() || !named.loaders.is_empty() => {
                self.unrun(function, &selected)?
            }
            _ => Vec::new(),
        };
        if !placed {
            named.stopped = None;
        }
        Some(Body::At { target, named, unrun, outside, file_grain, grain, placed })
    }

    pub(super) fn ranges(&self) -> Option<Vec<Range>> {
        let mut output: Vec<Range> = Vec::new();
        let mut charge = Vec::new();
        let mut cache = BTreeMap::new();
        for (start, end) in self.slices(None) {
            charge_line(self.regions, self.kinds, start, &mut charge);
            if charge.is_empty() {
                continue;
            }
            let named = self.witnesses(charge.iter())?;
            let mut unentered = Vec::new();
            if !named.tests.is_empty() || !named.loaders.is_empty() {
                for region in charge.iter().filter(|region| region.source) {
                    let empty = if let Some(&empty) = cache.get(&region.at) {
                        empty
                    } else {
                        let reaching = self.witnesses([region])?;
                        let empty = reaching.tests.is_empty() && reaching.overwritten.is_empty() && !reaching.loaded;
                        cache.insert(region.at, empty);
                        empty
                    };
                    if empty {
                        unentered.push(region.at);
                    }
                }
            }
            if let Some(last) = output.last_mut() {
                if last.span.end_line.checked_add(1) == Some(start)
                    && last.named == named
                    && last.unentered == unentered
                {
                    last.span.end_line = end;
                    continue;
                }
            }
            output.push(Range { span: Span::new(start, end), named, unentered });
        }
        Some(output)
    }

    /// At a boundary a surrounding region can be charged alongside the
    /// inner one. Between adjacent boundaries the same set is charged.
    fn slices(&self, asked: Option<Span>) -> Vec<(u32, u32)> {
        let mut bounds = BTreeSet::new();
        for block in self.regions.iter().filter(|region| region.start > 0) {
            let start = u64::from(block.start);
            let end = u64::from(block.start.max(block.end));
            bounds.extend([start, start + 1, end, end + 1]);
        }
        if let Some(span) = asked {
            let first = u64::from(span.start_line);
            let after = u64::from(span.end_line) + 1;
            bounds.retain(|line| first <= *line && *line <= after);
            bounds.extend([first, after]);
        }
        let lines: Vec<_> = bounds.into_iter().collect();
        lines.windows(2).map(|pair| (pair[0] as u32, (pair[1] - 1) as u32)).collect()
    }

    pub(super) fn region(&self, index: usize) -> &Region {
        &self.regions[index - self.regions[0].at]
    }
    pub(super) fn kind(&self, index: usize) -> &str {
        self.kinds[index - self.regions[0].at]
    }

    fn witnesses<'r>(&self, blocks: impl IntoIterator<Item = &'r Region>) -> Option<Witnesses> {
        let mut tests = BTreeSet::new();
        let mut overwritten = BTreeSet::new();
        let mut loaded = false;
        for block in blocks {
            loaded |= block.loaded && self.owns_load;
            tests.extend(self.journey.members(block.called).ok()?);
            overwritten.extend(self.journey.overwritten(block).ok()?);
        }
        if tests.iter().chain(&overwritten).any(|test| *test as usize >= self.tests.len()) {
            return None;
        }
        let loaders =
            if loaded { self.loaders.iter().copied().filter(|row| !tests.contains(row)).collect() } else { Vec::new() };
        let stopped = self.stopped.as_ref().map(|rows| {
            rows.iter().copied().filter(|row| !tests.contains(row) && !overwritten.contains(row)).collect()
        });
        let mut tests: Vec<_> = tests.into_iter().collect();
        tests.sort_by(|a, b| self.case_order(*a, *b));
        overwritten.retain(|test| !tests.contains(test));
        Some(Witnesses { tests, loaders, loaded, stopped, overwritten: overwritten.into_iter().collect() })
    }

    pub(super) fn case_order(&self, a: u32, b: u32) -> std::cmp::Ordering {
        let (a, b) = (&self.tests[a as usize], &self.tests[b as usize]);
        code_unit(a.file, b.file).then_with(|| code_unit(a.name, b.name)).then_with(|| code_unit(a.id, b.id))
    }

    fn unrun(&self, function: &str, selected: &BTreeSet<usize>) -> Option<Vec<usize>> {
        let mut regions = Vec::new();
        for region in self.regions {
            if !region.source
                || self.kind(region.at) == "module"
                || !under(self.journey.text(region.name).ok()?, function)
            {
                continue;
            }
            if !selected.iter().any(|row| {
                let held = self.region(*row);
                held.start <= region.end && region.start <= held.end
            }) {
                continue;
            }
            let cases = self.witnesses([region])?;
            let reach = if !cases.tests.is_empty() {
                0
            } else if !cases.overwritten.is_empty() {
                1
            } else if cases.loaded {
                3
            } else {
                2
            };
            regions.push((region, reach));
        }
        regions.sort_by(|(a, _), (b, _)| a.start.cmp(&b.start).then(b.end.cmp(&a.end)));
        let mut open: Vec<(&Region, u8)> = Vec::new();
        let mut kept = Vec::new();
        for (region, reach) in regions {
            let around = |(outer, _): &(&Region, u8)| {
                outer.start <= region.start
                    && outer.end >= region.end
                    && !(self.kind(outer.at) == "branch"
                        && self.kind(region.at) == "branch"
                        && outer.start == region.start
                        && outer.end == region.end)
            };
            while open.last().is_some_and(|outer| !around(outer)) {
                open.pop();
            }
            if open.last().is_none_or(|(_, own)| *own != reach) && reach == 2 {
                kept.push(region.at);
            }
            open.push((region, reach));
        }
        Some(kept)
    }
}

fn under(name: &str, function: &str) -> bool {
    name == function || name.strip_prefix(function).is_some_and(|rest| rest.starts_with('/'))
}

fn width(spans: &[Span]) -> u64 {
    spans.iter().map(|span| u64::from(span.end_line) - u64::from(span.start_line) + 1).sum()
}

fn include(spans: &mut Vec<Span>, start: u32, end: u32) {
    if let Some(last) = spans.last_mut() {
        if last.end_line.checked_add(1) == Some(start) {
            last.end_line = end;
            return;
        }
    }
    spans.push(Span::new(start, end));
}
