//! Sense's probes, for a transform pipeline written in Rust.
//!
//! `@variance-authority/sense` records which regions of which module a test
//! ran by placing a probe in front of each region before the module runs. This
//! crate is the code that places them, the same code the package's addon runs:
//! it ships inside the npm package, at
//! `node_modules/@variance-authority/sense/native/instrument`, so a project that
//! has sense installed has the crate, at the version its runtime expects.
//!
//! ```toml
//! [dependencies]
//! variance-sense-instrument = { path = "node_modules/@variance-authority/sense/native/instrument" }
//! ```
//!
//! [`instrument`] takes a module's text as it is on disk and returns the text
//! with the probes in it. Run it first, before your own pipeline parses: the
//! probes are plain JavaScript statements and calls, every insertion keeps its
//! line, and the text stays the language it was, so swc, oxc or anything else
//! reads it as it read the original. Sense's Jest transformer hands your
//! transformer the arguments, and checks your build against its own with
//! [`recipe`]: see the package's Jest documentation.
//!
//! A probe is only evidence under the instrumentation it was placed with, so
//! the crate takes no options beyond the [`Mode`]: what it writes is what the
//! collectors read.

mod cut;
/// The digest every stored text is named by; [`module_id`] is the one a
/// pipeline needs.
#[doc(hidden)]
pub mod digest;
mod header;
mod walk;

pub use header::EVALUATING;

/// How many regions a module is cut into.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum Mode {
    /// Every region with its own arrival condition: each branch, loop body,
    /// handler and continuation, as well as each function and the module.
    #[default]
    Presence,
    /// The module and each function, and nothing inside them.
    Entries,
}

impl Mode {
    /// The identity a recording made under this mode is stored under.
    /// `instrumentationId()` in `src/instrument/index.ts` answers the same.
    pub const fn instrumentation(self) -> &'static str {
        match self {
            Mode::Presence => "sense:instrument/presence-v5",
            Mode::Entries => "sense:instrument/entries-v2",
        }
    }

    /// The mode an identity names, or nothing for one this build does not emit.
    pub fn of_instrumentation(instrumentation: &str) -> Option<Mode> {
        [Mode::Presence, Mode::Entries].into_iter().find(|mode| mode.instrumentation() == instrumentation)
    }
}

/// One module with its probes in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Instrumented {
    /// The source with the header and every probe in it, on the same lines.
    pub code: String,
    /// The digest of the source the probes were placed on.
    pub source_digest: String,
    /// [`Mode::instrumentation`] of the mode it was cut under.
    pub instrumentation: &'static str,
    /// How many regions it was cut into; the module itself is the first.
    pub regions: u32,
}

/// Place the probes in one module.
///
/// `file` is the module's path, and only its extension is read: it decides
/// whether the text is parsed as TypeScript, JSX or both. `module` is the id
/// the probes report, from [`module_id`] or from the transformer that asked.
///
/// Nothing when the source does not parse: a module whose regions are unknown
/// runs as it is and is reported as not instrumented, never as not executed.
pub fn instrument(source: &str, file: &str, module: &str, mode: Mode) -> Option<Instrumented> {
    let mut cut = cut::cut(source, file, mode == Mode::Entries)?;
    let regions = cut.blocks.len() as u32;
    cut.code.insert_str(cut.header_byte, &header::header(module, cut.blocks.len()));
    Some(Instrumented {
        code: cut.code,
        source_digest: cut.source_digest,
        instrumentation: mode.instrumentation(),
        regions,
    })
}

/// The id a module's probes report: its path from the project root, with `/`
/// between segments, and the digest of the text the probes were placed on.
///
/// The reporter cuts the module again from the file whose text has that
/// digest, so a path that is not the file's, or a text that is not the one
/// handed to [`instrument`], is a module nothing can read back.
pub fn module_id(path: &str, source: &str) -> String {
    let digest = digest::of_string(source);
    let hex = &digest[digest.find(':').map_or(0, |colon| colon + 1)..];
    format!("{path}@{hex}")
}

/// What this build writes under `mode`: the identity and the header's own
/// digest. Two builds with one recipe place the same probes on the same text.
pub fn recipe(mode: Mode) -> String {
    format!("{}+{}", mode.instrumentation(), digest::of_string(&header::header("", 0)))
}

/// What the package's addon needs and a pipeline does not: the regions
/// themselves, and the walk over a program the scanner already parsed.
#[doc(hidden)]
pub mod native {
    use oxc_ast::ast::Program;

    pub use crate::cut::{cut, Cut};
    pub use crate::header::header;
    pub use crate::walk::{Block, Kind};

    /// How many regions with source of their own a parsed program is cut into
    /// under `presence`.
    pub fn source_regions(program: &Program, typescript: bool) -> u32 {
        let walker = crate::cut::walk(program, typescript, false);
        walker.blocks.iter().filter(|block| block.end > block.start).count() as u32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_header_goes_after_the_prologue_and_the_probes_stay_on_their_lines() {
        let source = "import a from './a';\nexport function f(x) {\n  if (x) return a;\n  return 0;\n}\n";
        let out = instrument(source, "f.js", "src/f.js@00", Mode::Presence).expect("it parses");
        assert_eq!(out.code.lines().count(), source.lines().count());
        assert!(out.code.starts_with("import a from './a';\nvar __vaK"));
        assert!(out.code.contains(".r(\"src/f.js@00\",5);"));
        assert_eq!(out.regions, 5);
        assert_eq!(out.instrumentation, "sense:instrument/presence-v5");
    }

    #[test]
    fn entries_cuts_only_the_module_and_its_functions() {
        let source = "export function f(x) { if (x) return 1; return 0 }\n";
        assert_eq!(instrument(source, "f.js", "f", Mode::Entries).map(|out| out.regions), Some(2));
    }

    #[test]
    fn a_source_that_does_not_parse_is_not_instrumented() {
        assert_eq!(instrument("export const = ;", "f.ts", "f", Mode::Presence), None);
    }

    #[test]
    fn a_module_id_is_the_path_and_the_hex_of_the_text_digest() {
        assert_eq!(module_id("src/a.ts", ""), "src/a.ts@e3b0c44298fc1c149afbf4c8996fb924");
    }

    #[test]
    fn a_mode_is_named_by_its_identity_and_back() {
        for mode in [Mode::Presence, Mode::Entries] {
            assert_eq!(Mode::of_instrumentation(mode.instrumentation()), Some(mode));
        }
        assert_eq!(Mode::of_instrumentation("sense:instrument/presence-v4"), None);
    }

    #[test]
    fn a_recipe_differs_by_mode() {
        assert_ne!(recipe(Mode::Presence), recipe(Mode::Entries));
    }
}
