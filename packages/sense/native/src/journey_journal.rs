use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use crate::case_preconditions::{self, Precondition};
use crate::order;

const MAGIC: [u8; 8] = [0x56, 0x41, 0x4a, 0x52, 0x4e, 0x00, 0x00, 0x02];
/// `VAEYS`: an Eyes frame rides beside the case frames (`eyes-frame.cts`) and
/// crosses nothing, so every fold steps over it.
const EYES_MAGIC: [u8; 8] = [0x56, 0x41, 0x45, 0x59, 0x53, 0x00, 0x00, 0x01];
/// A module is named by its path: tag `1`, then the path. Tag `0`, a numbered
/// module, is refused as damage — nothing writes one (ADR-0056, amended).
const NAMED: u8 = 1;

/// A module's repository-relative path.
pub type ModuleId = String;

#[derive(Clone)]
pub struct Test {
    pub id: String,
    pub file: String,
    pub name: String,
    /// How the case settled: [`UNSETTLED`], [`FINISHED`] or [`STOPPED`].
    pub settled: u8,
    /// What the case said it arranged, resolved; `None` where nobody listened.
    pub preconditions: Option<Vec<Precondition>>,
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
}

struct Coordinate {
    file: String,
    name: String,
    id: String,
    settled: u8,
    journey: String,
    said: Option<Vec<Precondition>>,
    frame: usize,
}

pub fn inspect(directory: &Path, root: &Path, parts: &[String]) -> Result<CaseRun, String> {
    let paths = listed(directory, None)?;
    let mut visitor = InspectVisitor {
        root,
        coordinates: Vec::new(),
        wanted: HashSet::new(),
        frame: 0,
    };
    replay(&paths, &mut visitor)?;
    visitor.coordinates.sort_by(|left, right| {
        order::code_unit(&left.file, &right.file)
            .then_with(|| order::code_unit(&left.name, &right.name))
            .then_with(|| order::code_unit(&left.id, &right.id))
    });

    let mut frame_tests = vec![0; visitor.coordinates.len()];
    let mut repeated: HashMap<String, u32> = HashMap::new();
    let mut journey_tests: HashMap<String, Vec<u32>> = HashMap::new();
    let mut tests = Vec::with_capacity(visitor.coordinates.len());
    for (at, coordinate) in visitor.coordinates.into_iter().enumerate() {
        frame_tests[coordinate.frame] = at as u32;
        if !coordinate.journey.is_empty() {
            journey_tests.entry(coordinate.journey).or_default().push(at as u32);
        }
        let name = format!("{} > {}", coordinate.file, coordinate.name);
        let repeat = repeated.entry(name.clone()).or_default();
        let id = if *repeat == 0 {
            name
        } else {
            format!("{name}#{repeat}")
        };
        *repeat += 1;
        tests.push(Test {
            id,
            file: coordinate.file,
            name: coordinate.name,
            settled: coordinate.settled,
            preconditions: coordinate.said.map(case_preconditions::resolve),
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
        wanted: visitor.wanted,
        tests_by_file,
        parts: part_paths,
        journey_tests,
        part_tests,
        part_wanted,
        unclaimed,
        heads,
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

    fn wants(&mut self, id: &ModuleId) -> bool {
        self.ran = true;
        self.wanted.insert(id.clone());
        false
    }

    fn module(&mut self, _: &ModuleId, _: &[u32], _: &[u32], _: &[u32]) {}
}

struct InspectVisitor<'a> {
    root: &'a Path,
    coordinates: Vec<Coordinate>,
    wanted: HashSet<ModuleId>,
    frame: usize,
}

impl Visitor for InspectVisitor<'_> {
    fn test(&mut self, packed: &str) -> Result<(), String> {
        let (file, name, id, settled) = unpack_case(packed);
        if !name.is_empty() || !id.is_empty() {
            self.coordinates.push(Coordinate {
                file: project_path(self.root, file),
                name: name.to_owned(),
                id: id.to_owned(),
                settled,
                journey: journey_of(packed).to_owned(),
                said: case_preconditions::said_of(packed)?.map(|said| case_preconditions::checkout(self.root, said)),
                frame: self.frame,
            });
            self.frame += 1;
        }
        Ok(())
    }

    fn wants(&mut self, id: &ModuleId) -> bool {
        self.wanted.insert(id.clone());
        false
    }

    fn module(&mut self, _: &ModuleId, _: &[u32], _: &[u32], _: &[u32]) {}
}

pub trait Visitor {
    fn test(&mut self, packed: &str) -> Result<(), String>;
    fn wants(&mut self, id: &ModuleId) -> bool;
    fn module(&mut self, id: &ModuleId, hits: &[u32], shared: &[u32], loaded: &[u32]);
}

pub fn replay(paths: &[PathBuf], visitor: &mut impl Visitor) -> Result<(), String> {
    for path in paths {
        let raw = fs::read(path).map_err(|error| error.to_string())?;
        frames(&raw, false, |frame| scan_journal(frame, visitor))?;
    }
    Ok(())
}

/// Read one part file. Its writer may have been killed mid-append, so a torn
/// last frame ends the file instead of failing the run.
pub fn replay_part(path: &Path, visitor: &mut impl Visitor) -> Result<(), String> {
    let raw = fs::read(path).map_err(|error| error.to_string())?;
    frames(&raw, true, |frame| scan_journal(frame, visitor))
}

fn frames(
    raw: &[u8],
    torn_tail: bool,
    mut visit: impl FnMut(&[u8]) -> Result<(), String>,
) -> Result<(), String> {
    let mut at = 0;
    while at < raw.len() {
        let torn = at + 4 > raw.len()
            || at + 4 + word(raw, at)? as usize > raw.len();
        if torn && torn_tail {
            return Ok(());
        }
        let length = word(raw, at)? as usize;
        let from = at + 4;
        let to = from.checked_add(length).ok_or_else(damaged_cases)?;
        if to > raw.len() {
            return Err(damaged_cases());
        }
        visit(&raw[from..to])?;
        at = to;
    }
    Ok(())
}

fn scan_journal(raw: &[u8], visitor: &mut impl Visitor) -> Result<(), String> {
    if raw.starts_with(&EYES_MAGIC) {
        return Ok(());
    }
    let mut read = Reader::new(raw);
    for expected in MAGIC {
        if read.byte()? != expected {
            return Err(damaged());
        }
    }
    visitor.test(&read.text()?)?;
    let count = read.number()?;
    let mut scratch = Vec::new();
    for _ in 0..count {
        if read.byte()? != NAMED {
            return Err(damaged());
        }
        let id = read.text()?;
        if !visitor.wants(&id) {
            read.skip()?;
            read.skip()?;
            read.skip()?;
            continue;
        }
        scratch.clear();
        let mut starts = [0; 3];
        for start in &mut starts {
            *start = scratch.len();
            read.ordinals(&mut scratch)?;
        }
        visitor.module(
            &id,
            &scratch[starts[0]..starts[1]],
            &scratch[starts[1]..starts[2]],
            &scratch[starts[2]..],
        );
    }
    if read.at != raw.len() {
        return Err(damaged());
    }
    Ok(())
}

struct Reader<'a> {
    raw: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn new(raw: &'a [u8]) -> Self {
        Self { raw, at: 0 }
    }

    fn byte(&mut self) -> Result<u8, String> {
        let value = self.raw.get(self.at).copied().ok_or_else(damaged)?;
        self.at += 1;
        Ok(value)
    }

    fn number(&mut self) -> Result<u32, String> {
        let mut value = 0_u32;
        let mut shift = 0;
        loop {
            let byte = self.byte()?;
            value = value
                .checked_add(((byte & 0x7f) as u32) << shift)
                .ok_or_else(damaged)?;
            if byte & 0x80 == 0 {
                return Ok(value);
            }
            shift += 7;
            if shift > 28 {
                return Err(damaged());
            }
        }
    }

    fn text(&mut self) -> Result<String, String> {
        let length = self.number()? as usize;
        let end = self.at.checked_add(length).ok_or_else(damaged)?;
        let value = std::str::from_utf8(self.raw.get(self.at..end).ok_or_else(damaged)?)
            .map_err(|_| damaged())?
            .to_owned();
        self.at = end;
        Ok(value)
    }

    fn skip(&mut self) -> Result<(), String> {
        let mut count = self.number()?;
        while count > 0 {
            if self.byte()? & 0x80 == 0 {
                count -= 1;
            }
        }
        Ok(())
    }

    fn ordinals(&mut self, out: &mut Vec<u32>) -> Result<(), String> {
        let count = self.number()?;
        let mut last = 0_u32;
        for _ in 0..count {
            last = last.checked_add(self.number()?).ok_or_else(damaged)?;
            out.push(last);
        }
        Ok(())
    }
}

/// A case frame's name: `packCase` and `settledCase` in `journal-format.cts`.
pub fn unpack_case(packed: &str) -> (&str, &str, &str, u8) {
    let mut parts = packed.split('\0');
    (
        parts.next().unwrap_or(packed),
        parts.next().unwrap_or(""),
        parts.next().unwrap_or(""),
        match parts.next() {
            Some("stopped") => STOPPED,
            Some("finished") => FINISHED,
            _ => UNSETTLED,
        },
    )
}

/// The journey a frame belongs to: the fifth field of its owner, after the
/// settling, empty when the case never handed one out. `packJourney` in
/// `journal-format.cts`. A sixth field, what the case said it arranged, is
/// [`case_preconditions::said_of`]'s.
pub fn journey_of(packed: &str) -> &str {
    packed.split('\0').nth(4).unwrap_or("")
}

pub fn project_path(root: &Path, file: &str) -> String {
    let path = Path::new(file);
    let relative = path.strip_prefix(root).unwrap_or(path);
    relative
        .components()
        .map(|part| part.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn word(raw: &[u8], at: usize) -> Result<u32, String> {
    let bytes: [u8; 4] = raw
        .get(at..at + 4)
        .ok_or_else(damaged_cases)?
        .try_into()
        .map_err(|_| damaged_cases())?;
    Ok(u32::from_le_bytes(bytes))
}

fn damaged() -> String {
    "not a variance-authority journal".to_owned()
}

fn damaged_cases() -> String {
    "not a variance-authority case journal".to_owned()
}
