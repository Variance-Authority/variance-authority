//! `symbol --line`: the declarations of a name, ordered by the tests that ran
//! the line.
//!
//! The source index owns which declarations the name has; the recording owns
//! which tests ran the line and which entered each declaration. A declaration
//! the line called is entered by the line's tests and few others, so each is
//! scored by Ochiai — the tests it shares with the line over the geometric mean
//! of both counts.
//!
//! A line no test ran, or a name no file of the checkout declares, tells the
//! declarations apart by nothing, so the answer says so and gives `symbol`'s
//! answer without the line.

// compass: variance-authority.report.agent-surface

use std::cmp::Ordering;
use std::path::{Component, Path, PathBuf};

use napi_derive::napi;

use crate::help_symbol_answer::SymbolAnswer;
use crate::journey_masks::JourneyMasks;
use crate::journey_resonance::{resonate, Declaration, Resonance, Resonant};
use crate::journeys_read::lines_then;
use crate::order::code_unit;

/// One declared suite's recording that keeps its cases, and the commit it ran
/// at: absent when it names none, `unread` when it does not read. The host finds
/// them, as every reader of a recording there finds it.
#[napi(object)]
pub struct Recorded {
    pub suite: Option<String>,
    pub recording: String,
    pub commit: Option<String>,
    pub unread: Option<String>,
}

/// One suite's resonance, and the declarations written since its recording ran.
struct Suite {
    suite: Option<String>,
    resonance: Resonance,
    since: Vec<(String, u32)>,
}

/// `symbol`'s answers about `names`, ordered by the line `line` names — `<file>:<line>` — in the checkout at `root`.
pub(crate) fn at_line(root: &str, names: &[&str], line: &str, answers: &[SymbolAnswer], recorded: &[Recorded]) -> Result<String, String> {
    let at = line_of(line)?;
    let plain = || answers.iter().map(|answer| answer.text.as_str()).collect::<Vec<_>>().join("\n\n");
    if answers.iter().any(|answer| !answer.found) {
        return Ok(plain());
    }
    let name = names.join(", ");
    let declared = match answers {
        [answer] => answer.declared.as_ref().ok(),
        _ => None,
    };
    let Some(declared) = declared else {
        return Ok(format!("No file in this checkout declares `{name}`, so no recording tells its declarations apart:\n\n{}", plain()));
    };
    let candidates: Vec<Declaration> = declared.files.iter().flat_map(|(file, lines)| lines.iter().map(move |line| (file, *line))).map(|(file, line)| {
        let key = format!("{file}:{line}");
        let at = declared.spelled.iter().position(|(held, _)| *held == key);
        Declaration {
            file: file.clone(),
            line,
            through: at.and_then(|at| declared.heads[at]),
            spelled: at.map(|at| declared.spelled[at].1.clone()).unwrap_or_default(),
        }
    }).collect();
    let suites = resonance(root, &at, &candidates, recorded);
    let told: Vec<_> = suites.iter().filter(|one| one.resonance.not_recorded.is_none() && one.resonance.cases > 0).collect();
    let end = if told.is_empty() { ":" } else { "." };
    let untold: Vec<_> = suites.iter().filter(|one| !(one.resonance.not_recorded.is_none() && one.resonance.cases > 0)).map(|one| untold_line(one, &at, &name, end)).collect();
    if told.is_empty() {
        let why = if untold.is_empty() { vec![format!("No recording under {root} holds a suite, so nothing tells the declarations of `{name}` apart:")] } else { untold };
        return Ok(format!("{}\n\n{}", why.join("\n"), plain()));
    }
    let mut blocks: Vec<_> = told.iter().map(|one| suite_block(one, &at, &name)).collect();
    if !untold.is_empty() {
        blocks.push(untold.join("\n"));
    }
    Ok(blocks.join("\n\n"))
}

/// `src/page.ts:3`, split on its last colon so a path holding one is kept whole.
fn line_of(spelled: &str) -> Result<(String, u32), String> {
    let refused = || format!("`--line` takes `<file>:<line>`, such as `src/page.ts:3`, not `{spelled}`");
    let (file, line) = spelled.rsplit_once(':').filter(|(file, _)| !file.is_empty()).ok_or_else(refused)?;
    let line: u32 = line.parse().ok().filter(|line| *line >= 1).ok_or_else(refused)?;
    Ok((file.to_owned(), line))
}

/// `asked` spelled from `root` with `/`, or the sentence that says it is outside.
fn checkout_path(root: &str, asked: &str) -> Result<String, String> {
    let mut parts: Vec<String> = Vec::new();
    let joined = Path::new(root).join(asked);
    let base: PathBuf = Path::new(root).components().collect();
    let mut at = PathBuf::new();
    for part in joined.components() {
        match part {
            Component::ParentDir => { at.pop(); }
            Component::CurDir => {}
            other => at.push(other),
        }
    }
    let outside = || format!("{asked} is outside the checkout at {root}, and the recording holds only paths inside it.");
    let from = at.strip_prefix(&base).map_err(|_| outside())?;
    for part in from.components() {
        parts.push(part.as_os_str().to_str().ok_or_else(outside)?.to_owned());
    }
    Ok(if parts.is_empty() { ".".to_owned() } else { parts.join("/") })
}

/// How each of `candidates` resonates with `at`, asked of every suite
/// `recorded` holds, each line read where it stood at the commit the recording
/// ran at.
fn resonance(root: &str, at: &(String, u32), candidates: &[Declaration], recorded: &[Recorded]) -> Vec<Suite> {
    let asked = checkout_path(root, &at.0);
    recorded.iter().map(|record| {
        let refuse = |why: String| (Resonance { not_recorded: Some(why), cases: 0, resonant: Vec::new() }, Vec::new());
        let (resonance, since) = match (&asked, &record.commit) {
            (Err(outside), _) => refuse(outside.clone()),
            (Ok(_), None) => refuse(record.unread.clone().unwrap_or_else(|| "the recording names no commit".to_owned())),
            (Ok(file), Some(commit)) => suite(root, commit, &record.recording, file, at.1, candidates).unwrap_or_else(refuse),
        };
        Suite { suite: record.suite.clone(), resonance, since }
    }).collect()
}

/// One recording's resonance at `file:line`, and the candidates written since it ran.
fn suite(root: &str, commit: &str, recording: &str, file: &str, line: u32, candidates: &[Declaration]) -> Result<(Resonance, Vec<(String, u32)>), String> {
    let asking: Vec<(&str, u32)> = std::iter::once((file, line)).chain(candidates.iter().map(|one| (one.file.as_str(), one.line))).collect();
    let mut lines: Vec<Option<u32>> = asking.iter().map(|(_, line)| Some(*line)).collect();
    let mut files: Vec<&str> = Vec::new();
    for (file, _) in &asking {
        if !files.contains(file) { files.push(file) }
    }
    for file in files {
        let ats: Vec<usize> = (0..asking.len()).filter(|at| asking[*at].0 == file).collect();
        let placed = lines_then(root.to_owned(), commit.to_owned(), file.to_owned(), ats.iter().map(|at| asking[*at].1).collect());
        if let Some(unplaced) = placed.unplaced { return Err(unplaced) }
        for (nth, at) in ats.into_iter().enumerate() {
            lines[at] = placed.lines.get(nth).copied().flatten();
        }
    }
    let line = lines[0].ok_or("the line was written since the recording ran")?;
    let then = &lines[1..];
    // A head moves with the line it opens on.
    let placed: Vec<(usize, Declaration)> = candidates.iter().enumerate().filter_map(|(at, one)| {
        let now = then[at]?;
        Some((at, Declaration { file: one.file.clone(), line: now, spelled: one.spelled.clone(), through: one.through.map(|through| through - one.line + now) }))
    }).collect();
    let ends: Vec<Declaration> = placed.iter().map(|(_, end)| Declaration { file: end.file.clone(), line: end.line, through: end.through, spelled: end.spelled.clone() }).collect();
    let mut answer = JourneyMasks::open(recording).and_then(|mut masks| resonate(&mut masks, file, line, &ends))
        .map_err(|error| format!("the recording did not read ({error})"))?;
    for row in &mut answer.resonant {
        let at = placed[row.candidate as usize].0;
        row.candidate = at as u32;
        row.line = candidates[at].line;
    }
    let since = candidates.iter().enumerate().filter(|(at, _)| then[*at].is_none()).map(|(_, one)| (one.file.clone(), one.line)).collect();
    Ok((answer, since))
}

fn of_suite(suite: &Option<String>) -> String {
    suite.as_ref().map_or_else(String::new, |suite| format!("suite {suite}: "))
}

fn tests(count: u32) -> String {
    format!("{count} {}", if count == 1 { "test" } else { "tests" })
}

fn by_place(a: &(&str, u32), b: &(&str, u32)) -> Ordering {
    code_unit(a.0, b.0).then(a.1.cmp(&b.1))
}

/// Why a suite tells the declarations apart by nothing, ending in `end`: a colon when `symbol`'s answer follows.
fn untold_line(one: &Suite, at: &(String, u32), name: &str, end: &str) -> String {
    let why = match &one.resonance.not_recorded {
        None => format!("No recorded test ran {}:{}", at.0, at.1),
        Some(why) => format!("The recording cannot place {}:{}: {}", at.0, at.1, why.strip_suffix('.').unwrap_or(why)),
    };
    format!("{}{why}, so nothing tells the declarations of `{name}` apart{end}", of_suite(&one.suite))
}

fn suite_block(one: &Suite, at: &(String, u32), name: &str) -> String {
    let cases = one.resonance.cases;
    let mut lines = vec![format!("{}`{name}` at {}:{}, by the {cases} recorded {} that ran the line:", of_suite(&one.suite), at.0, at.1, if cases == 1 { "test" } else { "tests" })];
    let rows = &one.resonance.resonant;
    let scored: Vec<&Resonant> = rows.iter().filter(|row| row.shared > 0).collect();
    let sorted = |keep: &dyn Fn(&Resonant) -> bool| {
        let mut held: Vec<&Resonant> = rows.iter().filter(|row| keep(row)).collect();
        held.sort_by(|a, b| by_place(&(&a.file, a.line), &(&b.file, b.line)));
        held
    };
    let apart = sorted(&|row| row.recorded && row.shared == 0);
    let unrecorded = sorted(&|row| !row.recorded);
    let tied = |row: &Resonant| scored.iter().any(|other| !std::ptr::eq(*other, row) && (other.score - row.score).abs() < 1e-9);
    lines.push(String::new());
    if scored.is_empty() {
        lines.push(format!("No test that ran the line entered a declaration of `{name}`."));
    }
    for row in &scored {
        lines.push(format!("{}:{}  {}{}  {} of the {} that entered it ran the line", row.file, row.line, fixed(row.score), if tied(row) { " tied" } else { "" }, row.shared, tests(row.cases)));
    }
    if !apart.is_empty() {
        lines.extend([String::new(), "Not run with it:".to_owned()]);
        lines.extend(apart.iter().map(|row| format!("{}:{}  {}", row.file, row.line, if row.cases == 0 { "no recorded test entered it".to_owned() } else { format!("none of the {} that entered it ran the line", tests(row.cases)) })));
    }
    if !unrecorded.is_empty() {
        lines.extend([String::new(), "Not in the recording:".to_owned()]);
        lines.extend(unrecorded.iter().map(|row| format!("{}:{}  no recorded function is written at this line", row.file, row.line)));
    }
    if !one.since.is_empty() {
        let mut since: Vec<_> = one.since.iter().map(|(file, line)| (file.as_str(), *line)).collect();
        since.sort_by(by_place);
        lines.extend([String::new(), "Written since the recording ran:".to_owned()]);
        lines.extend(since.iter().map(|(file, line)| format!("{file}:{line}")));
    }
    lines.join("\n")
}

/// `score` to two places as JavaScript's `toFixed(2)` writes it: both write
/// the exact binary value, but an exact half — only an eighth can be one — rounds
/// up there and to even here.
fn fixed(score: f64) -> String {
    if (score * 8.0).fract() == 0.0 {
        return format!("{:.2}", (score * 100.0 + 0.5).floor() / 100.0);
    }
    format!("{score:.2}")
}
