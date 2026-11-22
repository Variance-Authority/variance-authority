//! Which cases a replayed journal frame is charged to.

use crate::case_owner;
use crate::journal_scan::{self, Visitor};
use crate::journey_journal::CaseRun;

/// Where the frame being replayed is charged: one case, a case file's range,
/// or the cases a part frame's journey belongs to. The fold and the count of
/// unrecorded modules resolve frames through this one reading, so the two
/// cannot disagree on who ran what.
pub(crate) struct Charge<'a> {
    run: &'a CaseRun,
    pub(crate) case_frame: usize,
    pub(crate) test_first: u32,
    pub(crate) test_last: u32,
    /// Whether the frame is a file's ambient one, charged to its whole range.
    pub(crate) ambient: bool,
    /// The cases a part frame is charged to; cases themselves use the range.
    pub(crate) targets: &'a [u32],
    /// The part file being replayed, once the case frames are done.
    pub(crate) part: Option<usize>,
}

impl<'a> Charge<'a> {
    pub(crate) fn new(run: &'a CaseRun) -> Self {
        Self::at(run, 0)
    }

    /// Charge from the `case_frame`th case frame on, as a journal replayed on its own begins.
    pub(crate) fn at(run: &'a CaseRun, case_frame: usize) -> Self {
        Charge { run, case_frame, test_first: 0, test_last: 0, ambient: false, targets: &[], part: None }
    }

    /// Whether the frame is charged to no case.
    pub(crate) fn nobody(&self) -> bool {
        self.test_first == self.test_last && self.targets.is_empty()
    }

    pub(crate) fn test(&mut self, packed: &str) -> Result<(), String> {
        let run = self.run;
        self.ambient = false;
        if let Some(part) = self.part {
            let journey = case_owner::journey_of(packed);
            self.test_first = 0;
            self.test_last = 0;
            // A journey no case handed out is work the writer did for nobody in
            // particular: a trace its tracer started at import, or a request
            // from outside the run. That is every case it served, the same as
            // work under no journey at all.
            self.targets = if journey.is_empty() {
                &run.part_tests[part]
            } else {
                run.journey_tests.get(journey).map_or(&run.part_tests[part], Vec::as_slice)
            };
            return Ok(());
        }
        let (file, name, id, _) = case_owner::unpack_case(packed);
        if name.is_empty() && id.is_empty() {
            let normalized = case_owner::project_path(&run.root, file);
            let range = run.tests_by_file.get(&normalized).copied().unwrap_or((0, 0));
            self.test_first = range.0;
            self.test_last = range.1;
            self.ambient = true;
        } else {
            let test = run
                .frame_tests
                .get(self.case_frame)
                .copied()
                .ok_or_else(|| "case journal replay changed while it was being folded".to_owned())?;
            self.case_frame += 1;
            self.test_first = test;
            self.test_last = test + 1;
        }
        Ok(())
    }
}

pub(crate) trait Charged<'a>: Visitor {
    fn charge(&mut self) -> &mut Charge<'a>;
}

/// Replay every case journal, then every part, charging each frame.
pub(crate) fn replay_run<'a>(run: &CaseRun, visitor: &mut impl Charged<'a>) -> Result<(), String> {
    journal_scan::replay(&run.paths, visitor)?;
    if visitor.charge().case_frame != run.frame_tests.len() {
        return Err("case journal replay changed while it was being folded".to_owned());
    }
    for (at, path) in run.parts.iter().enumerate() {
        visitor.charge().part = Some(at);
        journal_scan::replay_part(path, visitor)?;
    }
    Ok(())
}
