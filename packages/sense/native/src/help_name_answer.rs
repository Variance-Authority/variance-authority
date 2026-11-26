//! `symbol` and `uses` answered for the help tools by the same reading the
//! standalone executable answers them with, over the store the tools hold.

// compass: variance-authority.report.agent-surface

use std::cell::RefCell;
use std::io::Cursor;
use std::path::Path;

use napi::bindgen_prelude::Uint8Array;
use napi_derive::napi;

use crate::help_publish::{opened_chain, OpenedIndex};
use crate::help_surface::Surface;
use crate::help_symbol_answer::{self, exact_symbols, Declared, SymbolAnswer};
use crate::help_symbol_line::{at_line, Recorded};
use crate::help_uses_answer::{self, uses, Listed};

/// One name as `symbol` or `uses` is asked about it.
#[napi(object)]
pub struct NameAsked {
    pub name: String,
    /// The package to answer from, by name or by specifier.
    pub package: Option<String>,
    /// The paths the question stands at: `symbol` orders its declarations
    /// nearest to them and answers installed names as they resolve there, and
    /// `uses` orders its sites nearest to the first.
    pub from: Option<Vec<String>>,
    /// The file whose declaration `uses` answers for alone.
    pub file: Option<String>,
    /// The rows of each list to show; `symbol` cuts at its own when unsaid.
    pub limit: Option<u32>,
    /// The words a question starts with in a shell; a wire host has none.
    pub shell: Option<String>,
    /// `<file>:<line>`, the line `symbol` orders the declarations by.
    pub line: Option<String>,
    /// The recordings the declarations are ordered by, as the host finds them.
    pub recorded: Option<Vec<Recorded>>,
}

/// An answer, whether it is that nothing declares the name, and the files of
/// the checkout it reads.
#[napi(object)]
pub struct NameAnswer {
    pub text: String,
    pub found: bool,
    /// The files the answer lists, each at its lines: for `symbol` every file
    /// of the checkout that declares the name, for `uses` every file it
    /// lists; absent for `symbol` when no file of the checkout declares it.
    pub files: Option<Vec<FileLines>>,
    /// `symbol`'s: every name each `file:line` of `files` is written by.
    pub spelled: Option<Vec<Spelled>>,
    /// What was not read, so a file it would list may be missing.
    pub unread: Vec<String>,
    /// `symbol`'s, when no file of the checkout declares the name: the answer saying so.
    pub absent: Option<String>,
    /// Every file the answer rests on, to look at for a change; absent when it rests on none.
    pub rests_on: Option<Vec<String>>,
}

/// One file and its lines.
#[napi(object)]
pub struct FileLines {
    pub file: String,
    pub lines: Vec<u32>,
}

/// The names one `file:line` is written by.
#[napi(object)]
pub struct Spelled {
    pub at: String,
    pub names: Vec<String>,
    /// The last line of the head the source index cut for the declaration there, when it kept one.
    pub through: Option<u32>,
}

fn file_lines(files: Vec<(String, Vec<u32>)>) -> Vec<FileLines> {
    files.into_iter().map(|(file, lines)| FileLines { file, lines }).collect()
}

impl NameAnswer {
    fn symbol(answer: SymbolAnswer) -> Self {
        let SymbolAnswer { text, found, declared, rests_on } = answer;
        match declared {
            Ok(Declared { files, spelled, heads, unread }) => Self {
                text, found, files: Some(file_lines(files)), unread, absent: None, rests_on,
                spelled: Some(spelled.into_iter().zip(heads).map(|((at, names), through)| Spelled { at, names, through }).collect()),
            },
            Err(absent) => Self { text, found, files: None, spelled: None, unread: Vec::new(), absent: Some(absent), rests_on },
        }
    }

    fn uses(answer: Result<String, String>, listed: Listed) -> Self {
        let (text, found) = match answer { Ok(text) => (text, true), Err(text) => (text, false) };
        let rests_on = Some(listed.printed());
        Self { text, found, files: Some(file_lines(listed.files())), spelled: None, unread: listed.unread, absent: None, rests_on }
    }
}

/// `symbol`'s answer about `asked.name` in the checkout at `root`, read from
/// the help store `store` and the chain `index` holds; `None` when there is
/// no index or the answer needs the reading only the tool carries.
///
/// bound: the help store JavaScript already holds, lent without a copy, and one answer whose lists are cut at the limit
#[napi(catch_unwind)]
pub fn answer_symbol(root: String, index: &OpenedIndex, store: Uint8Array, asked: NameAsked) -> napi::Result<Option<NameAnswer>> {
    let lexicon = Path::new(index.path()).parent().map(Path::to_path_buf);
    opened_chain(index, |layers| {
        let asking = help_symbol_answer::Asking {
            root: &root,
            lexicon: lexicon.as_deref()?,
            layers,
            wanted: asked.package.as_deref(),
            from: asked.from.as_deref().unwrap_or_default(),
            limit: asked.limit.map(|limit| limit as usize),
            surface: Surface(asked.shell.as_deref()),
        };
        exact_symbols(&asking, &mut Cursor::new(&store[..]), &[&asked.name])?.pop()
    })?.flatten().map(|mut answer| {
        if let Some(line) = &asked.line {
            let recorded = asked.recorded.as_deref().unwrap_or_default();
            answer.text = at_line(&root, &[&asked.name], line, std::slice::from_ref(&answer), recorded).map_err(napi::Error::from_reason)?;
        }
        Ok(NameAnswer::symbol(answer))
    }).transpose()
}

/// `uses`'s answer about `asked.name`, read as [`answer_symbol`] reads, and
/// cut at `asked.limit`, which the tool always says.
///
/// bound: the help store JavaScript already holds, lent without a copy, and one answer whose lists are cut at `asked.limit`
#[napi(catch_unwind)]
pub fn answer_uses(root: String, index: &OpenedIndex, store: Uint8Array, asked: NameAsked) -> napi::Result<Option<NameAnswer>> {
    Ok(opened_chain(index, |layers| {
        let asking = help_uses_answer::Asking {
            root: &root,
            layers,
            name: &asked.name,
            wanted: asked.package.as_deref(),
            from: asked.from.as_deref().and_then(<[String]>::first).map(String::as_str),
            file: asked.file.as_deref(),
            limit: asked.limit? as usize,
            surface: Surface(asked.shell.as_deref()),
            listed: RefCell::default(),
        };
        let answer = uses(&asking, &mut Cursor::new(&store[..]))?;
        Some(NameAnswer::uses(answer, asking.listed.into_inner()))
    })?.flatten())
}
