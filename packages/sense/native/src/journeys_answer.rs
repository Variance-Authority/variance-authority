//! What a question about the prepared journeys is asked with and answered
//! with, as the addon hands it to JavaScript (`journeys_read.rs` answers).

// compass: variance-authority.reach.relations

use napi_derive::napi;

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
    /// Cases that entered a function of the package, as the recording has it.
    pub through: u32,
    /// Of all cases, the ones whose package flow passes through the package,
    /// the package their test file sits in counted.
    pub placed: u32,
    /// Distinct package orders among those.
    pub distinct: u32,
    pub top: Vec<JourneysFlow>,
}

#[napi(object)]
pub struct JourneysFile {
    pub file: String,
    pub line: Option<u32>,
    /// The recording has functions in this file.
    pub recorded: bool,
    /// Cases that entered a function of this file, as the recording has it.
    pub cases: u32,
    /// The file differs from the recorded commit; absent when no line was
    /// asked, or git could not say.
    pub changed: Option<bool>,
    /// The asked line was written after the recording.
    pub written_since: bool,
    /// The asked line's number at the recorded commit, when the file changed.
    pub at_commit: Option<u32>,
    /// Why the asked line is read as the number it has today rather than
    /// carried back to the recorded commit.
    pub unplaced: Option<String>,
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
    /// Why the call graph was parsed from the working tree rather than from
    /// the recorded commit.
    pub tree: Option<String>,
    pub files: Vec<JourneysFile>,
}

pub(crate) fn refused(reason: &str) -> JourneysAnswer {
    JourneysAnswer { not_prepared: Some(reason.to_owned()), cases: 0, commit: None, tree: None, files: Vec::new() }
}
