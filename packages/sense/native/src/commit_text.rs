//! Files at commits, as git holds them, for a reader that wants the text a
//! recording was cut from or a diff was taken against.
//!
//! [`each_content`] reads blobs by object name: one `cat-file --batch` for all
//! of them, and in a partial clone one fetch first of those the clone lacks, as
//! `promisor.rs` describes. Every object it is handed was named by a tree, so
//! one git answers `missing` is a fault and never an absent file: that blob
//! carries git's own reason. A blob that is a git-LFS pointer is its content,
//! or carries git-lfs's reason, as `lfs.rs` describes. [`contents`] is the same
//! read for a caller that needs every blob, failing on the first reason.
//!
//! [`texts_at`] finds those object names in each commit's tree, so a path is
//! absent only when the tree does not list it. A path git could not read is
//! refused with git's reason beside the texts it could: a commit the checkout
//! does not hold — a shallow clone, or one fetched at depth 1 — refuses each
//! path asked at it naming the commit, never with every path answered absent.
//! [`blobs_at`] is the same listing without the bodies: each path's blob name,
//! `git:<object>`, for a reader that only asks whether two commits hold the
//! same text.

// compass: variance-authority.reach.source-index

use std::collections::HashMap;

use napi_derive::napi;

use crate::git::{answer, git};
use crate::journeys_graph::short;

/// Paths one `ls-tree` is handed, so the command line stays well under the
/// operating system's argument limit whatever the paths are.
const PATHS_PER_LISTING: usize = 512;

/// The texts found, as columns: `asked[commit[at]]` holds `file[at]` as
/// `text[at]`. Beside them, the paths git could not read: `asked[refused_commit[at]]`
/// holds `refused_file[at]`, and `refused[at]` is git's reason.
#[napi(object)]
pub struct CommitTexts {
    pub commit: Vec<u32>,
    pub file: Vec<String>,
    pub text: Vec<String>,
    pub refused_commit: Vec<u32>,
    pub refused_file: Vec<String>,
    pub refused: Vec<String>,
}

/// `paths[at]` at `commits[at]`, leaving out a path the commit does not hold,
/// and refusing one git could not read with its reason.
#[napi(catch_unwind)]
pub fn texts_at(root: String, commits: Vec<String>, paths: Vec<Vec<String>>) -> napi::Result<CommitTexts> {
    read(&root, &commits, &paths).map_err(napi::Error::from_reason)
}

/// The blob name, `git:<object>`, of `paths[at]` at `commits[at]`, in the
/// columns [`texts_at`] answers in: a path the commit does not hold is left
/// out, and a commit git could not list refuses each path asked at it.
#[napi(catch_unwind)]
pub fn blobs_at(root: String, commits: Vec<String>, paths: Vec<Vec<String>>) -> CommitTexts {
    let mut found = empty();
    for (at, file, oid) in listed(&root, &commits, &paths, &mut found) {
        found.commit.push(at as u32);
        found.file.push(file.to_owned());
        found.text.push(format!("git:{oid}"));
    }
    found
}

/// The blob each of `paths[at]` names in `commits[at]`'s tree, as `(at, path,
/// object)`, leaving out a path the tree does not list. A commit git could not
/// list refuses each path asked at it into `found`.
fn listed<'a>(root: &str, commits: &[String], paths: &'a [Vec<String>], found: &mut CommitTexts) -> Vec<(usize, &'a str, String)> {
    let mut held = Vec::new();
    for (at, (commit, files)) in commits.iter().zip(paths).enumerate() {
        if files.is_empty() {
            continue;
        }
        match blobs(root, commit, files) {
            Ok(listed) => held.extend(files.iter().filter_map(|file| listed.get(file).map(|oid| (at, file.as_str(), oid.clone())))),
            Err(why) => {
                let why = absent(root, commit).unwrap_or_else(|| unread(&[commit], &why));
                for file in files {
                    found.refused_commit.push(at as u32);
                    found.refused_file.push(file.clone());
                    found.refused.push(why.clone());
                }
            }
        }
    }
    held
}

fn empty() -> CommitTexts {
    CommitTexts {
        commit: Vec::new(),
        file: Vec::new(),
        text: Vec::new(),
        refused_commit: Vec::new(),
        refused_file: Vec::new(),
        refused: Vec::new(),
    }
}

fn unread(commits: &[&String], why: &str) -> String {
    let at: Vec<&str> = commits.iter().map(|commit| short(commit)).collect();
    format!("git could not read the files asked about at commit {}: {why}", at.join(", "))
}

pub(crate) fn read(root: &str, commits: &[String], paths: &[Vec<String>]) -> Result<CommitTexts, String> {
    let mut found = empty();
    let held = listed(root, commits, paths, &mut found);
    let asked: Vec<Blob> = held.iter().map(|(at, file, oid)| Blob { oid, path: file, commit: &commits[*at] }).collect();
    let every: Vec<&String> = commits.iter().collect();
    let texts = each_content(root, &asked).map_err(|why| unread(&every, &why))?;
    for ((at, file, _), body) in held.iter().zip(texts) {
        match body {
            Ok(bytes) => {
                found.commit.push(*at as u32);
                found.file.push((*file).to_owned());
                found.text.push(String::from_utf8_lossy(&bytes).into_owned());
            }
            Err(why) => {
                found.refused_commit.push(*at as u32);
                found.refused_file.push((*file).to_owned());
                found.refused.push(unread(&[&commits[*at]], &why));
            }
        }
    }
    Ok(found)
}

/// A blob to read, and where it stands, for the pointer a smudge is handed.
pub(crate) struct Blob<'a> {
    pub(crate) oid: &'a str,
    pub(crate) path: &'a str,
    pub(crate) commit: &'a str,
}

/// Each of `blobs`, in order, as the file it stands for, or git's reason for
/// not reading one of them.
pub(crate) fn contents(root: &str, blobs: &[Blob]) -> Result<Vec<Vec<u8>>, String> {
    each_content(root, blobs)?.into_iter().collect()
}

/// Each of `blobs`, in order, as the file it stands for or git's reason for
/// not reading that one. The outer error is a read that answered nothing.
pub(crate) fn each_content(root: &str, blobs: &[Blob]) -> Result<Vec<Result<Vec<u8>, String>>, String> {
    if blobs.is_empty() {
        return Ok(Vec::new());
    }
    let oids: Vec<&str> = blobs.iter().map(|blob| blob.oid).collect();
    let fetched = crate::promisor::fetch(root, &oids);
    let after_fetch = |why: String| match &fetched {
        Err(fetch) if fetch != &why => format!("{why} (the fetch before it: {fetch})"),
        _ => why,
    };
    let read = objects(root, &oids).map_err(after_fetch)?;
    Ok(blobs
        .iter()
        .zip(read)
        .map(|(blob, body)| match body {
            Ok(body) if crate::lfs::pointer(&body) => crate::lfs::smudge(root, blob.path, blob.commit, &body),
            Ok(body) => Ok(body),
            Err(why) => Err(after_fetch(why)),
        })
        .collect())
}

/// Why `commit` was not read when the checkout does not hold it, for a reader
/// in TypeScript that names the gap: [`absent`].
#[napi(catch_unwind)]
pub fn commit_absent(root: String, commit: String) -> Option<String> {
    absent(&root, &commit)
}

/// Why `commit` was not read when the checkout does not hold it, as a reason
/// that names the commit and how to fetch it, rather than what git failed to do
/// with it.
pub(crate) fn absent(root: &str, commit: &str) -> Option<String> {
    let known = git(root, &["cat-file", "-e", &format!("{commit}^{{commit}}")], None).is_some();
    (!known).then(|| {
        format!(
            "commit {} is not in this checkout's object store. \
             Fetch it with `git fetch origin {commit}`, or check out every commit: \
             `fetch-depth: 0` with `filter: tree:0` on `actions/checkout`",
            short(commit)
        )
    })
}

/// Each of `oids` from one `cat-file --batch`, in order. An object git answers
/// `missing` is that object's error; output that does not parse fails the read.
fn objects(root: &str, oids: &[&str]) -> Result<Vec<Result<Vec<u8>, String>>, String> {
    let asked: String = oids.iter().map(|oid| format!("{oid}\n")).collect();
    let out = answer(root, &["cat-file", "--batch"], Some(asked.into_bytes()))?;
    let cut = || "git cat-file --batch ended its answer early".to_owned();
    let mut read = Vec::with_capacity(oids.len());
    let mut at = 0;
    for _ in oids {
        let end = at + out.get(at..).ok_or_else(cut)?.iter().position(|&byte| byte == b'\n').ok_or_else(cut)?;
        let head = String::from_utf8_lossy(&out[at..end]).into_owned();
        at = end + 1;
        // `<object> missing` alone, or `<object> <type> <size>`, then the body and a newline.
        if head.ends_with(" missing") {
            read.push(Err(format!("git answered `{head}`")));
            continue;
        }
        let Some(Ok(size)) = head.rsplit(' ').next().map(str::parse::<usize>) else {
            return Err(format!("git answered `{head}`"));
        };
        read.push(Ok(out.get(at..at + size).ok_or_else(cut)?.to_vec()));
        at += size + 1;
    }
    Ok(read)
}

/// The blob `commit`'s tree names at each of `files` that is one. A path the
/// tree does not list, or lists as a directory or a submodule, names none. A
/// blobless clone holds the trees, so listing them fetches nothing; a treeless
/// one fetches them as git's lazy fetch does.
fn blobs(root: &str, commit: &str, files: &[String]) -> Result<HashMap<String, String>, String> {
    let mut oids = HashMap::new();
    for chunk in files.chunks(PATHS_PER_LISTING) {
        let mut args = vec!["--literal-pathspecs", "ls-tree", "-z", "--full-tree", commit, "--"];
        args.extend(chunk.iter().map(String::as_str));
        let listed = answer(root, &args, None)?;
        // `<mode> <type> <object>\t<path>`, and only a blob is a text.
        for entry in listed.split(|byte| *byte == 0) {
            let Some(tab) = entry.iter().position(|byte| *byte == b'\t') else {
                continue;
            };
            let mut fields = entry[..tab].split(|byte| *byte == b' ').skip(1);
            if fields.next() == Some(b"blob".as_slice()) {
                if let Some(oid) = fields.next() {
                    oids.insert(String::from_utf8_lossy(&entry[tab + 1..]).into_owned(), String::from_utf8_lossy(oid).into_owned());
                }
            }
        }
    }
    Ok(oids)
}
