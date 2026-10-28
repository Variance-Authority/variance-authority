//! One record read whole for a fold: its coverage columns as they are stored,
//! every id checked against the column it names before a fold addresses it,
//! and its case parts as bytes. Nothing is turned into objects; a string is a
//! slice of the record's own dictionary.
//!
//! The layouts read are the current one, the ones before `tests.phases` and
//! before the case parts, which read as a run whose runner reported no phases,
//! and the one before `tests.duration`, which the JVM agent writes and which
//! reads as a run whose runner reported no durations. Every shard of a combine was written by one build, so a record
//! at any other version is refused by its version.

use crate::journey_columns::{self, Decoded};
use crate::record_layout::LAYOUT;

/// How many phases a test file holds a word each of: `phaseNames` in `record-layout.json`.
pub(crate) const PHASES: usize = 5;

/// A test file's phases, `coverage.no_duration` for one its runner did not report.
pub(crate) type Phases = [u32; PHASES];

pub(crate) struct Coverage {
    blob: Vec<u8>,
    offsets: Vec<u32>,
    pub instrumentation: u32,
    pub commit: Option<u32>,
    pub test_path: Vec<u32>,
    pub test_complete: Vec<u8>,
    pub test_preconditions: Vec<u32>,
    /// `None` for the untimed layout, which holds no durations.
    pub test_duration: Option<Vec<u32>>,
    /// `PHASES` words a test; `None` for a layout before `tests.phases`.
    pub test_phases: Option<Vec<u32>>,
    pub precondition_name: Vec<u32>,
    pub precondition_digest: Vec<u32>,
    pub module_path: Vec<u32>,
    pub module_source: Vec<u32>,
    pub module_instrumented: Vec<u8>,
    pub module_blocks: Vec<u32>,
    pub block_ordinal: Vec<u32>,
    pub block_kind: Vec<u8>,
    pub block_owner: Vec<u32>,
    pub block_digest: Vec<u32>,
    pub block_name: Vec<u32>,
    pub block_path: Vec<u32>,
    pub block_start: Vec<u32>,
    pub block_end: Vec<u32>,
    pub block_source: Vec<u8>,
    pub block_set: Vec<u32>,
    pub block_loaded_set: Vec<u32>,
    pub set_bytes: Vec<u8>,
    pub set_offsets: Vec<u32>,
}

/// The case parts a record holds, each as its bytes, `None` where it holds none.
#[derive(Default)]
pub(crate) struct Parts {
    pub index: Option<Vec<u8>>,
    pub before: Option<Vec<u8>>,
    pub last: Option<Vec<u8>>,
    pub eyes: Option<Vec<u8>>,
    /// The record the run started from (`record_start::base`).
    pub base: Option<Vec<u8>>,
}

pub(crate) struct Record {
    /// `None` for a record whose run instrumented nothing: it holds cases and no coverage.
    pub coverage: Option<Coverage>,
    pub parts: Parts,
}

/// `bytes` read as a record, refused with the reason when it is not one this
/// build reads.
pub(crate) fn read(bytes: &[u8]) -> Result<Record, String> {
    let (version, mut decoded) = journey_columns::decode_any(bytes)?;
    let layout = &LAYOUT.coverage;
    readable(version)?;
    let names = decoded.names();
    if let Some(unknown) = names.iter().find(|name| !layout.sections.contains(name) && !layout.parts.iter().any(|(_, part)| part == **name)) {
        return Err(format!("the record holds a section this build does not know: {unknown}"));
    }
    let mut part = |part: &str| -> Result<Option<Vec<u8>>, String> {
        let name = layout.part(part);
        if !decoded.has(name) {
            return Ok(None);
        }
        decoded.take_bytes(name).map(Some)
    };
    let parts = Parts { index: part("index")?, before: part("before")?, last: part("last")?, eyes: part("eyes")?, base: part("base")? };
    let coverage = if layout.sections.iter().any(|name| decoded.has(name)) { Some(coverage(decoded, version)?) } else { None };
    Ok(Record { coverage, parts })
}

/// Refuses a record version this build does not read.
fn readable(version: u8) -> Result<(), String> {
    let layout = &LAYOUT.coverage;
    if layout.readable(version) {
        return Ok(());
    }
    Err(format!("unsupported record version: {version}; this build reads versions {}, {}, {} and {}", layout.untimed, layout.uncased, layout.unphased, layout.format))
}

/// The test files a record's coverage holds, read off its header alone: the
/// first `bytes` of a record `length` bytes long. A fold sizes its sets by it
/// before it decodes a record.
pub(crate) fn tests_in(bytes: &[u8], length: usize) -> Result<Head, String> {
    let (version, placed) = journey_columns::framed_within(bytes, length)?;
    readable(version)?;
    let tests = placed.iter().find(|column| column.name == "tests.path").map_or(0, |column| column.rows.unwrap_or(column.stored.len() / 4));
    let based = placed.iter().any(|column| column.name == LAYOUT.coverage.part("base"));
    Ok(Head { tests, based })
}

/// What a record's header says before its sections are read.
pub(crate) struct Head {
    /// How many test files it holds.
    pub tests: usize,
    /// Whether it names the record its run started from, as every run after 0.15.0 does.
    pub based: bool,
}

fn coverage(mut decoded: Decoded, version: u8) -> Result<Coverage, String> {
    let decoded = &mut decoded;
    let timed = version != LAYOUT.coverage.untimed;
    let phased = version == LAYOUT.coverage.format;
    let one = |name: &str, values: Vec<u32>, empty: bool| -> Result<Option<u32>, String> {
        match values.as_slice() {
            [value] => Ok(Some(*value)),
            [] if empty => Ok(None),
            _ => Err(format!("record section {name} holds {} values, not one", values.len())),
        }
    };
    let coverage = Coverage {
        blob: decoded.take_bytes("strings.blob")?,
        offsets: decoded.take_words("strings.off")?,
        instrumentation: one("snapshot.instrumentation", decoded.take_words("snapshot.instrumentation")?, false)?.unwrap_or_default(),
        commit: one("snapshot.commit", decoded.take_words("snapshot.commit")?, true)?,
        test_path: decoded.take_words("tests.path")?,
        test_complete: decoded.take_bytes("tests.complete")?,
        test_preconditions: decoded.take_words("tests.preconditions")?,
        test_duration: if timed { Some(decoded.take_words(&LAYOUT.coverage.duration)?) } else { None },
        test_phases: if phased { Some(decoded.take_words(&LAYOUT.coverage.phases)?) } else { None },
        precondition_name: decoded.take_words("preconditions.name")?,
        precondition_digest: decoded.take_words("preconditions.digest")?,
        module_path: decoded.take_words("modules.path")?,
        module_source: decoded.take_words("modules.source")?,
        module_instrumented: decoded.take_bytes("modules.instrumented")?,
        module_blocks: decoded.take_words("modules.blocks")?,
        block_ordinal: decoded.take_words("blocks.ordinal")?,
        block_kind: decoded.take_bytes("blocks.kind")?,
        block_owner: decoded.take_words("blocks.owner")?,
        block_digest: decoded.take_words("blocks.digest")?,
        block_name: decoded.take_words("blocks.name")?,
        block_path: decoded.take_words("blocks.path")?,
        block_start: decoded.take_words("blocks.start")?,
        block_end: decoded.take_words("blocks.end")?,
        block_source: decoded.take_bytes("blocks.source")?,
        block_set: decoded.take_words("blocks.set")?,
        block_loaded_set: decoded.take_words("blocks.loadedSet")?,
        set_bytes: decoded.take_bytes("sets.blob")?,
        set_offsets: decoded.take_words("sets.off")?,
    };
    coverage.checked()?;
    Ok(coverage)
}

/// A record's dictionary, kept once the rest of its coverage is let go.
pub(crate) struct Strings {
    blob: Vec<u8>,
    offsets: Vec<u32>,
}

impl Strings {
    pub fn text(&self) -> Result<Text<'_>, String> {
        text_of(&self.blob, &self.offsets)
    }
}

fn text_of<'a>(blob: &'a [u8], offsets: &'a [u32]) -> Result<Text<'a>, String> {
    let text = std::str::from_utf8(blob).map_err(|_| "a record string is not UTF-8".to_owned())?;
    if !offsets.iter().all(|at| text.is_char_boundary(*at as usize)) {
        return Err("a record string is not UTF-8".to_owned());
    }
    Ok(Text { text, offsets })
}

/// A record's dictionary as it lies in the record, string `id` at [`Text::at`].
#[derive(Clone, Copy)]
pub(crate) struct Text<'a> {
    text: &'a str,
    offsets: &'a [u32],
}

impl<'a> Text<'a> {
    /// A dictionary laid out as a record holds one, for a test to read.
    #[cfg(test)]
    pub fn laid_out(text: &'a str, offsets: &'a [u32]) -> Self {
        Text { text, offsets }
    }

    pub fn at(&self, id: u32) -> &'a str {
        &self.text[self.offsets[id as usize] as usize..self.offsets[id as usize + 1] as usize]
    }

    pub fn len(&self) -> usize {
        self.offsets.len().saturating_sub(1)
    }
}

impl Coverage {
    pub fn tests(&self) -> usize {
        self.test_path.len()
    }

    pub fn modules(&self) -> usize {
        self.module_path.len()
    }

    /// The dictionary, read in place: checked as UTF-8 once, a string a slice.
    pub fn text(&self) -> Result<Text<'_>, String> {
        text_of(&self.blob, &self.offsets)
    }

    /// The dictionary alone, every other column let go.
    pub fn into_strings(self) -> Strings {
        Strings { blob: self.blob, offsets: self.offsets }
    }

    /// The dictionary, one slice a string, each checked as UTF-8 once.
    pub fn strings(&self) -> Result<Vec<&str>, String> {
        self.offsets
            .windows(2)
            .map(|bounds| {
                std::str::from_utf8(&self.blob[bounds[0] as usize..bounds[1] as usize])
                    .map_err(|_| "a record string is not UTF-8".to_owned())
            })
            .collect()
    }

    /// The blocks of module `module`, as a range of block rows.
    pub fn blocks(&self, module: usize) -> std::ops::Range<usize> {
        self.module_blocks[module] as usize..self.module_blocks[module + 1] as usize
    }

    /// The duration of test `test`, `coverage.no_duration` where none was reported.
    pub fn duration(&self, test: usize) -> u32 {
        self.test_duration.as_ref().map_or(LAYOUT.coverage.no_duration, |duration| duration[test])
    }

    /// The phases of test `test`; each `coverage.no_duration` where none was reported.
    pub fn phases(&self, test: usize) -> Phases {
        let mut held = [LAYOUT.coverage.no_duration; PHASES];
        if let Some(phases) = &self.test_phases {
            held.copy_from_slice(&phases[test * PHASES..(test + 1) * PHASES]);
        }
        held
    }

    /// The preconditions of test `test`, as a range of precondition rows.
    pub fn preconditions(&self, test: usize) -> std::ops::Range<usize> {
        self.test_preconditions[test] as usize..self.test_preconditions[test + 1] as usize
    }

    /// Every column the length its neighbours say, and every id inside what it
    /// names, so the fold indexes without a check of its own.
    fn checked(&self) -> Result<(), String> {
        let strings = self.offsets.len().checked_sub(1).ok_or("record section strings.off is empty")?;
        bounds("strings.off", &self.offsets, self.blob.len())?;
        let sets = self.set_offsets.len().checked_sub(1).ok_or("record section sets.off is empty")?;
        bounds("sets.off", &self.set_offsets, self.set_bytes.len())?;
        let tests = self.test_path.len();
        let modules = self.module_path.len();
        let blocks = self.block_ordinal.len();
        let preconditions = self.precondition_name.len();
        rows("tests.complete", self.test_complete.len(), tests)?;
        rows("tests.preconditions", self.test_preconditions.len(), tests + 1)?;
        if let Some(duration) = &self.test_duration {
            rows(&LAYOUT.coverage.duration, duration.len(), tests)?;
        }
        if let Some(phases) = &self.test_phases {
            rows(&LAYOUT.coverage.phases, phases.len(), tests * PHASES)?;
        }
        bounds("tests.preconditions", &self.test_preconditions, preconditions)?;
        rows("preconditions.digest", self.precondition_digest.len(), preconditions)?;
        rows("modules.source", self.module_source.len(), modules)?;
        rows("modules.instrumented", self.module_instrumented.len(), modules)?;
        rows("modules.blocks", self.module_blocks.len(), modules + 1)?;
        bounds("modules.blocks", &self.module_blocks, blocks)?;
        for (name, length) in [
            ("blocks.kind", self.block_kind.len()),
            ("blocks.owner", self.block_owner.len()),
            ("blocks.digest", self.block_digest.len()),
            ("blocks.name", self.block_name.len()),
            ("blocks.path", self.block_path.len()),
            ("blocks.start", self.block_start.len()),
            ("blocks.end", self.block_end.len()),
            ("blocks.source", self.block_source.len()),
            ("blocks.set", self.block_set.len()),
            ("blocks.loadedSet", self.block_loaded_set.len()),
        ] {
            rows(name, length, blocks)?;
        }
        ids("snapshot.instrumentation", std::slice::from_ref(&self.instrumentation), strings)?;
        ids("snapshot.commit", self.commit.as_slice(), strings)?;
        for (name, column) in [
            ("tests.path", &self.test_path),
            ("preconditions.name", &self.precondition_name),
            ("preconditions.digest", &self.precondition_digest),
            ("modules.path", &self.module_path),
            ("modules.source", &self.module_source),
            ("blocks.digest", &self.block_digest),
            ("blocks.name", &self.block_name),
            ("blocks.path", &self.block_path),
        ] {
            ids(name, column, strings)?;
        }
        ids("blocks.set", &self.block_set, sets)?;
        ids("blocks.loadedSet", &self.block_loaded_set, sets)?;
        if self.block_kind.iter().any(|kind| usize::from(*kind) >= LAYOUT.coverage.block_kinds.len()) {
            return Err("record section blocks.kind names a kind this build does not know".to_owned());
        }
        Ok(())
    }
}

fn rows(name: &str, held: usize, expected: usize) -> Result<(), String> {
    if held == expected {
        Ok(())
    } else {
        Err(format!("record section {name} holds {held} rows where {expected} were expected"))
    }
}

/// Offsets that start at zero, never run backwards and end at `end`.
fn bounds(name: &str, offsets: &[u32], end: usize) -> Result<(), String> {
    let ordered = offsets.first() == Some(&0) && offsets.windows(2).all(|pair| pair[0] <= pair[1]);
    if ordered && offsets.last().is_some_and(|last| *last as usize == end) {
        Ok(())
    } else {
        Err(format!("record section {name} holds offsets outside what it indexes"))
    }
}

fn ids(name: &str, column: &[u32], count: usize) -> Result<(), String> {
    if column.iter().all(|id| (*id as usize) < count) {
        Ok(())
    } else {
        Err(format!("record section {name} names a row past the end"))
    }
}
