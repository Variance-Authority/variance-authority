//! The mainline records kept for a checkout, in the order every reader takes
//! them: the pick through the addon, and `symbol --line` in the executable.
//!
//! [`kept_behind`] is the one walk behind a commit. It streams `rev-list` and
//! stops at the last kept commit it is waiting for, so its cost is the
//! distance to that commit and never the line's age. Past [`WALK`] commits it
//! asks once which of the rest `from` does not hold, and stops waiting for them.

// compass: variance-authority.reach

use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Command, Stdio};

use napi_derive::napi;
use serde_json::Value;

/// How far one walk reads before it asks which kept commits `from` lacks.
const WALK: usize = 1000;

fn git(checkout: &Path) -> Command {
    let mut command = Command::new("git");
    command.current_dir(checkout).env("GIT_TERMINAL_PROMPT", "0").stderr(Stdio::null());
    command
}

/// Of `wanted`, the commits `from` does not contain; none when git does not answer.
fn lacked(checkout: &Path, from: &str, wanted: &HashSet<&str>) -> Option<HashSet<String>> {
    let mut child = git(checkout)
        .args(["rev-list", "--ignore-missing", "--stdin", &format!("^{from}")])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .ok()?;
    let input: String = wanted.iter().map(|commit| format!("{commit}\n")).collect();
    let mut pipe = child.stdin.take()?;
    // On its own thread: git may write before it has read all of its input.
    let writer = std::thread::spawn(move || pipe.write_all(input.as_bytes()));
    let output = child.wait_with_output().ok()?;
    writer.join().ok()?.ok()?;
    output.status.success().then(|| String::from_utf8_lossy(&output.stdout).lines().map(str::to_owned).collect())
}

/// The commits of `kept` that `from` contains, nearest first. `first_parent`
/// counts only that line, where a mainline publishes; `landed_after`, in
/// seconds, leaves out what was committed before it. A walk git refuses
/// answers what it read before the refusal.
pub(crate) fn kept_behind(checkout: &Path, from: &str, kept: &[String], first_parent: bool, landed_after: Option<i64>) -> Vec<String> {
    let mut wanted: HashSet<&str> = kept.iter().map(String::as_str).collect();
    let mut found = Vec::new();
    if wanted.is_empty() {
        return found;
    }
    let mut command = git(checkout);
    command.arg("rev-list");
    if first_parent {
        command.arg("--first-parent");
    }
    if let Some(after) = landed_after {
        command.arg(format!("--max-age={after}"));
    }
    let Ok(mut child) = command.arg(from).stdin(Stdio::null()).stdout(Stdio::piped()).spawn() else { return found };
    if let Some(out) = child.stdout.take() {
        for (walked, line) in BufReader::new(out).lines().map_while(Result::ok).enumerate() {
            if let Some(commit) = wanted.take(line.as_str()) {
                found.push(commit.to_owned());
            }
            if walked + 1 == WALK && !wanted.is_empty() {
                // Past the window only a commit `from` holds is waited for: a kept commit ahead of it never comes.
                match lacked(checkout, from, &wanted) {
                    Some(lacked) => wanted.retain(|commit| !lacked.contains(*commit)),
                    None => break,
                }
            }
            if wanted.is_empty() {
                break;
            }
        }
    }
    let _ = child.kill();
    let _ = child.wait();
    found
}

/// What a commit directory's `fetched.json` says, as far as the order needs it.
struct Pointer {
    commit: String,
    fetched: String,
    latest: bool,
    partial: bool,
}

fn pointer(dir: &Path, selected: Option<&str>) -> Option<Pointer> {
    let value: Value = serde_json::from_slice(&std::fs::read(dir.join("fetched.json")).ok()?).ok()?;
    let mainline = value.get("mainline")?.as_str()?;
    let flag = |key: &str| value.get(key).and_then(Value::as_bool) == Some(true);
    if flag("handed") || selected.is_some_and(|selected| selected != mainline) {
        return None;
    }
    Some(Pointer {
        commit: value.get("commit")?.as_str()?.to_owned(),
        fetched: value.get("fetched")?.as_str()?.to_owned(),
        latest: flag("latest"),
        partial: flag("partial"),
    })
}

/// One kept record: the read root it is under, and the commit directory that names it.
#[napi(object)]
pub struct KeptMainline {
    pub read_root: String,
    pub commit: String,
}

/// The mainline records named in each of `read_roots`' commit directories, of
/// `selected` when it is named, in the order a reader takes them. A share's
/// latest first, newest fetch first: it runs ahead of every merge base. Then
/// the kept commits `HEAD` contains, nearest first, a whole record before a
/// partial one at the same commit. Then the rest, newest fetch first. A
/// handed read is no other checkout's, and is passed over.
pub(crate) fn kept_mainlines(checkout: &Path, read_roots: &[String], selected: Option<&str>) -> Vec<KeptMainline> {
    let mut kept: Vec<(String, Pointer)> = Vec::new();
    for read_root in read_roots {
        let Ok(entries) = std::fs::read_dir(read_root) else { continue };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let commit = name.to_str().is_some_and(|name| (7..=64).contains(&name.len()) && name.bytes().all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f')));
            if !commit || !entry.file_type().is_ok_and(|kind| kind.is_dir()) {
                continue;
            }
            if let Some(pointer) = pointer(&entry.path(), selected) {
                kept.push((read_root.clone(), pointer));
            }
        }
    }
    let behind: Vec<String> = kept.iter().filter(|(_, one)| !one.latest).map(|(_, one)| one.commit.clone()).collect();
    let behind: HashMap<String, usize> = kept_behind(checkout, "HEAD", &behind, false, None).into_iter().zip(1..).collect();
    let rank = |one: &Pointer| if one.latest { Some(0) } else { behind.get(&one.commit).copied() };
    kept.sort_by(|(_, a), (_, b)| {
        let (at, bt) = (rank(a), rank(b));
        match (at, bt) {
            (Some(at), Some(bt)) if at != bt => at.cmp(&bt),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (Some(at), Some(_)) if at > 0 => a.partial.cmp(&b.partial),
            _ => b.fetched.cmp(&a.fetched),
        }
    });
    kept.into_iter().map(|(read_root, one)| KeptMainline { read_root, commit: one.commit }).collect()
}

#[napi(js_name = "keptMainlines", catch_unwind)]
pub fn kept_mainlines_napi(checkout: String, read_roots: Vec<String>, selected: Option<String>) -> Vec<KeptMainline> {
    kept_mainlines(Path::new(&checkout), &read_roots, selected.as_deref())
}

#[napi(js_name = "keptBehind", catch_unwind)]
pub fn kept_behind_napi(checkout: String, from: String, kept: Vec<String>, first_parent: bool, landed_after: Option<i64>) -> Vec<String> {
    kept_behind(Path::new(&checkout), &from, &kept, first_parent, landed_after)
}
