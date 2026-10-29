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

mod cadence;
mod cadence_map;
#[cfg_attr(not(feature = "addon"), allow(dead_code))]
mod carry;
mod crossing;
mod cut;
mod dialect;
mod fault;
/// The digest every stored text is named by; [`module_id`] is the one a
/// pipeline needs.
#[doc(hidden)]
pub mod digest;
mod header;
#[cfg_attr(not(feature = "addon"), allow(dead_code))]
mod place;
mod walk;

pub use cadence::{cadence, Cadence};
pub use fault::faulted;
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
            Mode::Presence => "sense:instrument/presence-v6",
            Mode::Entries => "sense:instrument/entries-v3",
        }
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
/// whether the text is parsed as TypeScript, JSX or both, and JavaScript is
/// always read with JSX. `module` is the id the probes report, from
/// [`module_id`] or from the transformer that asked.
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

/// What this build writes under `mode`: the identity, and one digest of the
/// header and of the sources and manifest the crate was compiled from. Two
/// builds with one recipe place the same probes on the same text.
pub fn recipe(mode: Mode) -> String {
    let made = format!("{}\0{}", header::header("", 0), env!("SENSE_INSTRUMENT_SOURCES"));
    format!("{}+{}", mode.instrumentation(), digest::of_string(&made))
}

/// What the package's addon needs and a pipeline does not: the regions
/// themselves, and the walk over a program the scanner already parsed.
#[cfg(feature = "addon")]
#[doc(hidden)]
pub mod native {
    use oxc_ast::ast::Program;

    pub use crate::cut::{cut, Cut};
    pub use crate::dialect::dialect;
    pub use crate::header::header;
    pub use crate::place::{place, Placed};
    pub use crate::walk::{Block, Kind};
    pub use crate::walk::capture::{bound, declared, Erased};

    /// How many regions with source of their own a parsed program is cut into
    /// under `presence`.
    pub fn source_regions<'a>(program: &'a Program<'a>, typescript: bool) -> u32 {
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
        assert_eq!(out.instrumentation, "sense:instrument/presence-v6");
    }

    #[test]
    fn entries_cuts_only_the_module_and_its_functions() {
        let source = "export function f(x) { if (x) return 1; return 0 }\n";
        assert_eq!(instrument(source, "f.js", "f", Mode::Entries).map(|out| out.regions), Some(2));
    }

    #[test]
    fn a_function_handed_to_a_page_crosses_without_probes_and_its_caller_keeps_them() {
        let source = "function probe() { if (document.hidden) return 0; return 1 }\nexport function f(page) {\n  if (!page) return;\n  return page.evaluate(() => { if (window.x) return 2; return probe() }) ?? page.evaluate(probe);\n}\n";
        let out = instrument(source, "f.ts", "f", Mode::Presence).expect("it parses");
        assert!(out.code.contains("function probe() { if (document.hidden) return 0; return 1 }"));
        assert!(out.code.contains("() => { if (window.x) return 2; return probe() }"));
        // The module, `f`, and both branches of `if (!page)` and what follows it.
        assert_eq!(out.regions, 5);
        let entries = instrument(source, "f.ts", "f", Mode::Entries).expect("it parses");
        assert_eq!(entries.regions, 2);
    }

    #[test]
    fn a_declaration_handed_to_a_page_is_entered_with_the_function_that_declares_it() {
        let source = "export function f(page, x) {\n  page.evaluate(probe);\n  if (x) return;\n  function probe() { return 1 }\n}\n";
        let out = cut::cut(source, "f.ts", false).expect("it parses");
        assert!(out.code.contains("function probe() { return 1 }"));
        let entry = out.blocks.iter().position(|block| block.name == "f").expect("f has a region");
        let probe = out.blocks.iter().position(|block| block.name == "f/probe").expect("the declaration has a region");
        assert_eq!(out.blocks[probe].owner, Some(entry as u32));
        // Probed where `f`'s statements start, ahead of the return that skips its text.
        assert!(out.code.contains(&format!("__va({probe});page.evaluate(probe);")));
        // The entries walk has no region the text could sit in but `f`'s own.
        let entries = cut::cut(source, "f.ts", true).expect("it parses");
        assert_eq!(entries.blocks.len(), 2);
    }

    #[test]
    fn a_declaration_in_one_case_is_entered_with_the_switch_that_holds_every_case() {
        let source = "export function f(page, x) {\n  switch (x) {\n    case 1: return page.evaluate(probe);\n    default: function probe() { return 1 }\n  }\n}\n";
        let out = cut::cut(source, "f.ts", false).expect("it parses");
        assert!(out.code.contains("function probe() { return 1 }"));
        let entry = out.blocks.iter().position(|block| block.name == "f").expect("f has a region");
        let probe = out.blocks.iter().position(|block| block.name == "f/probe").expect("the declaration has a region");
        assert_eq!(out.blocks[probe].owner, Some(entry as u32));
        // Probed as the switch is reached, before any case is chosen.
        assert!(out.code.contains(&format!("switch (__va({probe}),x)")));
        // Ahead of an `await` the discriminant opens with, outside what it resumes with.
        let source = "outer: switch (await page.kind) {\n  case 1: page.evaluate(probe); break outer;\n  default: function probe() { return 1 }\n}\n";
        let out = cut::cut(source, "f.ts", false).expect("it parses");
        let probe = out.blocks.iter().position(|block| block.name == "probe").expect("the declaration has a region");
        assert!(out.code.contains(&format!("outer: switch (__va({probe}),__vaR(await page.kind")));
    }

    #[test]
    fn a_module_probes_its_crossing_declaration_after_its_imports_and_ahead_of_an_await() {
        let source = "import { page } from './page';\nawait page.evaluate(probe);\nif (page.closed) throw 0;\nexport function probe() { return 1 }\n";
        let out = cut::cut(source, "f.ts", false).expect("it parses");
        let probe = out.blocks.iter().position(|block| block.name == "probe").expect("the declaration has a region");
        assert_eq!(out.blocks[probe].owner, Some(0));
        let at = out.code.find(&format!("__va({probe});__vaR(await page.evaluate(probe)")).expect("probed ahead of the await");
        assert!(out.code.find("import { page }").expect("the import stays") < at);
    }

    #[test]
    fn an_anonymous_crossing_function_keeps_its_number_so_the_next_one_keeps_its_name() {
        let names = |source: &str| -> Vec<String> {
            cut::cut(source, "f.ts", false).expect("it parses").blocks.into_iter().map(|block| block.name).collect()
        };
        let plain = names("page.other((() => 1) as () => number);\n[() => 2];\n");
        assert_eq!(plain, ["", "anon#0", "anon#1"]);
        let crossing = names("page.evaluate((() => 1) as () => number);\n[() => 2];\n");
        assert_eq!(crossing, ["", "anon#1"]);
    }

    #[test]
    fn a_javascript_module_with_jsx_is_instrumented() {
        let source = "export function A(props) {\n  if (props.x) return <b />;\n  return <i />;\n}\n";
        let regions = |file| instrument(source, file, "A", Mode::Presence).map(|out| out.regions);
        assert_eq!(regions("A.js"), regions("A.jsx"));
        assert!(regions("A.js").is_some());
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
    fn a_recipe_differs_by_mode() {
        assert_ne!(recipe(Mode::Presence), recipe(Mode::Entries));
    }
}
