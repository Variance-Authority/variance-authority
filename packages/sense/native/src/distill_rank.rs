//! The one order spills are read in: a scope's, which the addon answers in,
//! and a file's groups, which `@variance-authority/distill` asks for when it
//! writes them. It is an order over keys and names, not over the words that
//! head each group: those are JavaScript's (`packages/distill/src/own.ts`).

use std::cmp::Ordering;

use napi_derive::napi;

use crate::order::code_unit;

/// A cause's kind in the columns; `0` is a module read with no graph.
pub(crate) const IMPORT: u8 = 1;
pub(crate) const SHARED: u8 = 2;
pub(crate) const UNSEEN: u8 = 3;

/// One spill as it is ranked. `importer` is the module itself for kind `0`; both names are empty for the shared and the unseen.
pub(crate) struct Ranked<'a> {
    pub kind: u8,
    pub importer: &'a str,
    pub imported: &'a str,
    pub lazy: bool,
    pub lines: u64,
    pub files: usize,
}

/// Imports, then the shared, then the unseen; the heaviest first, then the
/// one over the most test files; then by importer, an eager import before a
/// lazy one, then by what is imported.
pub(crate) fn ranked(a: &Ranked, b: &Ranked) -> Ordering {
    let rank = |kind: u8| match kind {
        SHARED => 1,
        UNSEEN => 2,
        _ => 0,
    };
    rank(a.kind)
        .cmp(&rank(b.kind))
        .then_with(|| b.lines.cmp(&a.lines))
        .then_with(|| b.files.cmp(&a.files))
        .then_with(|| a.kind.cmp(&b.kind))
        .then_with(|| code_unit(a.importer, b.importer))
        .then_with(|| a.lazy.cmp(&b.lazy))
        .then_with(|| code_unit(a.imported, b.imported))
}

/// One group of a file's modules, as JavaScript holds it.
#[napi(object)]
pub struct DistillCause {
    /// `1` an import, `2` shared, `3` unseen.
    pub kind: u8,
    pub importer: String,
    pub imported: String,
    pub lazy: bool,
    pub lines: f64,
}

/// The places of `causes` in the order a scope's spills are read in, each group under one test file.
#[napi(catch_unwind)]
pub fn rank_distill_causes(causes: Vec<DistillCause>) -> Vec<u32> {
    fn ranked_of(cause: &DistillCause) -> Ranked<'_> {
        Ranked { kind: cause.kind, importer: &cause.importer, imported: &cause.imported, lazy: cause.lazy, lines: cause.lines as u64, files: 1 }
    }
    let mut order: Vec<u32> = (0..causes.len() as u32).collect();
    order.sort_by(|a, b| ranked(&ranked_of(&causes[*a as usize]), &ranked_of(&causes[*b as usize])));
    order
}

#[cfg(test)]
mod tests {
    use super::*;

    fn import<'a>(importer: &'a str, lazy: bool, imported: &'a str, lines: u64) -> Ranked<'a> {
        Ranked { kind: IMPORT, importer, imported, lazy, lines, files: 1 }
    }

    #[test]
    fn imports_rank_before_the_shared_and_the_unseen_however_light() {
        let shared = Ranked { kind: SHARED, importer: "", imported: "", lazy: false, lines: 100, files: 9 };
        let unseen = Ranked { kind: UNSEEN, importer: "", imported: "", lazy: false, lines: 100, files: 9 };
        assert_eq!(ranked(&import("a", false, "b", 1), &shared), Ordering::Less);
        assert_eq!(ranked(&shared, &unseen), Ordering::Less);
    }

    #[test]
    fn a_tie_reads_by_importer_then_an_eager_import_then_what_is_imported() {
        assert_eq!(ranked(&import("a", true, "a", 1), &import("b", false, "a", 1)), Ordering::Less);
        assert_eq!(ranked(&import("a", false, "z", 1), &import("a", true, "b", 1)), Ordering::Less);
        assert_eq!(ranked(&import("a", false, "b", 1), &import("a", false, "c", 1)), Ordering::Less);
    }
}
