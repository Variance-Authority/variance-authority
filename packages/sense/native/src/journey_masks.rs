//! A recording read as masks: each case is the set of regions it entered, and
//! nothing else. No recorded caller is read, so the calculations here hold on
//! any recording, not only one made in story mode.
//!
//! Every region is a bit, numbered by its row in the file. A region's function
//! is the smallest function of its module whose span holds the region's first
//! line; a function is its own. A case's journey is its mask, and its size is
//! how many regions it entered, so "the smallest journey" means the case that
//! did the least besides.
//!
//! A set is expanded at most once per reading: regions whose cases are the same
//! share a set, and a hub function shares its set with every branch every one
//! of its callers passes.

// compass: variance-authority.reach.relations

use std::collections::HashMap;
use std::rc::Rc;

use crate::journey_read::Journey;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Shape {
    Module,
    Function,
    Inner,
}

/// One region, as the calculations see it.
#[derive(Clone, Copy)]
pub(crate) struct Bit {
    pub module: u32,
    pub shape: Shape,
    pub kind: u32,
    pub name: u32,
    pub start: u32,
    pub end: u32,
    pub called: u32,
    /// The function the region is written in: itself for a function, absent
    /// for a module or a region no recorded function holds.
    pub function: Option<u32>,
}

pub(crate) struct JourneyMasks {
    pub journey: Journey,
    /// Every region, by its row.
    pub bits: Vec<Bit>,
    /// Each module's rows, `[from, to)`.
    rows: Vec<(u32, u32)>,
    sets: HashMap<u32, Rc<Vec<u32>>>,
    sizes: Option<Rc<Vec<u32>>>,
}

impl JourneyMasks {
    pub fn open(file: &str) -> Result<JourneyMasks, String> {
        JourneyMasks::of(Journey::open(file)?)
    }

    pub fn of(journey: Journey) -> Result<JourneyMasks, String> {
        let mut shapes: HashMap<u32, Shape> = HashMap::new();
        let mut bits = Vec::new();
        let mut rows = Vec::with_capacity(journey.modules());
        for module in 0..journey.modules() {
            let from = bits.len() as u32;
            let regions = journey.regions(module)?;
            for region in &regions {
                if region.at != bits.len() {
                    return Err("journey regions are not numbered by row".to_owned());
                }
                let shape = match shapes.get(&region.kind) {
                    Some(shape) => *shape,
                    None => {
                        let shape = match journey.text(region.kind)? {
                            "module" => Shape::Module,
                            "function" => Shape::Function,
                            _ => Shape::Inner,
                        };
                        shapes.insert(region.kind, shape);
                        shape
                    }
                };
                bits.push(Bit {
                    module: module as u32,
                    shape,
                    kind: region.kind,
                    name: region.name,
                    start: region.start,
                    end: region.end,
                    called: region.called,
                    function: None,
                });
            }
            let to = bits.len() as u32;
            enclose(&mut bits[from as usize..to as usize], from);
            rows.push((from, to));
        }
        Ok(JourneyMasks { journey, bits, rows, sets: HashMap::new(), sizes: None })
    }

    /// The cases that entered set `set`, expanded once.
    pub fn members(&mut self, set: u32) -> Result<Rc<Vec<u32>>, String> {
        if let Some(members) = self.sets.get(&set) {
            return Ok(members.clone());
        }
        let members = Rc::new(self.journey.members(set)?);
        self.sets.insert(set, members.clone());
        Ok(members)
    }

    /// The cases that entered region `bit`.
    pub fn entered(&mut self, bit: u32) -> Result<Rc<Vec<u32>>, String> {
        self.members(self.bits[bit as usize].called)
    }

    /// Every case's journey size: the regions it entered, modules aside.
    pub fn sizes(&mut self) -> Result<Rc<Vec<u32>>, String> {
        if let Some(sizes) = &self.sizes {
            return Ok(sizes.clone());
        }
        let mut weight: HashMap<u32, u32> = HashMap::new();
        for bit in &self.bits {
            if bit.shape != Shape::Module {
                *weight.entry(bit.called).or_default() += 1;
            }
        }
        let mut weighted: Vec<(u32, u32)> = weight.into_iter().collect();
        weighted.sort_unstable();
        let mut sizes = vec![0u32; self.journey.tests()];
        for (set, times) in weighted {
            for &case in self.members(set)?.iter() {
                if let Some(size) = sizes.get_mut(case as usize) {
                    *size += times;
                }
            }
        }
        let sizes = Rc::new(sizes);
        self.sizes = Some(sizes.clone());
        Ok(sizes)
    }

    /// The masks of the cases `wanted` marks, each ascending, by case.
    pub fn masks(&mut self, wanted: &[bool]) -> Result<HashMap<u32, Vec<u32>>, String> {
        let mut masks: HashMap<u32, Vec<u32>> = HashMap::new();
        for at in 0..self.bits.len() {
            let bit = self.bits[at];
            if bit.shape == Shape::Module {
                continue;
            }
            for &case in self.members(bit.called)?.iter() {
                if wanted.get(case as usize).copied().unwrap_or(false) {
                    masks.entry(case).or_default().push(at as u32);
                }
            }
        }
        Ok(masks)
    }

    /// The innermost recorded function of `file` whose span holds `line`.
    pub fn function_at(&self, file: &str, line: u32) -> Result<Option<u32>, String> {
        let Some(module) = self.journey.module_of(file)? else { return Ok(None) };
        let (from, to) = self.rows[module];
        Ok((from..to)
            .filter(|&at| {
                let bit = &self.bits[at as usize];
                bit.shape == Shape::Function && bit.start <= line && line <= bit.end
            })
            .min_by_key(|&at| (self.bits[at as usize].end - self.bits[at as usize].start, at)))
    }

    /// Function `function` and every function written inside it.
    pub fn within(&self, function: u32) -> Vec<u32> {
        let outer = self.bits[function as usize];
        let (from, to) = self.rows[outer.module as usize];
        (from..to)
            .filter(|&at| {
                let bit = &self.bits[at as usize];
                bit.shape == Shape::Function && outer.start <= bit.start && bit.end <= outer.end
            })
            .collect()
    }

    /// The regions written in `function` and not in a function inside it.
    pub fn inside(&self, function: u32) -> Vec<u32> {
        let (from, to) = self.rows[self.bits[function as usize].module as usize];
        (from..to)
            .filter(|&at| {
                let bit = &self.bits[at as usize];
                bit.shape == Shape::Inner && bit.function == Some(function)
            })
            .collect()
    }

    pub fn file(&self, bit: u32) -> Result<&str, String> {
        self.journey.module_file(self.bits[bit as usize].module as usize)
    }
}

/// Give each region of one module the function it is written in.
fn enclose(bits: &mut [Bit], from: u32) {
    let functions: Vec<(u32, u32, u32)> = bits
        .iter()
        .enumerate()
        .filter(|(_, bit)| bit.shape == Shape::Function)
        .map(|(at, bit)| (bit.start, bit.end, from + at as u32))
        .collect();
    for (at, bit) in bits.iter_mut().enumerate() {
        bit.function = match bit.shape {
            Shape::Module => None,
            Shape::Function => Some(from + at as u32),
            Shape::Inner => functions
                .iter()
                .filter(|(start, end, _)| *start <= bit.start && bit.start <= *end)
                .min_by_key(|(start, end, row)| (end - start, *row))
                .map(|(_, _, row)| *row),
        };
    }
}

/// How much two ascending masks share, over the larger of them.
pub(crate) fn overlap(left: &[u32], right: &[u32]) -> f64 {
    let larger = left.len().max(right.len());
    if larger == 0 {
        return 0.0;
    }
    let (mut i, mut j, mut shared) = (0, 0, 0usize);
    while i < left.len() && j < right.len() {
        match left[i].cmp(&right[j]) {
            std::cmp::Ordering::Less => i += 1,
            std::cmp::Ordering::Greater => j += 1,
            std::cmp::Ordering::Equal => {
                shared += 1;
                i += 1;
                j += 1;
            }
        }
    }
    shared as f64 / larger as f64
}

#[cfg(test)]
#[path = "journey_masks_tests.rs"]
mod tests;
