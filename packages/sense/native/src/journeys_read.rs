//! Asking the prepared journeys about a file or a line: who reaches its
//! recorded functions, where they go, and which package flows pass through
//! its package. Nothing is walked, parsed or decoded from the recording here;
//! the answer is read off the file `journeys.rs` prepared.
//!
//! The file answers only while it is the recording's and the index's. Each is
//! checked by size and modification time first and by digest only when those
//! moved, so a fresh file costs no hash. A line is a coordinate in the tree
//! the recording ran over: git says where it stood at the recorded commit, or
//! that it was written since and no case has run it.

// compass: variance-authority.reach.relations

use std::collections::HashMap;

use napi_derive::napi;

use crate::journey_columns::{decode, Decoded};
use crate::journey_stitch::strings;
use crate::journeys::{digest_of, Meta, Stat, FORMAT, NO_PACKAGE, TEST};
use crate::journeys_steps::{Known, Tag};

const CALLERS: usize = 6;
const GOES: usize = 8;
const BLOCKS: usize = 8;
const FLOWS: usize = 5;

#[napi(object)]
pub struct JourneysAsk {
    /// Repository-relative.
    pub file: String,
    pub line: Option<u32>,
}

#[napi(object)]
pub struct JourneysBlock {
    pub name: String,
    pub kind: String,
    pub line: u32,
    pub end: u32,
    pub cases: u32,
}

#[napi(object)]
pub struct JourneysCall {
    /// The function at the far end; absent for the test itself.
    pub name: Option<String>,
    pub file: Option<String>,
    pub line: Option<u32>,
    /// The asked file's own function the call lands on or leaves from, when
    /// the question was the whole file.
    pub at: Option<String>,
    /// Cases that placed this call.
    pub cases: u32,
    /// How the call is known: `observed`, `static`, a way it was inferred, or
    /// `test`.
    pub known: String,
}

#[napi(object)]
pub struct JourneysRegion {
    pub name: String,
    pub kind: String,
    pub line: u32,
    pub end: u32,
    pub cases: u32,
    /// It ran while its module loaded.
    pub loaded: bool,
    /// Cases that placed a caller for it, summed over its callers.
    pub placed_in: u32,
    pub callers: Vec<JourneysCall>,
    pub more_callers: u32,
    pub goes: Vec<JourneysCall>,
    pub more_goes: u32,
    /// Functions written directly inside it that cases entered.
    pub inner: Vec<JourneysBlock>,
    pub more_inner: u32,
}

#[napi(object)]
pub struct JourneysFlow {
    pub cases: u32,
    /// Package names in the order the flow reached them; `null` for files no
    /// named manifest sits above.
    pub packages: Vec<Option<String>>,
    pub example_file: String,
    pub example_name: String,
}

#[napi(object)]
pub struct JourneysFlows {
    pub package: Option<String>,
    /// Cases whose flow passes through the package.
    pub through: u32,
    pub distinct: u32,
    pub top: Vec<JourneysFlow>,
}

#[napi(object)]
pub struct JourneysFile {
    pub file: String,
    pub line: Option<u32>,
    /// The recording has functions in this file.
    pub recorded: bool,
    /// The file differs from the recorded commit; absent when no line was
    /// asked, or git could not say.
    pub changed: Option<bool>,
    /// The asked line was written after the recording.
    pub written_since: bool,
    /// The asked line's number at the recorded commit, when the file changed.
    pub at_commit: Option<u32>,
    pub blocks: Vec<JourneysBlock>,
    pub more_blocks: u32,
    pub callers: Vec<JourneysCall>,
    pub more_callers: u32,
    pub goes: Vec<JourneysCall>,
    pub more_goes: u32,
    pub focus: Option<JourneysRegion>,
    /// The innermost block holding the line, when it is not the focus.
    pub holding: Option<JourneysBlock>,
    pub flows: JourneysFlows,
}

#[napi(object)]
pub struct JourneysAnswer {
    /// Why the prepared file cannot answer; every other field is empty then.
    pub not_prepared: Option<String>,
    pub cases: u32,
    pub commit: Option<String>,
    pub files: Vec<JourneysFile>,
}

fn refused(reason: &str) -> JourneysAnswer {
    JourneysAnswer { not_prepared: Some(reason.to_owned()), cases: 0, commit: None, files: Vec::new() }
}

/// The file at `path` is the one stamped, by stat when it did not move and by
/// digest when it did.
fn same(path: &str, stat: Option<&Stat>, digest: &str) -> bool {
    stat.is_some_and(|stat| Stat::of(path).as_ref() == Some(stat)) || digest_of(path).as_deref() == Some(digest)
}

struct Prepared {
    strings: Vec<String>,
    region_file: Vec<u32>,
    region_kind: Vec<u32>,
    region_name: Vec<u32>,
    region_start: Vec<u32>,
    region_end: Vec<u32>,
    region_cases: Vec<u32>,
    region_loaded: Vec<u8>,
    call_from: Vec<u32>,
    call_to: Vec<u32>,
    call_cases: Vec<u32>,
    call_tag: Vec<u8>,
    call_how: Vec<u8>,
    flow_packages: Vec<u32>,
    flow_off: Vec<u32>,
    flow_cases: Vec<u32>,
    flow_example: Vec<u32>,
    test_file: Vec<u32>,
    test_name: Vec<u32>,
    package_name: Vec<u32>,
    package_directory: Vec<u32>,
}

impl Prepared {
    fn read(decoded: &Decoded) -> Result<Prepared, String> {
        Ok(Prepared {
            strings: strings(decoded)?,
            region_file: decoded.words("regions.file")?,
            region_kind: decoded.words("regions.kind")?,
            region_name: decoded.words("regions.name")?,
            region_start: decoded.words("regions.start")?,
            region_end: decoded.words("regions.end")?,
            region_cases: decoded.words("regions.cases")?,
            region_loaded: decoded.bytes("regions.loaded")?,
            call_from: decoded.words("calls.from")?,
            call_to: decoded.words("calls.to")?,
            call_cases: decoded.words("calls.cases")?,
            call_tag: decoded.bytes("calls.tag")?,
            call_how: decoded.bytes("calls.how")?,
            flow_packages: decoded.words("flows.packages")?,
            flow_off: decoded.words("flows.off")?,
            flow_cases: decoded.words("flows.cases")?,
            flow_example: decoded.words("flows.example")?,
            test_file: decoded.words("tests.file")?,
            test_name: decoded.words("tests.name")?,
            package_name: decoded.words("packages.name")?,
            package_directory: decoded.words("packages.directory")?,
        })
    }

    fn text(&self, id: u32) -> &str {
        self.strings.get(id as usize).map_or("", String::as_str)
    }

    fn block(&self, region: u32) -> JourneysBlock {
        let at = region as usize;
        JourneysBlock {
            name: self.text(self.region_name[at]).to_owned(),
            kind: self.text(self.region_kind[at]).to_owned(),
            line: self.region_start[at],
            end: self.region_end[at],
            cases: self.region_cases[at],
        }
    }

    fn known(&self, call: usize) -> String {
        match Tag::from_code(self.call_tag[call]) {
            Some(Tag::Inferred) => Known::from_code(self.call_how[call]).map_or("inferred", Known::name).to_owned(),
            Some(tag) => tag.name().to_owned(),
            None => "unknown".to_owned(),
        }
    }

    /// One call, named by its far end `other`; `at` names the asked file's end.
    fn call(&self, call: usize, other: u32, at: Option<u32>) -> JourneysCall {
        let (name, file, line) = if other == TEST {
            (None, None, None)
        } else {
            let other = other as usize;
            (
                Some(self.text(self.region_name[other]).to_owned()),
                Some(self.text(self.region_file[other]).to_owned()),
                Some(self.region_start[other]),
            )
        };
        JourneysCall { name, file, line, at: at.map(|at| self.text(self.region_name[at as usize]).to_owned()), cases: self.call_cases[call], known: self.known(call) }
    }

    fn package(&self, id: u32) -> Option<String> {
        (id != NO_PACKAGE).then(|| self.text(self.package_name[id as usize]).to_owned())
    }

    /// The package owning `file`: the one at the nearest directory above it.
    fn owner(&self, file: &str) -> u32 {
        let directories: HashMap<&str, u32> =
            self.package_directory.iter().enumerate().map(|(at, &directory)| (self.text(directory), at as u32)).collect();
        let mut directory = crate::package_owners::parent(file);
        loop {
            if let Some(&at) = directories.get(directory) {
                return at;
            }
            if directory.is_empty() {
                return NO_PACKAGE;
            }
            directory = crate::package_owners::parent(directory);
        }
    }

    fn flows(&self, package: u32) -> JourneysFlows {
        let mut through: Vec<usize> = (0..self.flow_cases.len())
            .filter(|&flow| self.flow_packages[self.flow_off[flow] as usize..self.flow_off[flow + 1] as usize].contains(&package))
            .collect();
        through.sort_by(|&a, &b| self.flow_cases[b].cmp(&self.flow_cases[a]).then(a.cmp(&b)));
        let top = through
            .iter()
            .take(FLOWS)
            .map(|&flow| {
                let example = self.flow_example[flow] as usize;
                JourneysFlow {
                    cases: self.flow_cases[flow],
                    packages: self.flow_packages[self.flow_off[flow] as usize..self.flow_off[flow + 1] as usize]
                        .iter()
                        .map(|&package| self.package(package))
                        .collect(),
                    example_file: self.text(self.test_file[example]).to_owned(),
                    example_name: self.text(self.test_name[example]).to_owned(),
                }
            })
            .collect();
        JourneysFlows {
            package: self.package(package),
            through: through.iter().map(|&flow| self.flow_cases[flow]).sum(),
            distinct: through.len() as u32,
            top,
        }
    }

    /// Calls sorted by cases, most first, then by their far end's position.
    fn ranked(&self, mut calls: Vec<(usize, u32, Option<u32>)>, top: usize) -> (Vec<JourneysCall>, u32) {
        calls.sort_by(|a, b| self.call_cases[b.0].cmp(&self.call_cases[a.0]).then(a.0.cmp(&b.0)));
        let more = calls.len().saturating_sub(top) as u32;
        (calls.into_iter().take(top).map(|(call, other, at)| self.call(call, other, at)).collect(), more)
    }

    fn region(&self, region: u32) -> JourneysRegion {
        let into: Vec<usize> = (0..self.call_to.len()).filter(|&call| self.call_to[call] == region).collect();
        let placed_in = into.iter().map(|&call| self.call_cases[call]).sum();
        let (callers, more_callers) = self.ranked(into.iter().map(|&call| (call, self.call_from[call], None)).collect(), CALLERS);
        let out: Vec<_> = (0..self.call_from.len()).filter(|&call| self.call_from[call] == region).map(|call| (call, self.call_to[call], None)).collect();
        let (goes, more_goes) = self.ranked(out, GOES);
        let at = region as usize;
        let name = self.text(self.region_name[at]);
        let mut inner: Vec<u32> = Vec::new();
        if goes.is_empty() {
            let prefix = format!("{name}/");
            inner = (0..self.region_name.len() as u32)
                .filter(|&other| {
                    let o = other as usize;
                    other != region
                        && self.region_file[o] == self.region_file[at]
                        && self.text(self.region_kind[o]) == "function"
                        && self.region_cases[o] > 0
                        && self.text(self.region_name[o]).strip_prefix(&prefix).is_some_and(|rest| !rest.contains('/'))
                })
                .collect();
            inner.sort_by(|&a, &b| self.region_cases[b as usize].cmp(&self.region_cases[a as usize]).then(a.cmp(&b)));
        }
        let more_inner = inner.len().saturating_sub(CALLERS) as u32;
        let block = self.block(region);
        JourneysRegion {
            name: block.name,
            kind: block.kind,
            line: block.line,
            end: block.end,
            cases: block.cases,
            loaded: self.region_loaded[at] != 0,
            placed_in,
            callers,
            more_callers,
            goes,
            more_goes,
            inner: inner.into_iter().take(CALLERS).map(|region| self.block(region)).collect(),
            more_inner,
        }
    }
}

/// Where `line` stood at the commit a `git diff -U0` was taken against:
/// `None` when the diff wrote it, else its number then.
pub(crate) fn line_then(diff: &str, line: u32) -> Option<u32> {
    let mut shift: i64 = 0;
    for hunk in diff.lines().filter(|text| text.starts_with("@@ ")) {
        let mut parts = hunk.split(' ').skip(1);
        let range = |part: Option<&str>| -> Option<(i64, i64)> {
            let part = part?.get(1..)?;
            let (from, count) = part.split_once(',').unwrap_or((part, "1"));
            Some((from.parse().ok()?, count.parse().ok()?))
        };
        let (Some((_, removed)), Some((added_from, added))) = (range(parts.next()), range(parts.next())) else { continue };
        let first = if added > 0 { added_from } else { added_from + 1 };
        if first > line as i64 {
            break;
        }
        if added > 0 && (line as i64) < added_from + added {
            return None;
        }
        shift += removed - added;
    }
    u32::try_from(line as i64 + shift).ok()
}

/// Answers each ask from the journeys prepared at `out` for the recording at
/// `recording` and the index at `index`.
#[napi(catch_unwind)]
pub fn journeys_for(root: String, index: String, recording: String, out: String, asks: Vec<JourneysAsk>) -> JourneysAnswer {
    let Ok(bytes) = std::fs::read(&out) else { return refused("none were prepared beside this index") };
    let Ok(decoded) = decode(&bytes, FORMAT) else { return refused("they were prepared by another version") };
    let Some(meta) = decoded.bytes("meta.json").ok().and_then(|json| serde_json::from_slice::<Meta>(&json).ok()) else {
        return refused("they were prepared by another version");
    };
    if !same(&recording, meta.recording_stat.as_ref(), &meta.recording) {
        return refused("the recording changed after they were prepared");
    }
    if !same(&index, meta.index_stat.as_ref(), &meta.index) {
        return refused("the index changed after they were prepared");
    }
    let prepared = match Prepared::read(&decoded) {
        Ok(prepared) => prepared,
        Err(error) => return refused(&format!("they did not read ({error})")),
    };
    let files = asks.into_iter().map(|ask| answer(&root, &meta, &prepared, ask)).collect();
    JourneysAnswer { not_prepared: None, cases: meta.cases, commit: meta.commit.clone(), files }
}

fn answer(root: &str, meta: &Meta, prepared: &Prepared, ask: JourneysAsk) -> JourneysFile {
    // Only a line needs git: it is a coordinate in the recorded tree. A whole
    // file is answered by name, and git is not asked what moved in it.
    let diff = meta
        .commit
        .as_deref()
        .filter(|_| ask.line.is_some())
        .and_then(|commit| crate::git::git(root, &["diff", "-U0", "--no-color", "--no-ext-diff", commit, "--", &ask.file], None))
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned());
    let changed = diff.as_ref().map(|diff| !diff.is_empty());
    let (written_since, line) = match (ask.line, diff.as_deref().filter(|diff| !diff.is_empty())) {
        (Some(line), Some(diff)) => line_then(diff, line).map_or((true, None), |then| (false, Some(then))),
        (line, _) => (false, line),
    };
    let at_commit = line.filter(|_| changed == Some(true));
    let file_id = prepared.strings.iter().position(|text| *text == ask.file).map(|at| at as u32);
    let regions: Vec<u32> = file_id
        .map(|id| (0..prepared.region_file.len() as u32).filter(|&region| prepared.region_file[region as usize] == id).collect())
        .unwrap_or_default();
    let mut file = JourneysFile {
        recorded: !regions.is_empty(),
        changed,
        written_since,
        at_commit,
        blocks: Vec::new(),
        more_blocks: 0,
        callers: Vec::new(),
        more_callers: 0,
        goes: Vec::new(),
        more_goes: 0,
        focus: None,
        holding: None,
        flows: prepared.flows(prepared.owner(&ask.file)),
        file: ask.file,
        line: ask.line,
    };
    if written_since {
        return file;
    }
    if let Some(line) = line {
        let holds = |region: &u32| {
            let at = *region as usize;
            prepared.text(prepared.region_kind[at]) != "module" && prepared.region_start[at] <= line && line <= prepared.region_end[at]
        };
        let span = |region: &u32| prepared.region_end[*region as usize] - prepared.region_start[*region as usize];
        let function = regions.iter().copied().filter(holds).filter(|&region| matches!(prepared.text(prepared.region_kind[region as usize]), "function" | "handler")).min_by_key(span);
        let block = regions.iter().copied().filter(holds).min_by_key(span);
        file.focus = function.map(|region| prepared.region(region));
        file.holding = block.filter(|block| Some(*block) != function).map(|block| prepared.block(block));
        return file;
    }
    let mut blocks: Vec<u32> =
        regions.iter().copied().filter(|&region| matches!(prepared.text(prepared.region_kind[region as usize]), "function" | "handler")).collect();
    blocks.sort_by(|&a, &b| prepared.region_cases[b as usize].cmp(&prepared.region_cases[a as usize]).then(a.cmp(&b)));
    file.more_blocks = blocks.len().saturating_sub(BLOCKS) as u32;
    file.blocks = blocks.into_iter().take(BLOCKS).map(|region| prepared.block(region)).collect();
    let inside = |region: u32| region != TEST && file_id == Some(prepared.region_file[region as usize]);
    let into = (0..prepared.call_to.len())
        .filter(|&call| inside(prepared.call_to[call]) && !inside(prepared.call_from[call]))
        .map(|call| (call, prepared.call_from[call], Some(prepared.call_to[call])))
        .collect();
    (file.callers, file.more_callers) = prepared.ranked(into, CALLERS);
    let out = (0..prepared.call_from.len())
        .filter(|&call| inside(prepared.call_from[call]) && !inside(prepared.call_to[call]))
        .map(|call| (call, prepared.call_to[call], Some(prepared.call_from[call])))
        .collect();
    (file.goes, file.more_goes) = prepared.ranked(out, GOES);
    file
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_line_is_carried_back_across_the_hunks_above_it() {
        // Two lines added at 3, one removed at old 10, one replaced at old 20.
        let diff = "@@ -2,0 +3,2 @@\n+a\n+b\n@@ -10 +11,0 @@\n-c\n@@ -20 +21 @@\n-d\n+e\n";
        assert_eq!(line_then(diff, 1), Some(1));
        assert_eq!(line_then(diff, 3), None);
        assert_eq!(line_then(diff, 4), None);
        assert_eq!(line_then(diff, 5), Some(3));
        assert_eq!(line_then(diff, 11), Some(9));
        assert_eq!(line_then(diff, 12), Some(11));
        assert_eq!(line_then(diff, 21), None);
        assert_eq!(line_then(diff, 30), Some(29));
    }
}
