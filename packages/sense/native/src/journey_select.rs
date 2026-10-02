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
//! A bumped package arrives as the files that import it, changed whole
//! (`beyondReach`), and is answered as they are. A suite that declines relations
//! asks the graph nothing about a file with no row: a test file still selects
//! itself, and any other is `declined` (`test-selection/route.ts`).
//!
//! Only the regions a change lands on have their sets expanded, and each test is
//! looked at once per module, so the cost follows the change and not the day of
//! shards the file holds.

use std::collections::HashSet;

use napi_derive::napi;

use crate::journey_graph::{Graph, JourneyGraph};
use crate::journey_query::JourneyChange;
use crate::journey_read::{innermost_at, overlaps, pairs, Journey, Region};

#[napi(object)]
pub struct JourneySelection {
    /// Every test file the journey holds a case of.
    pub whole: Vec<String>,
    /// The test files the change needs.
    pub entered: Vec<String>,
    /// Changed paths neither the record nor the graph knows.
    pub unread: Vec<String>,
    /// Changed paths with no row, in a suite that declines relations; empty otherwise.
    pub declined: Vec<String>,
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
        let regions = self.journey.regions(module)?;
        self.enter_sets(&regions)
    }

    /// Enter the tests of every set `regions` point at, each set once.
    fn enter_sets(&mut self, regions: &[Region]) -> Result<(), String> {
        let journey = self.journey;
        self.seen.fill(false);
        let mut sets = HashSet::new();
        for region in regions {
            if sets.insert(region.called) {
                let members = journey.members(region.called)?;
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
        let candidates: Vec<Region> =
            journey.regions(module)?.into_iter().filter(|region| overlaps(region, ranges)).collect();
        let mut chosen: Vec<Region> = Vec::new();
        let mut innermost = Vec::new();
        for (start, end) in ranges {
            for line in (*start).max(1)..=*end {
                innermost_at(&candidates, line, &mut innermost);
                chosen.extend(&innermost);
            }
        }
        chosen.sort_unstable_by_key(|region| region.at);
        chosen.dedup_by_key(|region| region.at);
        if settled {
            // Text between two declarations falls in the module's own region,
            // and the reading proved nothing there runs differently.
            chosen.retain(|region| journey.text(region.kind).map_or(true, |kind| kind != "module"));
        }
        let loaded = chosen.iter().any(|region| region.loaded);
        self.enter_sets(&chosen)?;
        if loaded {
            match self.importers(file) {
                Some(tests) if !tests.is_empty() => self.entered.extend(tests),
                _ => self.every_entrant(module)?,
            }
        }
        Ok(None)
    }
}

fn select(
    file: &str,
    changed: &[JourneyChange],
    graph: Option<&JourneyGraph>,
    declines: bool,
) -> Result<JourneySelection, String> {
    let journey = Journey::open(file)?;
    let tests = journey.test_file_names()?;
    let mut selecting = Selecting {
        journey: &journey,
        held: tests.iter().copied().collect(),
        tests,
        graph: graph.map(Graph::new).transpose()?,
        entered: HashSet::new(),
        seen: vec![false; journey.tests()],
    };
    let mut unread = Vec::new();
    let mut declined = Vec::new();
    for change in changed {
        let ranges = pairs(&change.ranges);
        let module = journey.module_of(&change.file)?;
        if module.is_none() && declines {
            // A test file the record holds a case of selects itself, which is
            // all the record says of a file it has no row for.
            match selecting.held.get(change.file.as_str()).copied() {
                Some(test) => {
                    selecting.entered.insert(test);
                }
                None => declined.push(change.file.clone()),
            }
            continue;
        }
        if let Some(file) = selecting.change(&change.file, &ranges, module, change.read.as_deref())? {
            unread.push(file);
        }
    }
    Ok(JourneySelection {
        whole: selecting.held.iter().map(|test| (*test).to_owned()).collect(),
        entered: selecting.entered.iter().map(|test| (*test).to_owned()).collect(),
        unread,
        declined,
    })
}

/// The test files `changed` needs, read off the journey file at `file` and,
/// when given, the file graph. `declines` is a suite that asks the graph
/// nothing about a file with no row. Unsorted: the caller orders by code unit.
#[napi(catch_unwind)]
pub fn select_journeys(
    file: String,
    changed: Vec<JourneyChange>,
    graph: Option<JourneyGraph>,
    declines: Option<bool>,
) -> napi::Result<JourneySelection> {
    select(&file, &changed, graph.as_ref(), declines == Some(true)).map_err(napi::Error::from_reason)
}
