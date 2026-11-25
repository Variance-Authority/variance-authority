//! `symbol` and `uses` answered for the help tools by the same reading the
//! standalone executable answers them with, over the store the tools hold.

// compass: variance-authority.report.agent-surface

use std::io::Cursor;
use std::path::Path;

use napi::bindgen_prelude::Uint8Array;
use napi_derive::napi;

use crate::help_publish::{opened_chain, OpenedIndex};
use crate::help_surface::Surface;
use crate::help_symbol_answer::{self, exact_symbols};
use crate::help_uses_answer::{self, uses};

/// One name as `symbol` or `uses` is asked about it.
#[napi(object)]
pub struct NameAsked {
    pub name: String,
    /// The package to answer from, by name or by specifier.
    pub package: Option<String>,
    /// The file `uses` orders its sites nearest to.
    pub from: Option<String>,
    /// The file whose declaration `uses` answers for alone.
    pub file: Option<String>,
    /// The rows of each list to show; `symbol` cuts at its own when unsaid.
    pub limit: Option<u32>,
    /// The words a question starts with in a shell; a wire host has none.
    pub shell: Option<String>,
}

/// An answer, and whether it is that nothing declares the name.
#[napi(object)]
pub struct NameAnswer {
    pub text: String,
    pub found: bool,
}

impl NameAnswer {
    fn of(answer: Result<String, String>) -> Self {
        match answer {
            Ok(text) => Self { text, found: true },
            Err(text) => Self { text, found: false },
        }
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
    Ok(opened_chain(index, |layers| {
        let asking = help_symbol_answer::Asking {
            root: &root,
            lexicon: lexicon.as_deref()?,
            layers,
            wanted: asked.package.as_deref(),
            limit: asked.limit.map(|limit| limit as usize),
            surface: Surface(asked.shell.as_deref()),
        };
        let mut answers = exact_symbols(&asking, &mut Cursor::new(&store[..]), &[&asked.name])?;
        answers.pop().map(NameAnswer::of)
    })?.flatten())
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
            from: asked.from.as_deref(),
            file: asked.file.as_deref(),
            limit: asked.limit? as usize,
            surface: Surface(asked.shell.as_deref()),
        };
        uses(&asking, &mut Cursor::new(&store[..])).map(NameAnswer::of)
    })?.flatten())
}
