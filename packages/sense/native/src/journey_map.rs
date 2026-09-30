//! The map of the code around one file, drawn from the journeys of the tests
//! that entered it. The terms of a task keep some of those tests; the map is
//! what the kept journeys ran and the rest of the suite mostly did not.
//!
//! Inside the file, each function is its paths among the kept cases, so a hub
//! reads as its passage and a handful of purposes. Outside it, a function most
//! of the whole suite enters is structure and is counted, not drawn. What most
//! kept cases enter is the spine, nearest first: a place is as near as the
//! smallest kept journey that reached it, because a small journey did little
//! besides. What fewer kept cases enter is a branch, and the functions entered
//! by exactly the same cases are one branch, told by the smallest of them.

// compass: variance-authority.reach.relations

use std::collections::HashMap;

use napi_derive::napi;

use crate::journey_masks::{JourneyMasks, Shape};
use crate::journey_paths::{case_of, function_of, paths_of, JourneyCase, JourneyFunction, JourneyPath};
use crate::order;

/// A function of the file, read through the kept cases.
#[napi(object)]
pub struct JourneyMapFunction {
    pub function: JourneyFunction,
    /// Kept cases that entered it.
    pub cases: u32,
    /// Most cases first.
    pub paths: Vec<JourneyPath>,
}

/// A function beyond the file that most kept cases entered.
#[napi(object)]
pub struct JourneyMapPlace {
    pub function: JourneyFunction,
    pub cases: u32,
    /// The smallest kept journey that reached it.
    pub nearest: JourneyCase,
}

/// The functions beyond the file that exactly the same few kept cases entered.
#[napi(object)]
pub struct JourneyMapBranch {
    pub cases: u32,
    /// In file and line order.
    pub places: Vec<JourneyFunction>,
    pub smallest: JourneyCase,
}

#[napi(object)]
pub struct JourneyMap {
    /// Why the recording cannot answer; every other field is empty then.
    pub not_recorded: Option<String>,
    pub file: String,
    /// Cases in the recording: the denominator of structure.
    pub suite: u32,
    /// Cases that entered the file.
    pub entered: u32,
    /// Those the terms kept; every one of them when no term was given.
    pub kept: u32,
    /// The kept cases, smallest journey first.
    pub tests: Vec<JourneyCase>,
    /// The file's functions some kept case entered, in source order.
    pub functions: Vec<JourneyMapFunction>,
    /// Beyond the file, entered by most kept cases, nearest first.
    pub spine: Vec<JourneyMapPlace>,
    /// Beyond the file, entered by fewer, most cases first.
    pub branches: Vec<JourneyMapBranch>,
    /// Functions beyond the file the kept cases entered and at least half the suite did too.
    pub structure: u32,
}

fn refused(file: String, reason: String) -> JourneyMap {
    JourneyMap {
        not_recorded: Some(reason),
        file,
        suite: 0,
        entered: 0,
        kept: 0,
        tests: Vec::new(),
        functions: Vec::new(),
        spine: Vec::new(),
        branches: Vec::new(),
        structure: 0,
    }
}

/// What the checkout says about a file the recording may keep no row for,
/// asked by the caller before the recording is opened: git owns what existed
/// at the recording's commit, and the runner's instrument filter owns what a
/// row could be kept for.
#[napi(object)]
pub struct JourneyMapFile {
    /// Whether the default instrument filter takes the file: a JavaScript or
    /// TypeScript module that is not a test, a config or a type declaration.
    pub module: bool,
    /// The commit the recording names.
    pub commit: Option<String>,
    /// Whether git lists the file at `commit`; absent when git could not say.
    pub existed: Option<bool>,
    /// Why `existed` is absent.
    pub unread: Option<String>,
}

/// The map around `file`, kept to the cases whose test file or name holds any
/// of `terms`, ignoring case, or to every case that entered it when none is given.
/// `known` is read only when the recording keeps no row for `file`.
#[napi(catch_unwind)]
pub fn journey_map(recording: String, file: String, terms: Option<Vec<String>>, known: Option<JourneyMapFile>) -> JourneyMap {
    let terms = terms.unwrap_or_default();
    let answered = JourneyMasks::open(&recording).and_then(|mut masks| match map(&mut masks, &file, &terms)? {
        Some(answer) => Ok(answer),
        None => Ok(refused(file.clone(), unmapped(&mut masks, &file, known.as_ref())?)),
    });
    answered.unwrap_or_else(|error| refused(file, format!("the recording did not read ({error})")))
}

/// Modules named when the file asked about is a test file.
const INSTEAD: usize = 3;

/// The digits of a commit a reader needs to find it.
const SHORT: usize = 12;

/// Why there is no map around `file`, which the recording keeps no row for.
///
/// A test file is not a module the probe records, so it is answered with the
/// modules its own cases ran most. Any other file is a finding only when every
/// owner agrees it could have had a row: the default filter instruments it, git
/// lists it at the recording's commit, and the recording keeps rows for other
/// files beside it. Short of any of those, the answer says the recording cannot
/// tell, and why.
pub(crate) fn unmapped(masks: &mut JourneyMasks, file: &str, known: Option<&JourneyMapFile>) -> Result<String, String> {
    let own: Vec<bool> = masks.journey.test_file_names()?.iter().map(|name| *name == file).collect();
    let declared = own.iter().filter(|&&is| is).count();
    if declared > 0 {
        return instead(masks, file, &own, declared);
    }
    let cannot = format!("The recording cannot say whether a test loaded {file}");
    let Some(known) = known else {
        return Ok(format!("{cannot}: the caller did not say whether the file existed when the recording was made."));
    };
    if !known.module {
        return Ok(format!(
            "{cannot}: it keeps rows for the source modules a test run instruments, and by default a run leaves out tests, configs, type declarations and files that are not JavaScript or TypeScript."
        ));
    }
    let at = known.commit.as_deref().map(|commit| &commit[..commit.len().min(SHORT)]);
    let at = match (known.existed, at) {
        (Some(true), Some(at)) => at,
        (Some(false), Some(at)) => {
            return Ok(format!("{file} is new since the recording, which was made at {at}, so the recording cannot say whether a test loads it."));
        }
        _ => {
            let why = known.unread.as_deref().unwrap_or("the recording names no commit");
            return Ok(format!("{cannot}: git cannot say whether the file existed when the recording was made ({why})."));
        }
    };
    // A root-level file is judged by the root's own files, not by every row.
    let (dir, place) = match file.rfind('/') {
        Some(end) => (&file[..=end], format!("under {}", &file[..=end])),
        None => ("", "at the repository root".to_owned()),
    };
    let rows = masks
        .journey
        .files()?
        .iter()
        .filter(|path| if dir.is_empty() { !path.contains('/') } else { path.starts_with(dir) })
        .count();
    if rows == 0 {
        return Ok(format!(
            "{cannot}: it lists no file {place}. A directory with no listed file is either one that no recorded test loaded or one that the test run does not instrument, and the recording does not say which."
        ));
    }
    // TODO: keep a row for each module a run loads and leaves uninstrumented, so this answer can tell one from a module no test loaded.
    Ok(format!(
        "No recorded test loaded {file}, unless the test run leaves it uninstrumented, as it must for a module whose functions are sent to a browser page. The file existed at {at}, where the recording was made, and the recording lists {rows} {} {place} that its {} {} loaded, but not this one.",
        plural(rows, "file", "files"),
        own.len(),
        plural(own.len(), "test", "tests"),
    ))
}

/// A test file's answer: the modules its cases ran most, and among those the
/// ones fewer of the whole suite ran first, so the module the file is about
/// comes before the shared code every test runs.
fn instead(masks: &mut JourneyMasks, file: &str, own: &[bool], declared: usize) -> Result<String, String> {
    let mut stamp = vec![u32::MAX; own.len()];
    // (module, cases of this file that ran it, cases of the suite that ran it)
    let mut ran: Vec<(u32, u32, u32)> = Vec::new();
    let mut current: Option<(u32, u32, u32)> = None;
    for bit in 0..masks.bits.len() as u32 {
        let held = masks.bits[bit as usize];
        if held.shape != Shape::Function {
            continue;
        }
        if current.is_some_and(|(module, _, _)| module != held.module) {
            ran.extend(current.take().filter(|&(_, mine, _)| mine > 0));
        }
        let (module, mut mine, mut all) = current.unwrap_or((held.module, 0, 0));
        for &case in masks.entered(bit)?.iter() {
            if stamp.get(case as usize).is_some_and(|&seen| seen != module) {
                stamp[case as usize] = module;
                all += 1;
                mine += u32::from(own[case as usize]);
            }
        }
        current = Some((module, mine, all));
    }
    ran.extend(current.filter(|&(_, mine, _)| mine > 0));
    let journey = &masks.journey;
    ran.sort_by(|x, y| {
        y.1.cmp(&x.1)
            .then(x.2.cmp(&y.2))
            .then(order::code_unit(journey.module_file(x.0 as usize).unwrap_or(""), journey.module_file(y.0 as usize).unwrap_or("")))
    });
    let its = format!("its {declared} recorded {}", plural(declared, "test", "tests"));
    if ran.is_empty() {
        return Ok(format!(
            "{file} is a test file, and journey-map draws its map around the code that tests run. None of {its} ran a function the recording lists, so there is no module to ask about instead."
        ));
    }
    let mut lines = vec![format!(
        "{file} is a test file, and journey-map draws its map around the code that tests run. Ask about one of the modules {its} ran most:"
    )];
    for &(module, mine, all) in ran.iter().take(INSTEAD) {
        lines.push(format!(
            "  {}  run by {mine} of its {declared} {} and {all} of all {} recorded tests",
            journey.module_file(module as usize)?,
            plural(declared, "test", "tests"),
            own.len()
        ));
    }
    Ok(lines.join("\n"))
}

fn plural(count: usize, one: &'static str, many: &'static str) -> &'static str {
    if count == 1 {
        one
    } else {
        many
    }
}

pub(crate) fn map(masks: &mut JourneyMasks, file: &str, terms: &[String]) -> Result<Option<JourneyMap>, String> {
    let Some(module) = masks.journey.module_of(file)? else { return Ok(None) };
    let tests = masks.journey.tests();
    let own = masks.functions_in(module);
    let mut entered = vec![false; tests];
    for &function in &own {
        for &case in masks.entered(function)?.iter() {
            if let Some(slot) = entered.get_mut(case as usize) {
                *slot = true;
            }
        }
    }
    let terms: Vec<String> = terms.iter().map(|term| term.trim().to_lowercase()).filter(|term| !term.is_empty()).collect();
    let mut kept = vec![false; tests];
    for case in (0..tests).filter(|&case| entered[case]) {
        let named = format!("{} {}", masks.journey.test_file(case)?, masks.journey.test_name(case)?).to_lowercase();
        kept[case] = terms.is_empty() || terms.iter().any(|term| named.contains(term.as_str()));
    }
    let total = kept.iter().filter(|&&k| k).count();
    let sizes = masks.sizes()?;
    let mut answer = JourneyMap {
        not_recorded: None,
        file: file.to_owned(),
        suite: tests as u32,
        entered: entered.iter().filter(|&&e| e).count() as u32,
        kept: total as u32,
        tests: tests_of(masks, &kept, &sizes)?,
        functions: Vec::new(),
        spine: Vec::new(),
        branches: Vec::new(),
        structure: 0,
    };
    for &function in &own {
        let (cases, paths) = paths_of(masks, function, Some(&kept))?;
        if cases > 0 {
            answer.functions.push(JourneyMapFunction { function: function_of(masks, function)?, cases, paths });
        }
    }
    let mut spine = Vec::new();
    let mut branches: HashMap<Vec<u32>, Vec<u32>> = HashMap::new();
    for bit in 0..masks.bits.len() as u32 {
        let held = masks.bits[bit as usize];
        if held.shape != Shape::Function || held.module as usize == module {
            continue;
        }
        let all = masks.entered(bit)?;
        let reached: Vec<u32> = all.iter().copied().filter(|&case| kept.get(case as usize).copied().unwrap_or(false)).collect();
        if reached.is_empty() {
            continue;
        }
        if all.len() * 2 >= tests {
            answer.structure += 1;
        } else if reached.len() * 2 > total {
            let nearest = *reached.iter().min_by_key(|&&case| (sizes[case as usize], case)).unwrap_or(&reached[0]);
            spine.push((sizes[nearest as usize], bit, reached.len() as u32, nearest));
        } else {
            branches.entry(reached).or_default().push(bit);
        }
    }
    spine.sort_by(|x, y| x.0.cmp(&y.0).then(order::code_unit(masks.file(x.1).unwrap_or(""), masks.file(y.1).unwrap_or(""))).then(x.1.cmp(&y.1)));
    for (size, bit, cases, nearest) in spine {
        answer.spine.push(JourneyMapPlace { function: function_of(masks, bit)?, cases, nearest: case_of(masks, nearest, size, None)? });
    }
    let mut grouped: Vec<(Vec<u32>, Vec<u32>, u32)> = branches
        .into_iter()
        .map(|(cases, places)| {
            let smallest = *cases.iter().min_by_key(|&&case| (sizes[case as usize], case)).unwrap_or(&cases[0]);
            (cases, places, smallest)
        })
        .collect();
    grouped.sort_by(|x, y| y.0.len().cmp(&x.0.len()).then((sizes[x.2 as usize], x.2).cmp(&(sizes[y.2 as usize], y.2))).then(x.1.cmp(&y.1)));
    for (cases, mut places, smallest) in grouped {
        places.sort_by(|x, y| order::code_unit(masks.file(*x).unwrap_or(""), masks.file(*y).unwrap_or("")).then(x.cmp(y)));
        answer.branches.push(JourneyMapBranch {
            cases: cases.len() as u32,
            places: places.iter().map(|&bit| function_of(masks, bit)).collect::<Result<_, _>>()?,
            smallest: case_of(masks, smallest, sizes[smallest as usize], None)?,
        });
    }
    Ok(Some(answer))
}

/// The kept cases, smallest journey first, each with the kept cases whose journey is the same.
fn tests_of(masks: &mut JourneyMasks, kept: &[bool], sizes: &[u32]) -> Result<Vec<JourneyCase>, String> {
    let journeys = masks.masks(kept)?;
    let mut alike: HashMap<&Vec<u32>, u32> = HashMap::new();
    for mask in journeys.values() {
        *alike.entry(mask).or_default() += 1;
    }
    let mut cases: Vec<u32> = (0..kept.len() as u32).filter(|&case| kept[case as usize]).collect();
    cases.sort_by_key(|&case| (sizes[case as usize], case));
    cases
        .into_iter()
        .map(|case| {
            let same = journeys.get(&case).and_then(|mask| alike.get(mask)).map_or(0, |n| n - 1);
            case_of(masks, case, sizes[case as usize], Some(same))
        })
        .collect()
}
