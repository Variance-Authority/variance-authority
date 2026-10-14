//! One record read whole for a fold: its coverage columns as they are stored,
//! every id checked against the column it names before a fold addresses it,
//! and its case parts as bytes. Nothing is turned into objects; a string is a
//! slice of the record's own dictionary.
//!
//! The layouts read are the ones `record-layout.json` calls readable: the
//! current one, the one before the case parts (read as a record that kept no
//! cases), and the one before `tests.duration` (read as one whose runner
//! reported none).

use crate::journey_columns::{self, Decoded};
use crate::record_layout::LAYOUT;

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
}

pub(crate) struct Record {
    /// `None` for a record whose run instrumented nothing: it holds cases and no coverage.
    pub coverage: Option<Coverage>,
    pub parts: Parts,
}

/// `bytes` read as a record, refused with the reason when it is not one this build reads.
pub(crate) fn read(bytes: &[u8]) -> Result<Record, String> {
    let (version, decoded) = journey_columns::decode_any(bytes)?;
    let layout = &LAYOUT.coverage;
    if !layout.readable(version) {
        return Err(format!(
            "unsupported record version: {version}; this build reads versions {}, {} and {}",
            layout.untimed, layout.uncased, layout.format
        ));
    }
    let names = decoded.names();
    if let Some(unknown) = names.iter().find(|name| !layout.sections.contains(name) && !layout.parts.iter().any(|(_, part)| part == **name)) {
        return Err(format!("the record holds a section this build does not know: {unknown}"));
    }
    let part = |part: &str| -> Result<Option<Vec<u8>>, String> {
        let name = layout.part(part);
        if version == layout.uncased || !decoded.has(name) {
            return Ok(None);
        }
        decoded.bytes(name).map(Some)
    };
    let parts = Parts { index: part("index")?, before: part("before")?, last: part("last")?, eyes: part("eyes")? };
    let coverage = if layout.sections.iter().any(|name| decoded.has(name)) { Some(coverage(&decoded, version)?) } else { None };
    Ok(Record { coverage, parts })
}

fn coverage(decoded: &Decoded, version: u8) -> Result<Coverage, String> {
    let words = |name: &str| decoded.words(name);
    let bytes = |name: &str| decoded.bytes(name);
    let timed = version != LAYOUT.coverage.untimed;
    let one = |name: &str, values: Vec<u32>, empty: bool| -> Result<Option<u32>, String> {
        match values.as_slice() {
            [value] => Ok(Some(*value)),
            [] if empty => Ok(None),
            _ => Err(format!("record section {name} holds {} values, not one", values.len())),
        }
    };
    let coverage = Coverage {
        blob: bytes("strings.blob")?,
        offsets: words("strings.off")?,
        instrumentation: one("snapshot.instrumentation", words("snapshot.instrumentation")?, false)?.unwrap_or_default(),
        commit: one("snapshot.commit", words("snapshot.commit")?, true)?,
        test_path: words("tests.path")?,
        test_complete: bytes("tests.complete")?,
        test_preconditions: words("tests.preconditions")?,
        test_duration: if timed { Some(words(&LAYOUT.coverage.duration)?) } else { None },
        precondition_name: words("preconditions.name")?,
        precondition_digest: words("preconditions.digest")?,
        module_path: words("modules.path")?,
        module_source: words("modules.source")?,
        module_instrumented: bytes("modules.instrumented")?,
        module_blocks: words("modules.blocks")?,
        block_ordinal: words("blocks.ordinal")?,
        block_kind: bytes("blocks.kind")?,
        block_owner: words("blocks.owner")?,
        block_digest: words("blocks.digest")?,
        block_name: words("blocks.name")?,
        block_path: words("blocks.path")?,
        block_start: words("blocks.start")?,
        block_end: words("blocks.end")?,
        block_source: bytes("blocks.source")?,
        block_set: words("blocks.set")?,
        block_loaded_set: words("blocks.loadedSet")?,
        set_bytes: bytes("sets.blob")?,
        set_offsets: words("sets.off")?,
    };
    coverage.checked()?;
    Ok(coverage)
}

impl Coverage {
    pub fn tests(&self) -> usize {
        self.test_path.len()
    }

    pub fn modules(&self) -> usize {
        self.module_path.len()
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
