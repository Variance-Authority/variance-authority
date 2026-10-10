//! The dialect a source file is read in, by its extension.

use oxc_span::SourceType;

/// The dialect a source file is read in.
///
/// The extension alone leaves JSX off for `.js`, `.mjs` and `.cjs`, where most
/// React components written in JavaScript live, and an element there is a parse
/// error that leaves the file with no edges and no probes. Only those three are
/// widened: `.ts` keeps its own dialect, because `<string>value` is a cast there.
///
/// The probes and the addon's readers parse with this one rule, so a region a
/// recording names is the region a reader finds.
pub fn dialect(file: &str) -> Option<SourceType> {
    let source_type = SourceType::from_path(file).ok()?;
    let widened = [".js", ".mjs", ".cjs"].iter().any(|end| file.ends_with(end));
    Some(if widened { source_type.with_jsx(true) } else { source_type })
}
