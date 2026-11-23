//! What one test is made of, read off the cases alone: the smaller tests whose
//! journeys sit inside its own, the larger ones whose journeys hold it, and
//! what is left when its pieces are taken away.
//!
//! A test's footprint is the regions it entered, less structure: a region more
//! than half the suite entered says nothing about any one test. A piece is a
//! smaller test with at least nine tenths of its footprint inside this one; a
//! whole is a larger test holding at least nine tenths of this one. A test whose
//! footprint is the same as this one's is alike, and is neither.
//!
//! The residue is what no piece entered, counted region by region and never as
//! a difference of totals. It splits in two. A region in a module no piece
//! entered is the test's own layer, which only it reaches. A region in a module
//! a piece entered is a path of that piece's code that only the larger test
//! takes, and a test nearer the code would reach it more cheaply.

// compass: variance-authority.reach.relations

use std::collections::{HashMap, HashSet};

use napi_derive::napi;

use crate::journey_masks::{is_structural, JourneyMasks, Shape};
use crate::journey_paths::{block, case_of, JourneyBlock, JourneyCase};
use crate::order;

/// A piece holds at least this share of its own footprint inside the test; a
/// whole holds at least this share of the test's.
const HOLDS: f64 = 0.9;

/// Test names listed when the one asked about cannot be chosen.
const LISTED: usize = 10;

/// Another test, beside the one asked about.
#[napi(object)]
pub struct JourneyPiece {
    /// `blocks` is its footprint: the regions it entered, structure aside.
    pub case: JourneyCase,
    /// Regions of the footprint asked about that it also entered.
    pub shared: u32,
}

#[napi(object)]
pub struct TestComposition {
    /// Why the recording cannot answer; every other field is empty then.
    pub not_recorded: Option<String>,
    /// Cases in the recording: the denominator of structure.
    pub suite: u32,
    /// The test asked about; `blocks` is its footprint.
    pub test: Option<JourneyCase>,
    /// Regions it entered that more than half the suite entered too.
    pub structure: u32,
    /// Other tests whose footprint is exactly its own, in recording order;
    /// `blocks` is that footprint.
    pub alike: Vec<JourneyCase>,
    /// Smaller tests inside it, most shared first.
    pub pieces: Vec<JourneyPiece>,
    /// Larger tests holding it, smallest first.
    pub wholes: Vec<JourneyPiece>,
    /// Regions of its footprint some piece entered.
    pub explained: u32,
    /// Residue in modules no piece entered, in file and line order.
    pub own: Vec<JourneyBlock>,
    /// Residue in modules a piece entered, in file and line order.
    pub reached: Vec<JourneyBlock>,
}

fn refused(reason: String) -> TestComposition {
    TestComposition {
        not_recorded: Some(reason),
        suite: 0,
        test: None,
        structure: 0,
        alike: Vec::new(),
        pieces: Vec::new(),
        wholes: Vec::new(),
        explained: 0,
        own: Vec::new(),
        reached: Vec::new(),
    }
}

/// What the test declared in `file` is made of. `name` chooses among several
/// tests of the file: one named exactly that, or the one whose name holds it,
/// ignoring case.
#[napi(catch_unwind)]
pub fn test_composition(recording: String, file: String, name: Option<String>) -> TestComposition {
    JourneyMasks::open(&recording)
        .and_then(|mut masks| compose(&mut masks, &file, name.as_deref()))
        .unwrap_or_else(|error| refused(format!("the recording did not read ({error})")))
}

pub(crate) fn compose(masks: &mut JourneyMasks, file: &str, name: Option<&str>) -> Result<TestComposition, String> {
    let asked = match chosen(masks, file, name)? {
        Ok(case) => case,
        Err(reason) => return Ok(refused(reason)),
    };
    let suite = masks.journey.tests();
    let sizes = masks.sizes()?;

    // Structure, and how much of it each case entered, so a footprint is a size less its structure.
    let mut structural = vec![false; masks.bits.len()];
    let mut held = vec![0u32; suite];
    for at in 0..masks.bits.len() {
        if masks.bits[at].shape == Shape::Module {
            continue;
        }
        let members = masks.entered(at as u32)?;
        if is_structural(members.len(), suite) {
            structural[at] = true;
            for &case in members.iter() {
                if let Some(count) = held.get_mut(case as usize) {
                    *count += 1;
                }
            }
        }
    }
    let footprint = |case: u32| sizes[case as usize] - held[case as usize];

    let mut only = vec![false; suite];
    only[asked as usize] = true;
    let entered = masks.masks(&only)?.remove(&asked).unwrap_or_default();
    let mine: Vec<u32> = entered.iter().copied().filter(|&bit| !structural[bit as usize]).collect();
    let size = mine.len() as u32;

    let mut shared: HashMap<u32, u32> = HashMap::new();
    for &bit in &mine {
        for &case in masks.entered(bit)?.iter() {
            if case != asked {
                *shared.entry(case).or_default() += 1;
            }
        }
    }
    let (mut pieces, mut wholes, mut alike) = (Vec::new(), Vec::new(), Vec::new());
    if size > 0 {
        for (&case, &with) in &shared {
            let theirs = footprint(case);
            if theirs < size && f64::from(with) >= HOLDS * f64::from(theirs) {
                pieces.push((case, theirs, with));
            } else if theirs > size && f64::from(with) >= HOLDS * f64::from(size) {
                wholes.push((case, theirs, with));
            } else if theirs == size && with == size {
                alike.push(case);
            }
        }
    }
    pieces.sort_by_key(|&(case, theirs, with)| (u32::MAX - with, u32::MAX - theirs, case));
    wholes.sort_by_key(|&(case, theirs, _)| (theirs, case));
    alike.sort_unstable();

    let mut kept = vec![false; suite];
    for &(case, _, _) in &pieces {
        kept[case as usize] = true;
    }
    let mut touched: HashSet<u32> = HashSet::new();
    for mask in masks.masks(&kept)?.values() {
        touched.extend(mask.iter().filter(|&&bit| !structural[bit as usize]).map(|&bit| masks.bits[bit as usize].module));
    }
    let (mut explained, mut own, mut reached) = (0, Vec::new(), Vec::new());
    for &bit in &mine {
        if masks.entered(bit)?.iter().any(|&case| kept[case as usize]) {
            explained += 1;
        } else if touched.contains(&masks.bits[bit as usize].module) {
            reached.push(block(masks, bit)?);
        } else {
            own.push(block(masks, bit)?);
        }
    }
    for blocks in [&mut own, &mut reached] {
        blocks.sort_by(|a, b| order::code_unit(&a.file, &b.file).then(a.line.cmp(&b.line)).then(a.end.cmp(&b.end)));
    }

    let piece = |masks: &JourneyMasks, (case, theirs, with): (u32, u32, u32)| -> Result<JourneyPiece, String> {
        Ok(JourneyPiece { case: case_of(masks, case, theirs, None)?, shared: with })
    };
    Ok(TestComposition {
        not_recorded: None,
        suite: suite as u32,
        test: Some(case_of(masks, asked, size, None)?),
        structure: entered.len() as u32 - size,
        alike: alike.into_iter().map(|case| case_of(masks, case, size, None)).collect::<Result<_, _>>()?,
        pieces: pieces.into_iter().map(|found| piece(masks, found)).collect::<Result<_, _>>()?,
        wholes: wholes.into_iter().map(|found| piece(masks, found)).collect::<Result<_, _>>()?,
        explained,
        own,
        reached,
    })
}

/// One recorded region of a module the test entered.
#[napi(object)]
pub struct RanRegion {
    pub kind: String,
    pub line: u32,
    pub end: u32,
    /// Whether it holds source text, not code the transform wrote.
    pub source: bool,
    /// The name of the function it is written in, when one is recorded.
    pub function: Option<String>,
    /// Whether the test entered it.
    pub entered: bool,
    /// Whether more than half the suite entered it, as a composition counts structure.
    pub structure: bool,
    /// Whether the test entered the function it is written in, itself for a
    /// function; absent when no recorded function holds it.
    pub function_entered: Option<bool>,
    /// How many other tests entered it: none says only this test enters it
    /// when it did, and no test takes it when it did not.
    pub others: u32,
    /// The smallest other journey that entered it, the one to read for what
    /// takes it; absent when no other test did. `blocks` is its journey size.
    pub smallest: Option<JourneyCase>,
}

/// A module the test entered, with every region recorded in it.
#[napi(object)]
pub struct RanModule {
    pub file: String,
    /// In row order.
    pub regions: Vec<RanRegion>,
}

#[napi(object)]
pub struct TestRan {
    /// Why the recording cannot answer; every other field is empty then.
    pub not_recorded: Option<String>,
    /// Cases in the recording.
    pub suite: u32,
    /// The test asked about; `blocks` is how many regions it entered.
    pub test: Option<JourneyCase>,
    /// The modules it entered at least one region of, in file order.
    pub modules: Vec<RanModule>,
}

/// Which regions the test declared in `file` entered, and which it passed by,
/// in every module it entered. `name` chooses as it does for `testComposition`.
#[napi(catch_unwind)]
pub fn test_ran(recording: String, file: String, name: Option<String>) -> TestRan {
    JourneyMasks::open(&recording).and_then(|mut masks| ran(&mut masks, &file, name.as_deref())).unwrap_or_else(|error| TestRan {
        not_recorded: Some(format!("the recording did not read ({error})")),
        suite: 0,
        test: None,
        modules: Vec::new(),
    })
}

pub(crate) fn ran(masks: &mut JourneyMasks, file: &str, name: Option<&str>) -> Result<TestRan, String> {
    let asked = match chosen(masks, file, name)? {
        Ok(case) => case,
        Err(reason) => return Ok(TestRan { not_recorded: Some(reason), suite: 0, test: None, modules: Vec::new() }),
    };
    let suite = masks.journey.tests();
    let sizes = masks.sizes()?;
    let mut only = vec![false; suite];
    only[asked as usize] = true;
    let entered: HashSet<u32> = masks.masks(&only)?.remove(&asked).unwrap_or_default().into_iter().collect();
    let mut touched: Vec<u32> = entered.iter().map(|&bit| masks.bits[bit as usize].module).collect::<HashSet<_>>().into_iter().collect();
    touched.sort_unstable();
    let mut modules = Vec::with_capacity(touched.len());
    for module in touched {
        let mut regions = Vec::new();
        for bit in masks.rows_of(module as usize) {
            if masks.bits[bit as usize].shape == Shape::Module {
                continue;
            }
            let held = block(masks, bit)?;
            let members = masks.entered(bit)?;
            let structure = is_structural(members.len(), suite);
            let function_entered = masks.bits[bit as usize].function.map(|function| entered.contains(&function));
            let others: Vec<u32> = members.iter().copied().filter(|&case| case != asked).collect();
            let smallest = others.iter().copied().min_by_key(|&case| (sizes[case as usize], case));
            regions.push(RanRegion {
                kind: held.kind,
                line: held.line,
                end: held.end,
                source: masks.bits[bit as usize].source,
                function: held.function,
                entered: entered.contains(&bit),
                structure,
                function_entered,
                others: others.len() as u32,
                smallest: smallest.map(|case| case_of(masks, case, sizes[case as usize], None)).transpose()?,
            });
        }
        modules.push(RanModule { file: masks.journey.module_file(module as usize)?.to_owned(), regions });
    }
    modules.sort_by(|a, b| order::code_unit(&a.file, &b.file));
    Ok(TestRan { not_recorded: None, suite: suite as u32, test: Some(case_of(masks, asked, entered.len() as u32, None)?), modules })
}

/// The one case `file` and `name` choose, or why they choose none.
fn chosen(masks: &JourneyMasks, file: &str, name: Option<&str>) -> Result<Result<u32, String>, String> {
    let mut declared: Vec<(u32, &str)> = Vec::new();
    for case in 0..masks.journey.tests() {
        if masks.journey.test_file(case)? == file {
            declared.push((case as u32, masks.journey.test_name(case)?));
        }
    }
    if declared.is_empty() {
        return Ok(Err(format!("The recording holds no test declared in {file}.")));
    }
    let matched: Vec<(u32, &str)> = match name {
        None => declared.clone(),
        Some(name) => match declared.iter().find(|(_, held)| *held == name) {
            Some(&exact) => vec![exact],
            None => {
                let lower = name.to_lowercase();
                declared.iter().copied().filter(|(_, held)| held.to_lowercase().contains(&lower)).collect()
            }
        },
    };
    Ok(match (matched.as_slice(), name) {
        ([(case, _)], _) => Ok(*case),
        ([], Some(name)) => Err(format!(
            "No recorded test in {file} has {name} in its name. Its {} recorded test{}:{}",
            declared.len(),
            if declared.len() == 1 { "" } else { "s" },
            listed(&declared)
        )),
        (several, Some(name)) => Err(format!(
            "{} recorded tests in {file} have {name} in their names; name one of them:{}",
            several.len(),
            listed(several)
        )),
        (several, None) => Err(format!("{file} declares {} recorded tests; name one of them:{}", several.len(), listed(several))),
    })
}

/// Test names, one to a line, in code-unit order, the rest counted.
fn listed(cases: &[(u32, &str)]) -> String {
    let mut names: Vec<&str> = cases.iter().map(|(_, name)| *name).collect();
    names.sort_by(|a, b| order::code_unit(a, b));
    let mut lines: String = names.iter().take(LISTED).map(|name| format!("\n  {name}")).collect();
    if names.len() > LISTED {
        lines.push_str(&format!("\n  and {} more", names.len() - LISTED));
    }
    lines
}

#[cfg(test)]
#[path = "journey_compose_tests.rs"]
mod tests;
