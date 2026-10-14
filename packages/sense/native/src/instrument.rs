//! `instrument`: the instrumenter crate's cut, as columns for JavaScript.
//!
//! The tree never leaves the arena: what crosses is the instrumented text and one
//! column per block field, which `src/instrument/spliced.ts` turns back into
//! blocks. There is no JavaScript walk to fall back to, so a platform without this
//! addon does not record. The cut and the header are
//! [`variance_sense_instrument`]'s, which a Rust pipeline calls directly.

use napi::bindgen_prelude::{Buffer, Uint32Array};
use napi_derive::napi;
use variance_sense_instrument::native::{cut_with, header};

/// The integration's source-consuming import and callee path.
#[napi(object)]
pub struct SourceConsumed {
    pub module: String,
    pub imported: String,
    pub path: Option<Vec<String>>,
    pub syntax: String,
    pub arguments: Option<Vec<f64>>,
}

fn source_consumers(input: Option<Vec<SourceConsumed>>) -> napi::Result<Vec<variance_sense_instrument::SourceConsumed>> {
    use variance_sense_instrument::{SourceConsumed as Rule, ConsumerStep, Consumption};
    input.unwrap_or_default().into_iter().map(|rule| {
        let invalid = |message: &str| napi::Error::from_reason(format!("sourceConsumed: {message}"));
        if rule.module.is_empty() || rule.imported.is_empty() { return Err(invalid("module and imported must be nonempty")); }
        let path = rule.path.unwrap_or_default().iter().map(|step| match step.as_str() {
            "member" => Ok(ConsumerStep::Member),
            "call" => Ok(ConsumerStep::Call),
            _ => Err(invalid("path steps must be member or call")),
        }).collect::<napi::Result<Vec<_>>>()?;
        let arguments = rule.arguments.map(|args| args.into_iter().map(|index| {
            if !index.is_finite() || index < 0.0 || index > u32::MAX as f64 || index.fract() != 0.0 {
                Err(invalid("argument indices must be nonnegative integers"))
            } else { Ok(index as u32) }
        }).collect::<napi::Result<Vec<_>>>()).transpose()?;
        let syntax = match rule.syntax.as_str() {
            "arguments" => Consumption::Arguments(arguments),
            "template" if arguments.is_none() => Consumption::Template,
            _ => return Err(invalid("syntax must be arguments or template; only arguments accepts argument indices")),
        };
        Ok(Rule { module: rule.module, imported: rule.imported, path, syntax })
    }).collect()
}

/// One module's instrumentation, as columns: one entry per block, in ordinal order.
#[napi(object)]
pub struct Instrumented {
    pub code: String,
    /// Where the header goes in `code`, or starts when it is already there, in
    /// UTF-16 code units.
    pub header_at: u32,
    pub source_digest: String,
    /// `BlockKind`, by its position in `KINDS`.
    pub kinds: Buffer,
    /// The owning block's ordinal; `0xffffffff` on the module root, which has none.
    pub owners: Uint32Array,
    pub starts: Uint32Array,
    pub ends: Uint32Array,
    pub names: Vec<String>,
    pub paths: Vec<String>,
    pub digests: Vec<String>,
}

/// `instrument()` from `src/instrument/index.ts`, or `null` where it must answer.
///
/// With a `module`, the header that reports under it is in `code`; without one
/// the text has only the probes, which is what the walk's golden answers hold.
#[napi(js_name = "instrument", catch_unwind)]
pub fn instrument_module(source: String, file: String, entries: bool, module: Option<String>, source_consumed: Option<Vec<SourceConsumed>>) -> napi::Result<Option<Instrumented>> {
    let rules = source_consumers(source_consumed)?;
    let Some(mut out) = cut_with(&source, &file, entries, &rules) else { return Ok(None) };
    if let Some(module) = module {
        out.code.insert_str(out.header_byte, &header(&module, out.blocks.len()));
    }
    let count = out.blocks.len();
    let (mut kinds, mut owners, mut starts, mut ends) =
        (Vec::with_capacity(count), Vec::with_capacity(count), Vec::with_capacity(count), Vec::with_capacity(count));
    let (mut names, mut paths) = (Vec::with_capacity(count), Vec::with_capacity(count));
    for block in out.blocks {
        kinds.push(block.kind as u8);
        owners.push(block.owner.unwrap_or(u32::MAX));
        starts.push(block.start);
        ends.push(block.end);
        names.push(block.name);
        paths.push(block.path);
    }
    Ok(Some(Instrumented {
        code: out.code,
        header_at: out.header_at,
        source_digest: out.source_digest,
        kinds: kinds.into(),
        owners: Uint32Array::new(owners),
        starts: Uint32Array::new(starts),
        ends: Uint32Array::new(ends),
        names,
        paths,
        digests: out.digests,
    }))
}

/// The header one module carries, for a caller that writes a module by hand.
#[napi(js_name = "probeHeader")]
pub fn probe_header(module: String, count: u32) -> String {
    header(&module, count as usize)
}

/// What this build writes under a mode: `recipe()` of the instrumenter crate.
#[napi(js_name = "probeRecipe")]
pub fn probe_recipe(entries: bool, source_consumed: Option<Vec<SourceConsumed>>) -> napi::Result<String> {
    use variance_sense_instrument::{recipe_with, Mode};
    Ok(recipe_with(if entries { Mode::Entries } else { Mode::Presence }, &source_consumers(source_consumed)?))
}

/// The configured region universe, from the same owner as the native recipe.
#[napi(js_name = "instrumentationId")]
pub fn instrumentation_id(entries: bool, source_consumed: Option<Vec<SourceConsumed>>) -> napi::Result<String> {
    use variance_sense_instrument::{identity, Mode};
    Ok(identity(if entries { Mode::Entries } else { Mode::Presence }, &source_consumers(source_consumed)?))
}

/// A cut test file, the `mappings` of the map back to the text it was handed,
/// and the `[line, column, length]` shifts they were made from.
#[napi(object)]
pub struct Cadence {
    pub code: String,
    pub mappings: String,
    pub shifts: Vec<u32>,
}

/// A test file with a cut before each statement of its test and hook bodies,
/// or `null` when it does not parse or holds none: `cadence.rs`.
#[napi]
pub fn cadence(source: String, file: String, awaited: Option<bool>) -> Option<Cadence> {
    variance_sense_instrument::cadence(&source, &file, awaited.unwrap_or(false))
        .map(|cut| Cadence { code: cut.code, mappings: cut.mappings, shifts: cut.shifts })
}
