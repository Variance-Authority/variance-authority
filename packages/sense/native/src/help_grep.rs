//! ripgrep's search, over the files `grep` and `discover` already chose.
//!
//! The pattern language, the BOM-sniffed encodings and the binary detection
//! are ripgrep's own crates, configured as `rg` configures them for files named
//! on its command line, so a query matches here what it matches there. Hits
//! cross as columns, and a line is cut before it crosses: one match in a
//! minified bundle is a megabyte of line.

// compass: variance-authority.report.agent-surface

use std::path::Path;

use grep_regex::RegexMatcherBuilder;
use grep_searcher::{sinks::Bytes, BinaryDetection, SearcherBuilder};
use napi_derive::napi;
use rayon::prelude::*;

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
    let matcher = RegexMatcherBuilder::new()
        .multi_line(true)
        .line_terminator(Some(b'\n'))
        // Binary detection turns NUL into a line break, so a pattern holding one never matches; `rg` refuses it.
        .ban_byte(Some(b'\0'))
        .build(&pattern)
        .map_err(|error| napi::Error::from_reason(format!("ripgrep refused the pattern: {error}")))?;
    let root = Path::new(&root);
    let searched: Vec<Result<Vec<(u32, String)>, String>> = files
        .par_iter()
        .map_init(
            || SearcherBuilder::new().line_number(true).binary_detection(BinaryDetection::convert(b'\0')).build(),
            |searcher, file| {
                let mut hits = Vec::new();
                let sink = Bytes(|line, bytes| {
                    hits.push((line as u32, shown(bytes)));
                    Ok(true)
                });
                match searcher.search_path(&matcher, root.join(file), sink) {
                    Ok(()) => Ok(hits),
                    Err(error) => Err(format!("{file}: {error}")),
                }
            },
        )
        .collect();
    let mut grepped = Grepped { file: Vec::new(), line: Vec::new(), text: Vec::new(), errors: Vec::new() };
    for (at, result) in searched.into_iter().enumerate() {
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
    Ok(grepped)
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
