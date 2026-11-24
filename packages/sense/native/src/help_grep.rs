//! ripgrep's search, over the files `grep` and `discover` already chose.
//!
//! The pattern language, BOM-sniffed encodings and binary detection come from
//! ripgrep's own crates. Binary files contribute no text rows. Hits
//! cross as columns, and a line is cut before it crosses: one match in a
//! minified bundle is a megabyte of line. The files are searched in the disk
//! reader's opening pool, not on every core: past a few threads at once, each
//! `open` costs more.
//!
//! A list of at least `STORE_CROSSOVER` files reads every tracked file the index
//! holds as unchanged out of git's object store (`git_store.rs`) and searches
//! those bytes as a reader, which is what `rg` does with a file it opens: the
//! same binary detection, the same BOM sniffing. Every other file is opened.
//! An untracked attributes file below the root that can rewrite a checkout is
//! looked for beside the search; finding one runs the search again from the
//! worktree.

// compass: variance-authority.report.agent-surface

use std::path::Path;

use grep_regex::{RegexMatcher, RegexMatcherBuilder};
use grep_searcher::{BinaryDetection, Searcher, SearcherBuilder, Sink, SinkMatch};
use napi_derive::napi;
use rayon::prelude::*;

use crate::acquire::opening_pool;
use crate::git_store::{Store, STORE_CROSSOVER};

/// Characters of a matching line kept before the cut.
const WIDEST: usize = 240;

/// Every matching line, a column per field, in the order the files were asked.
#[napi(object)]
pub struct Grepped {
    /// The position in the asked list of each hit's file.
    pub file: Vec<u32>,
    pub line: Vec<u32>,
    pub text: Vec<String>,
    /// One per file that could not be read, naming the file.
    pub errors: Vec<String>,
}

/// The matching lines of `files`, each relative to `root`, for one ripgrep pattern.
#[napi(js_name = "ripgrep")]
pub fn ripgrep(root: String, pattern: String, files: Vec<String>) -> napi::Result<Grepped> {
    match_lines(Path::new(&root), &pattern, &files).map_err(napi::Error::from_reason)
}

pub(crate) fn match_lines(root: &Path, pattern: &str, files: &[String]) -> Result<Grepped, String> {
    search(root, pattern, files, STORE_CROSSOVER).map(|(grepped, _)| grepped)
}

/// One file's matching lines, numbered, or why it could not be searched; and
/// whether its bytes came out of the store.
type Searched = (Result<Vec<(u32, String)>, String>, bool);

/// A file's text rows, discarded if the search engine detects binary data.
struct TextLines(Vec<(u32, String)>);

impl Sink for TextLines {
    type Error = std::io::Error;

    fn matched(&mut self, _searcher: &Searcher, matched: &SinkMatch<'_>) -> Result<bool, Self::Error> {
        let first = matched.line_number().unwrap();
        for (offset, bytes) in matched.lines().enumerate() {
            self.0.push(((first + offset as u64) as u32, shown(bytes)));
        }
        Ok(true)
    }

    fn binary_data(&mut self, _searcher: &Searcher, _offset: u64) -> Result<bool, Self::Error> {
        self.0.clear();
        Ok(false)
    }
}

/// The search, and how many files it read out of the store: none when `files`
/// is under `crossover`, which pays for no git call and no index.
fn search(root: &Path, pattern: &str, files: &[String], crossover: usize) -> Result<(Grepped, usize), String> {
    let matcher = RegexMatcherBuilder::new()
        .multi_line(true)
        .line_terminator(Some(b'\n'))
        // NUL marks binary data, so a pattern holding one cannot match text; `rg` refuses it.
        .ban_byte(Some(b'\0'))
        .build(pattern)
        .map_err(|error| format!("ripgrep refused the pattern: {error}"))?;
    let store = if files.len() >= crossover { Store::open(root) } else { None };
    let (searched, rewritten) = std::thread::scope(|scope| {
        let below = store.as_ref().map(|store| scope.spawn(|| store.rewritten_below(files)));
        let searched = each(root, &matcher, files, store.as_ref());
        (searched, below.is_some_and(|below| below.join().unwrap_or(true)))
    });
    // A rewrite the store cannot see makes its every answer suspect.
    let searched = if rewritten { each(root, &matcher, files, None) } else { searched };
    let mut grepped = Grepped { file: Vec::new(), line: Vec::new(), text: Vec::new(), errors: Vec::new() };
    let mut read = 0;
    for (at, (result, stored)) in searched.into_iter().enumerate() {
        read += usize::from(stored);
        match result {
            Ok(hits) => {
                for (line, text) in hits {
                    grepped.file.push(at as u32);
                    grepped.line.push(line);
                    grepped.text.push(text);
                }
            }
            Err(error) => grepped.errors.push(error),
        }
    }
    Ok((grepped, read))
}

/// Each file of `files` searched, out of `store` where it proves the bytes.
fn each(root: &Path, matcher: &RegexMatcher, files: &[String], store: Option<&Store>) -> Vec<Searched> {
    let search = || -> Vec<Searched> {
        files
            .par_iter()
            .map_init(
                || {
                    let searcher =
                        SearcherBuilder::new().line_number(true).binary_detection(BinaryDetection::quit(b'\0')).build();
                    (searcher, store.map(Store::reader))
                },
                |(searcher, reader), file| {
                    let mut hits = TextLines(Vec::new());
                    let fresh = store.and_then(|store| store.checked_out(file));
                    let stored = fresh.as_ref().zip(reader.as_mut()).and_then(|(fresh, reader)| reader.checkout_bytes(fresh));
                    let read = stored.is_some();
                    let searched = match stored {
                        Some(bytes) => searcher.search_reader(matcher, bytes, &mut hits),
                        None => searcher.search_path(matcher, root.join(file), &mut hits),
                    };
                    match searched {
                        Ok(()) => (Ok(hits.0), read),
                        Err(error) => (Err(format!("{file}: {error}")), read),
                    }
                },
            )
            .collect()
    };
    // Every search opens its file or inflates its blob, at the disk reader's width.
    match opening_pool(None, files.len()) {
        Ok(pool) => pool.install(search),
        Err(_) => search(),
    }
}

/// A matching line without its terminator, cut at `WIDEST`; bytes that are not UTF-8 read as U+FFFD.
fn shown(bytes: &[u8]) -> String {
    let bytes = bytes.strip_suffix(b"\n").unwrap_or(bytes);
    let bytes = bytes.strip_suffix(b"\r").unwrap_or(bytes);
    let text = String::from_utf8_lossy(bytes);
    match text.char_indices().nth(WIDEST) {
        Some((cut, _)) => format!("{}…", &text[..cut]),
        None => text.into_owned(),
    }
}

#[cfg(test)]
#[path = "help_grep_tests.rs"]
mod tests;
