//! Which test files a change needs, answered off a journey file in one call.
//!
//! The rules are `narrowByJourneys` (`test-selection/execution-select.ts`), which
//! stays as the reading when no addon reached the machine and as the oracle this
//! is tested against. A changed line is charged to the innermost region holding
//! it and selects the cases that entered that region. A file named whole, a file
//! with no row, and a region that ran while its module evaluated are answered by
//! the file graph, plus the record's own entrants wherever it holds a row. A
//! changed test file selects itself, and a path neither knows is `unread`. A
//! file whose two texts were read charges by the verdict: `none` charges
//! nothing, and `bodies` charges the regions its lines fall in without the
//! module's own, because the reading proved what it does as it loads is equal. A
//! crossing is its case's own: a mock is installed before the file's first case
//! runs, and module evaluation — the one box where a runner evaluates the real
//! module to shape a mock — is the region's `loaded` flag, credited to no case
//! and answered by the graph, which is where the mocks are.
//! A package whose install moved changes no line, so it is answered by the
//! graph: every test file whose imports reach it, and every case the record saw
//! enter a module that does.
//!
//! Only the regions a change lands on have their sets expanded, and each test is
//! looked at once per module, so the cost follows the change and not the day of
//! shards the file holds.

use std::collections::{HashMap, HashSet};

use napi_derive::napi;

use crate::journey_graph::{Graph, JourneyGraph};
use crate::journey_query::JourneyChange;
use crate::journey_read::{pairs, Journey};

#[napi(object)]
pub struct JourneySelection {
    /// Every test file the journey holds a case of.
    pub whole: Vec<String>,
    /// The test files the change needs.
    pub entered: Vec<String>,
    /// Changed paths neither the record nor the graph knows.
    pub unread: Vec<String>,
}

struct Selecting<'a> {
    journey: &'a Journey,
    tests: Vec<&'a str>,
    graph: Option<Graph<'a>>,
    held: HashSet<&'a str>,
    entered: HashSet<&'a str>,
    seen: Vec<bool>,
}

impl<'a> Selecting<'a> {
    fn importers(&self, file: &str) -> Option<Vec<&'a str>> {
        let graph = self.graph.as_ref()?;
        let found = graph.importers(file)?;
        Some(found.into_iter().filter(|test| self.held.contains(test)).collect())
    }

    /// Enter every test in `members`.
    fn enter(&mut self, members: &[u32]) {
        for &test in members {
            let at = test as usize;
            if !self.seen[at] {
                self.seen[at] = true;
                self.entered.insert(self.tests[at]);
            }
        }
    }

    fn every_entrant(&mut self, module: usize) -> Result<(), String> {
        let journey = self.journey;
        self.seen.fill(false);
        let mut sets = HashSet::new();
        for block in journey.blocks(module) {
            if sets.insert(journey.called[block]) {
                let members = journey.members(block)?;
                self.enter(&members);
            }
        }
        Ok(())
    }

    fn change(
        &mut self,
        file: &str,
        ranges: &[(u32, u32)],
        module: Option<usize>,
        read: Option<&str>,
    ) -> Result<Option<String>, String> {
        if let Some(test) = self.held.get(file).copied() {
            self.entered.insert(test);
        }
        if read == Some("none") && !ranges.is_empty() {
            return Ok(None);
        }
        let Some(module) = module.filter(|_| !ranges.is_empty()) else {
            let by_graph = self.importers(file);
            let unknown = by_graph.is_none();
            self.entered.extend(by_graph.unwrap_or_default());
            // The graph misses a module a browser spec reached through its page,
            // so the record's own entrants are added whenever it holds a row.
            if let Some(module) = module {
                self.every_entrant(module)?;
            } else if unknown && !self.held.contains(file) {
                return Ok(Some(file.to_owned()));
            }
            return Ok(None);
        };

        let journey = self.journey;
        let settled = read == Some("bodies");
        let candidates: Vec<usize> = journey.blocks(module).filter(|block| journey.overlaps(*block, ranges)).collect();
        let mut chosen: Vec<usize> = Vec::new();
        let mut innermost = Vec::new();
        for (start, end) in ranges {
            for line in (*start).max(1)..=*end {
                journey.innermost_at(&candidates, line, &mut innermost);
                chosen.extend(&innermost);
            }
        }
        chosen.sort_unstable();
        chosen.dedup();
        if settled {
            // Text between two declarations falls in the module's own region,
            // and the reading proved nothing there runs differently.
            chosen.retain(|block| journey.text(journey.kinds[*block]).map_or(true, |kind| kind != "module"));
        }
        let loaded = chosen.iter().any(|block| journey.loaded[*block] == 1);

        self.seen.fill(false);
        let mut sets = HashSet::new();
        for block in chosen {
            if sets.insert(journey.called[block]) {
                let members = journey.members(block)?;
                self.enter(&members);
            }
        }
        if loaded {
            match self.importers(file) {
                Some(tests) if !tests.is_empty() => self.entered.extend(tests),
                _ => self.every_entrant(module)?,
            }
        }
        Ok(None)
    }

    fn bumped(&mut self, name: &str, by_file: &HashMap<&str, usize>) -> Result<(), String> {
        let Some(files) = self.graph.as_ref().and_then(|graph| graph.package_importers(name)) else { return Ok(()) };
        for file in files {
            if let Some(test) = self.held.get(file).copied() {
                self.entered.insert(test);
            }
            if let Some(module) = by_file.get(file).copied() {
                self.every_entrant(module)?;
            }
        }
        Ok(())
    }
}

fn select(
    file: &str,
    changed: &[JourneyChange],
    graph: Option<&JourneyGraph>,
    packages: &[String],
) -> Result<JourneySelection, String> {
    let journey = Journey::open(file)?;
    let tests = journey.test_file_names()?;
    let by_file = journey.by_file()?;
    let mut selecting = Selecting {
        journey: &journey,
        held: tests.iter().copied().collect(),
        tests,
        graph: graph.map(Graph::new).transpose()?,
        entered: HashSet::new(),
        seen: vec![false; journey.tests()],
    };
    let mut unread = Vec::new();
    for change in changed {
        let ranges = pairs(&change.ranges);
        let module = by_file.get(change.file.as_str()).copied();
        if let Some(file) = selecting.change(&change.file, &ranges, module, change.read.as_deref())? {
            unread.push(file);
        }
    }
    for name in packages {
        selecting.bumped(name, &by_file)?;
    }
    Ok(JourneySelection {
        whole: selecting.held.iter().map(|test| (*test).to_owned()).collect(),
        entered: selecting.entered.iter().map(|test| (*test).to_owned()).collect(),
        unread,
    })
}

/// The test files `changed` needs, read off the journey file at `file` and,
/// when given, the file graph; `packages` are the names whose install moved.
/// Unsorted: the caller orders by code unit.
#[napi(catch_unwind)]
pub fn select_journeys(
    file: String,
    changed: Vec<JourneyChange>,
    graph: Option<JourneyGraph>,
    packages: Option<Vec<String>>,
) -> napi::Result<JourneySelection> {
    select(&file, &changed, graph.as_ref(), &packages.unwrap_or_default()).map_err(napi::Error::from_reason)
}
