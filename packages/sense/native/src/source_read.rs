//! A native source read, kept in its reader's own shape until it is indexed.

// compass: variance-authority.reach.source-index

use oxc_allocator::Allocator;
use serde::Serialize;

use crate::parse_columns::{ParseColumns, ParseRow, Span};
use crate::read::Read;
use crate::segment::{Collected, Strings};
use crate::source_size::Size;

#[derive(Clone, Debug, Serialize)]
#[serde(untagged)]
pub(crate) enum SourceRead {
    Module(Read),
    #[cfg(feature = "grammars")]
    Language(crate::languages::shape::Read),
}

#[derive(Clone, Copy)]
pub(crate) struct RequestRef<'a> {
    pub value: &'a str,
    pub kind: &'static str,
    pub guessed: bool,
    pub item: bool,
}

impl Default for SourceRead {
    fn default() -> Self { Self::Module(Read::default()) }
}

impl From<Read> for SourceRead {
    fn from(read: Read) -> Self { Self::Module(read) }
}

impl SourceRead {
    pub(crate) fn read(file: &str, source: &str, allocator: &Allocator, symbols: bool) -> Self {
        if crate::source_style::is_style(file) { return Self::Module(crate::source_style::read(file, source)) }
        if let Some(language) = language(file) {
            #[cfg(feature = "grammars")]
            if let Some(read) = crate::languages::read(language, file, source) { return Self::Language(read) }
            return Self::unreadable(format!("{file} is {language}, and the native addon on this machine was built without the tree-sitter grammars, so what it asks for is unknown."));
        }
        Self::Module(crate::read::read_module(file, source, allocator, symbols))
    }

    pub(crate) fn unreadable(reason: String) -> Self {
        Self::Module(Read { unknown: Some(reason), ..Read::default() })
    }

    pub(crate) fn requests(&self) -> impl ExactSizeIterator<Item = RequestRef<'_>> {
        (0..self.request_count()).map(|at| self.request(at))
    }

    fn request_count(&self) -> usize {
        match self {
            Self::Module(read) => read.requests.len(),
            #[cfg(feature = "grammars")]
            Self::Language(read) => read.requests.len(),
        }
    }

    fn request(&self, at: usize) -> RequestRef<'_> {
        match self {
            Self::Module(read) => {
                let request = &read.requests[at];
                RequestRef { value: &request.value, kind: request.kind.as_str(), guessed: false, item: false }
            }
            #[cfg(feature = "grammars")]
            Self::Language(read) => {
                let request = &read.requests[at];
                RequestRef { value: &request.value, kind: request.kind.as_str(), guessed: request.guessed, item: request.item }
            }
        }
    }

    pub(crate) fn module(&self) -> Option<&Read> {
        match self {
            Self::Module(read) => Some(read),
            #[cfg(feature = "grammars")]
            Self::Language(_) => None,
        }
    }

    #[cfg(feature = "grammars")]
    pub(crate) fn language(&self) -> Option<&crate::languages::shape::Read> {
        match self { Self::Language(read) => Some(read), _ => None }
    }

    pub(crate) fn declares(&self) -> &[String] { self.module().map_or(&[], |read| read.declares.as_slice()) }
    pub(crate) fn unknown(&self) -> Option<&str> { ParseRow::unknown(self) }
    pub(crate) fn size(&self) -> Option<Size> { ParseRow::size(self) }
}

pub(crate) fn language(file: &str) -> Option<&'static str> {
    match std::path::Path::new(file).extension().and_then(|part| part.to_str()) {
        Some("py" | "pyi") => Some("python"),
        Some("rs") => Some("rust"),
        Some("java") => Some("java"),
        Some("kt" | "kts") => Some("kotlin"),
        Some("swift") => Some("swift"),
        _ => None,
    }
}

macro_rules! either {
    ($self:ident, $row:ident => $body:expr) => {
        match $self {
            SourceRead::Module($row) => $body,
            #[cfg(feature = "grammars")]
            SourceRead::Language($row) => $body,
        }
    };
}

impl ParseRow for SourceRead {
    fn strings<'s>(&'s self, into: &mut Collected<'s>) { either!(self, row => row.strings(into)) }
    fn write<'text>(&'text self, strings: &Strings, into: &mut ParseColumns<'text>) { either!(self, row => row.write(strings, into)) }
    fn exports_present(&self) -> bool { either!(self, row => row.exports_present()) }
    fn declares_present(&self) -> bool { either!(self, row => row.declares_present()) }
    fn unknown(&self) -> Option<&str> { either!(self, row => row.unknown()) }
    fn harvested(&self) -> bool { either!(self, row => row.harvested()) }
    fn size(&self) -> Option<Size> { either!(self, row => row.size()) }
    fn doc(&self) -> Span<'_> { either!(self, row => row.doc()) }
    fn words(&self, item: crate::name_table::Item, at: usize) -> Option<Option<std::borrow::Cow<'_, str>>> { either!(self, row => row.words(item, at)) }
}
