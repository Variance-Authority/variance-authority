use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use rayon::prelude::*;

use crate::case_id::{self, CaseIds};
use crate::case_owner::{self, journey_of, project_of, project_path, unpack_case};
use crate::case_said::{self, Heard};
use crate::case_times;
use crate::journal_scan::{self, replay, replay_part, Visitor};
use crate::order;

/// A module's repository-relative path.
pub type ModuleId = String;

#[derive(Clone)]
pub struct Test {
    pub id: String,
    pub file: String,
    pub name: String,
    /// The project that ran the case; `None` when the run named none.
    pub project: Option<String>,
    /// The id its runner gave the case, which tells two of one name apart; `None` from a shard written before it was carried.
    pub runner: Option<String>,
    /// How the case settled: [`UNSETTLED`], [`FINISHED`] or [`STOPPED`].
    pub settled: u8,
    /// Everything the case said it arranged and the code read, unresolved;
    /// `None` where nobody listened.
    pub heard: Option<Heard>,
}

/// The `tests.stopped` column's three states, as `execution-set-format.ts`
/// spells them: a producer that cannot see a case settle says nothing.
pub const UNSETTLED: u8 = 0;
pub const FINISHED: u8 = 1;
pub const STOPPED: u8 = 2;

/// One case's settling across two frames or shards: one attempt that finished
/// is a whole journey, so it stopped only when every attempt that spoke stopped.
pub fn settled_across(first: u8, second: u8) -> u8 {
    if first == FINISHED || second == FINISHED {
        FINISHED
    } else if first == STOPPED || second == STOPPED {
        STOPPED
    } else {
        UNSETTLED
    }
}

pub struct CaseRun {
    pub root: PathBuf,
    pub paths: Vec<PathBuf>,
    pub tests: Vec<Test>,
    pub frame_tests: Vec<u32>,
    /// The first of `frame_tests` each of `paths` writes, so one journal can be
    /// replayed apart from the others.
    pub path_frames: Vec<usize>,
    pub wanted: HashSet<ModuleId>,
    pub tests_by_file: HashMap<String, (u32, u32)>,
    /// Frames written beyond a fence, one file per writer, read after the run.
    pub parts: Vec<PathBuf>,
    /// The cases that handed out each journey id.
    pub journey_tests: HashMap<String, Vec<u32>>,
    /// Per part file, every case one of its journeys belongs to: what that
    /// writer ran outside any journey is charged to all of them.
    pub part_tests: Vec<Vec<u32>>,
    /// The modules parts name, looked up by path in any store.
    pub part_wanted: HashSet<ModuleId>,
    /// The part files that ran code under no journey a case handed out, by
    /// file name: what they ran is charged to nobody.
    pub unclaimed: Vec<String>,
    /// The heads that wrote a part file, by the label its name opens with.
    pub heads: Vec<String>,
    /// What a record's case index keeps beyond a journey artifact, read only
    /// by [`inspect_cases`].
    pub detail: Option<CaseDetail>,
}

/// Per case, by test row: what a record's case index carries that a journey
/// artifact does not.
pub struct CaseDetail {
    /// The limit its frames ran under, by `limitAcross`: `NaN` where a frame's
    /// limit was no number.
    pub limits: Vec<Option<f64>>,
    /// Its statement times, as `case_times` lays a row, by [`case_times::across`].
    pub times: Vec<Vec<u8>>,
    /// Which cases carry lines, by `linedCases`; `None` where none does.
    pub lined: Option<Vec<bool>>,
    /// The cases that watched through Eyes, in the order they first did, each
    /// with the attempts and journal text it handed over.
    pub looked: Vec<(u32, Vec<(f64, String)>)>,
}

/// What [`CaseDetail`] gathers of one case before the cases are ordered.
#[derive(Default)]
struct Detail {
    limit: Option<f64>,
    times: Vec<u8>,
    /// Whether a module row of the case's own frames was cut at its statements.
    cut: bool,
    /// Whether one was not: a case a helper outside its file declared runs uncut.
    uncut: bool,
    /// Where in `looked` what Eyes handed it is held.
    looked: Option<usize>,
}

/// `limitAcross`: a limit of 0 is no limit at all and wins; otherwise the longer.
pub(crate) fn limit_across(first: Option<f64>, second: Option<f64>) -> Option<f64> {
    if first.is_none() && second.is_none() {
        return None;
    }
    if first == Some(0.0) || second == Some(0.0) {
        return Some(0.0);
    }
    let (first, second) = (first.unwrap_or(0.0), second.unwrap_or(0.0));
    Some(if first.is_nan() || second.is_nan() { f64::NAN } else { first.max(second) })
}

/// One case, over every frame written under its file, name, id and project.
struct Coordinate {
    file: String,
    name: String,
    id: String,
    project: Option<String>,
    /// How the case settled across its frames, by [`settled_across`].
    settled: u8,
    /// Every journey a frame of the case handed out, in replay order.
    journeys: Vec<String>,
    /// What the case heard across its frames, by [`case_said::join`].
    heard: Option<Heard>,
    /// Every frame written under this coordinate, in replay order.
    frames: Vec<usize>,
    detail: Detail,
}

pub fn inspect(directory: &Path, root: &Path, parts: &[String]) -> Result<CaseRun, String> {
    inspect_with(directory, root, parts, false)
}

/// The run's cases as a record's case index lays them: [`inspect`], and each
/// case's [`CaseDetail`], with every case that watched through Eyes a case
/// whether or not it crossed anything.
pub fn inspect_cases(directory: &Path, root: &Path) -> Result<CaseRun, String> {
    inspect_with(directory, root, &[], true)
}

// FIXME: `detailed` also decides which cases exist: an Eyes-only case is in the case index and not in the journey artifact, and part files are in the artifact and not in the case index.
fn inspect_with(directory: &Path, root: &Path, parts: &[String], detailed: bool) -> Result<CaseRun, String> {
    let paths = listed(directory, None)?;
    // Each journal is read on its own core, and taken in the order one replay
    // would have read them: every case's answer across its frames is the same
    // whichever frames it meets first.
    let journals = paths
        .par_iter()
        .map(|path| {
            let mut visitor = InspectVisitor::new(root, detailed);
            replay(std::slice::from_ref(path), &mut visitor)?;
            Ok(visitor)
        })
        .collect::<Result<Vec<_>, String>>()?;
    let mut visitor = InspectVisitor::new(root, detailed);
    let mut path_frames = Vec::with_capacity(paths.len());
    for journal in journals {
        path_frames.push(visitor.frame);
        visitor.absorb(journal)?;
    }
    let mut order: Vec<usize> = (0..visitor.coordinates.len()).collect();
    let coordinates = &visitor.coordinates;
    order.sort_by(|&left, &right| {
        let (left, right) = (&coordinates[left], &coordinates[right]);
        case_id::order(
            (&left.file, &left.name, left.project.as_deref(), &left.id),
            (&right.file, &right.name, right.project.as_deref(), &right.id),
        )
    });
    let mut row_of = vec![0_u32; order.len()];
    for (row, &held) in order.iter().enumerate() {
        row_of[held] = row as u32;
    }
    let mut held: Vec<Option<Coordinate>> = visitor.coordinates.into_iter().map(Some).collect();
    let ordered: Vec<Coordinate> = order.iter().map(|&at| held[at].take().expect("each coordinate is ordered once")).collect();
    let mut detail = detailed.then(|| {
        let lined: Vec<bool> = ordered
            .iter()
            .map(|coordinate| coordinate.detail.cut || (!coordinate.detail.uncut && visitor.cut_files.contains(&coordinate.file)))
            .collect();
        CaseDetail {
            limits: Vec::with_capacity(ordered.len()),
            times: Vec::with_capacity(ordered.len()),
            lined: lined.contains(&true).then_some(lined),
            looked: visitor.looked.into_iter().map(|(at, rows)| (row_of[at], rows)).collect(),
        }
    });

    let mut frame_tests = vec![0; visitor.frame];
    let mut ids = CaseIds::default();
    let mut journey_tests: HashMap<String, Vec<u32>> = HashMap::new();
    let mut tests = Vec::with_capacity(ordered.len());
    for (at, coordinate) in ordered.into_iter().enumerate() {
        if let Some(detail) = detail.as_mut() {
            detail.limits.push(coordinate.detail.limit);
            detail.times.push(coordinate.detail.times);
        }
        for frame in coordinate.frames {
            frame_tests[frame] = at as u32;
        }
        for journey in coordinate.journeys {
            journey_tests.entry(journey).or_default().push(at as u32);
        }
        tests.push(Test {
            id: ids.next(&coordinate.file, &coordinate.name, coordinate.project.as_deref())?,
            file: coordinate.file,
            name: coordinate.name,
            project: coordinate.project,
            runner: Some(coordinate.id),
            settled: coordinate.settled,
            heard: coordinate.heard,
        });
    }
    let mut tests_by_file = HashMap::new();
    let mut first = 0;
    while first < tests.len() {
        let mut last = first + 1;
        while last < tests.len() && tests[last].file == tests[first].file {
            last += 1;
        }
        tests_by_file.insert(tests[first].file.clone(), (first as u32, last as u32));
        first = last;
    }

    let mut part_paths = Vec::new();
    for directory in parts {
        part_paths.extend(listed(Path::new(directory), Some("vac"))?);
    }
    let mut part_tests = Vec::with_capacity(part_paths.len());
    let mut part_wanted = HashSet::new();
    let mut unclaimed = Vec::new();
    let mut heads: Vec<String> = part_paths.iter().map(|path| head_of(path)).collect();
    heads.sort_unstable_by(|left, right| order::code_unit(left, right));
    heads.dedup();
    for path in &part_paths {
        let mut visitor = PartInspectVisitor {
            journeys: HashSet::new(),
            wanted: &mut part_wanted,
            ran: false,
        };
        replay_part(path, &mut visitor)?;
        let ran = visitor.ran;
        let mut claimed: Vec<u32> = visitor
            .journeys
            .iter()
            .filter_map(|journey| journey_tests.get(journey))
            .flatten()
            .copied()
            .collect();
        claimed.sort_unstable();
        claimed.dedup();
        if claimed.is_empty() && ran {
            unclaimed.push(path.file_name().map_or_else(|| path.to_string_lossy(), |name| name.to_string_lossy()).into_owned());
        }
        part_tests.push(claimed);
    }
    Ok(CaseRun {
        root: root.to_path_buf(),
        paths,
        tests,
        frame_tests,
        path_frames,
        wanted: visitor.wanted,
        tests_by_file,
        parts: part_paths,
        journey_tests,
        part_tests,
        part_wanted,
        unclaimed,
        heads,
        detail,
    })
}

/// The head a part file came from: its name without the `-<uuid>.vac` every
/// writer appends, which is what makes two processes' files distinct.
fn head_of(path: &Path) -> String {
    let stem = path.file_stem().map_or_else(|| path.to_string_lossy(), |stem| stem.to_string_lossy());
    let at = stem.len().saturating_sub(37);
    match (stem.get(..at), stem.get(at..)) {
        (Some(head), Some(tail)) if tail.starts_with('-') && is_uuid(&tail[1..]) => head.to_owned(),
        _ => stem.into_owned(),
    }
}

fn is_uuid(text: &str) -> bool {
    text.len() == 36
        && text.char_indices().all(|(at, character)| match at {
            8 | 13 | 18 | 23 => character == '-',
            _ => character.is_ascii_hexdigit(),
        })
}

fn listed(directory: &Path, extension: Option<&str>) -> Result<Vec<PathBuf>, String> {
    let mut paths: Vec<PathBuf> = match fs::read_dir(directory) {
        Ok(entries) => entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                extension.is_none_or(|wanted| path.extension().and_then(|value| value.to_str()) == Some(wanted))
            })
            .collect(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(error) => return Err(error.to_string()),
    };
    paths.sort_unstable_by(|left, right| {
        order::code_unit(&left.to_string_lossy(), &right.to_string_lossy())
    });
    Ok(paths)
}

struct PartInspectVisitor<'a> {
    journeys: HashSet<String>,
    wanted: &'a mut HashSet<ModuleId>,
    /// Whether any frame named a module.
    ran: bool,
}

impl Visitor for PartInspectVisitor<'_> {
    fn test(&mut self, packed: &str) -> Result<(), String> {
        let journey = journey_of(packed);
        if !journey.is_empty() {
            self.journeys.insert(journey.to_owned());
        }
        Ok(())
    }

    fn wants(&mut self, id: &ModuleId, _cut: bool) -> bool {
        self.ran = true;
        self.wanted.insert(id.clone());
        false
    }

    fn module(&mut self, _: &ModuleId, _: &[u32], _: &[u32], _: &[u32], _: Option<&[u32]>) {}
}

struct InspectVisitor<'a> {
    root: &'a Path,
    coordinates: Vec<Coordinate>,
    /// Where each case's coordinate is held, by file, name, id and project.
    at: HashMap<(String, String, String, Option<String>), usize>,
    wanted: HashSet<ModuleId>,
    frame: usize,
    /// Whether the run is read for a record's case index: [`CaseDetail`].
    detailed: bool,
    /// The frame being stepped through, for what its rows say of their cut.
    scanning: Scanning,
    /// The test files a frame was cut in.
    cut_files: HashSet<String>,
    /// What Eyes handed each case, by coordinate, in the order it arrived.
    looked: Vec<(usize, Vec<(f64, String)>)>,
}

enum Scanning {
    Nothing,
    Case(usize),
    Ambient(String),
}

type Key = (String, String, String, Option<String>);

impl<'a> InspectVisitor<'a> {
    fn new(root: &'a Path, detailed: bool) -> Self {
        InspectVisitor {
            root,
            coordinates: Vec::new(),
            at: HashMap::new(),
            wanted: HashSet::new(),
            frame: 0,
            detailed,
            scanning: Scanning::Nothing,
            cut_files: HashSet::new(),
            looked: Vec::new(),
        }
    }

    /// Take in what a later journal said, as though its frames had been read here.
    fn absorb(&mut self, later: InspectVisitor<'_>) -> Result<(), String> {
        let offset = self.frame;
        let mut moved = Vec::with_capacity(later.coordinates.len());
        for coordinate in later.coordinates {
            let key = (coordinate.file, coordinate.name, coordinate.id, coordinate.project);
            let (at, was_held) = self.held(key, coordinate.settled);
            let held = &mut self.coordinates[at];
            held.frames.extend(coordinate.frames.iter().map(|frame| frame + offset));
            if was_held {
                held.settled = settled_across(held.settled, coordinate.settled);
                held.heard = case_said::join(held.heard.take(), coordinate.heard);
                for journey in coordinate.journeys {
                    if !held.journeys.contains(&journey) {
                        held.journeys.push(journey);
                    }
                }
                let detail = &mut held.detail;
                detail.limit = limit_across(detail.limit, coordinate.detail.limit);
                detail.times = case_times::across(&detail.times, &coordinate.detail.times)?.to_vec();
                detail.cut |= coordinate.detail.cut;
                detail.uncut |= coordinate.detail.uncut;
            } else {
                held.heard = coordinate.heard;
                held.journeys = coordinate.journeys;
                held.detail = Detail { looked: None, ..coordinate.detail };
            }
            moved.push(at);
        }
        for (at, rows) in later.looked {
            let at = moved[at];
            let row = *self.coordinates[at].detail.looked.get_or_insert_with(|| {
                self.looked.push((at, Vec::new()));
                self.looked.len() - 1
            });
            self.looked[row].1.extend(rows);
        }
        self.wanted.extend(later.wanted);
        self.cut_files.extend(later.cut_files);
        self.frame += later.frame;
        Ok(())
    }

    /// The coordinate `key` names, held from here on.
    fn held(&mut self, key: Key, settled: u8) -> (usize, bool) {
        if let Some(&held) = self.at.get(&key) {
            return (held, true);
        }
        let at = self.coordinates.len();
        self.at.insert(key.clone(), at);
        let (file, name, id, project) = key;
        self.coordinates.push(Coordinate {
            file, name, id, project, settled,
            journeys: Vec::new(),
            heard: None,
            frames: Vec::new(),
            detail: Detail::default(),
        });
        (at, false)
    }
}

impl Visitor for InspectVisitor<'_> {
    fn test(&mut self, packed: &str) -> Result<(), String> {
        let (file, name, id, settled) = unpack_case(packed);
        if name.is_empty() && id.is_empty() {
            self.scanning = Scanning::Ambient(project_path(self.root, file));
            return Ok(());
        }
        // A case is written when it settles, so work that outlived it
        // arrives as a second frame under the same coordinate: one case.
        let heard = case_said::of_frame(packed)?.map(|heard| case_said::heard(self.root, heard));
        let journey = journey_of(packed);
        let key = (project_path(self.root, file), name.to_owned(), id.to_owned(), project_of(packed).map(str::to_owned));
        let (at, was_held) = self.held(key, settled);
        let detailed = self.detailed;
        let coordinate = &mut self.coordinates[at];
        coordinate.frames.push(self.frame);
        if was_held {
            coordinate.settled = settled_across(coordinate.settled, settled);
        }
        coordinate.heard = case_said::join(coordinate.heard.take(), heard);
        if !journey.is_empty() && !coordinate.journeys.iter().any(|known| known == journey) {
            coordinate.journeys.push(journey.to_owned());
        }
        if detailed {
            let detail = &mut coordinate.detail;
            detail.limit = limit_across(detail.limit, case_owner::limit_of(packed));
            let times = case_owner::times_of(packed)?;
            detail.times = case_times::across(&detail.times, &times)?.to_vec();
        }
        self.scanning = Scanning::Case(at);
        self.frame += 1;
        Ok(())
    }

    fn eyes(&mut self, frame: &[u8]) -> Result<(), String> {
        if !self.detailed {
            return Ok(());
        }
        // A case that watched is a case, whether or not it crossed anything.
        let (packed, attempt, journal) = journal_scan::eyes_of(frame)?;
        let (file, name, id, _) = unpack_case(&packed);
        let key = (project_path(self.root, file), name.to_owned(), id.to_owned(), project_of(&packed).map(str::to_owned));
        let (at, _) = self.held(key, UNSETTLED);
        let row = *self.coordinates[at].detail.looked.get_or_insert_with(|| {
            self.looked.push((at, Vec::new()));
            self.looked.len() - 1
        });
        if let Some(journal) = journal {
            self.looked[row].1.push((attempt, journal));
        }
        Ok(())
    }

    fn wants(&mut self, id: &ModuleId, cut: bool) -> bool {
        self.wanted.insert(id.clone());
        if self.detailed {
            match &self.scanning {
                Scanning::Case(at) => {
                    let detail = &mut self.coordinates[*at].detail;
                    if cut {
                        detail.cut = true;
                        self.cut_files.insert(self.coordinates[*at].file.clone());
                    } else {
                        detail.uncut = true;
                    }
                }
                Scanning::Ambient(file) if cut => {
                    self.cut_files.insert(file.clone());
                }
                _ => {}
            }
        }
        false
    }

    fn module(&mut self, _: &ModuleId, _: &[u32], _: &[u32], _: &[u32], _: Option<&[u32]>) {}
}
