//! Which reader a file is read by, and which resolution its requests take:
//! `languageOf` in `language.ts` and `readerFor` in `record.ts`, so a native
//! read answers a file of every language the JavaScript route reads.

// compass: variance-authority.reach.source-index

use oxc_allocator::Allocator;

use crate::read::{read_module, Read};

/// A language some reader claims, as `LanguageId` in `language.ts` names it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Language {
    Module,
    Style,
}

/// The language a path is read as, by the extension its name ends in, or
/// nothing when no reader claims it.
pub(crate) fn language_of(file: &str) -> Option<Language> {
    let name = file.rsplit('/').next().unwrap_or(file);
    let extension = &name[name.rfind('.')?..];
    match extension {
        ".ts" | ".tsx" | ".mts" | ".cts" | ".js" | ".jsx" | ".mjs" | ".cjs" => Some(Language::Module),
        ".css" | ".scss" | ".sass" | ".less" => Some(Language::Style),
        _ => None,
    }
}

/// One file's read, by the reader its language names. A path no reader
/// claims is read as a module, as the batch always has.
pub(crate) fn read_file(file: &str, source: &str, allocator: &Allocator, symbols: bool) -> Read {
    match language_of(file) {
        Some(Language::Style) => crate::style::read_style(source),
        Some(Language::Module) | None => read_module(file, source, allocator, symbols),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_name_takes_the_language_of_its_last_extension() {
        assert_eq!(language_of("a/b.module.css"), Some(Language::Style));
        assert_eq!(language_of("a/b.d.ts"), Some(Language::Module));
        assert_eq!(language_of("a.d/b"), None);
        assert_eq!(language_of("a/README"), None);
    }

    #[test]
    fn a_stylesheet_is_read_as_one() {
        let read = read_file("a.scss", "@use './b';", &Allocator::default(), true);
        assert_eq!(read.requests.len(), 1);
        assert_eq!(read.requests[0].kind, crate::read::Kind::Asset);
        assert!(read.harvested);
    }
}
