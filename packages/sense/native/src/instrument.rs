//! `instrument`: the instrumenter crate's cut, as columns for JavaScript.
//!
//! The tree never leaves the arena: what crosses is the instrumented text and one
//! column per block field, which `src/instrument/spliced.ts` turns back into
//! blocks. There is no JavaScript walk to fall back to, so a platform without this
//! addon does not record. The cut and the header are
//! [`variance_sense_instrument`]'s, which a Rust pipeline calls directly.

use napi::bindgen_prelude::{Buffer, Uint32Array};
use napi_derive::napi;
use variance_sense_instrument::native::{cut, header, place, Cut};

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
    /// Whether `code` imports or exports: a script takes the collector by `require`.
    pub module: bool,
}

/// `instrument()` from `src/instrument/index.ts`, or `null` where it must answer.
///
/// With a `module`, the header that reports under it is in `code`; without one
/// the text has only the probes, which is what the walk's golden answers hold.
#[napi(js_name = "instrument", catch_unwind)]
pub fn instrument_module(source: String, file: String, entries: bool, module: Option<String>) -> Option<Instrumented> {
    let mut out = cut(&source, &file, entries)?;
    if let Some(module) = module {
        out.code.insert_str(out.header_byte, &header(&module, out.blocks.len()));
    }
    Some(columns(out))
}

/// `instrumentTransformed()` from `src/instrument/index.ts`: the regions of
/// `authored`, their probes placed in `transformed` through `mappings`, the
/// composed map from it to its sources, of which `authored` is number `source`.
#[napi(object)]
pub struct Placed {
    pub instrumented: Instrumented,
    /// The map from `instrumented.code` back to `transformed`.
    pub mappings: String,
    /// With `carry`, the composed map moved onto `instrumented.code`, its
    /// sources and names as they were; `null` without it.
    pub carried: Option<String>,
}

/// `null` when either text does not parse.
#[napi(js_name = "place", catch_unwind)]
#[allow(clippy::too_many_arguments)]
pub fn place_module(
    authored: String,
    transformed: String,
    file: String,
    mappings: String,
    source: u32,
    entries: bool,
    module: String,
    carry: bool,
) -> Option<Placed> {
    let placed = place(&authored, &transformed, &file, &mappings, source, &module, entries, carry)?;
    Some(Placed {
        instrumented: columns(placed.cut),
        mappings: placed.mappings,
        carried: placed.carried,
    })
}

fn columns(out: Cut) -> Instrumented {
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
    Instrumented {
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
        module: out.module,
    }
}

/// The header one module carries, for a caller that writes a module by hand.
#[napi(js_name = "probeHeader")]
pub fn probe_header(module: String, count: u32) -> String {
    header(&module, count as usize)
}

/// The module's text with region `ordinal` skipped, on the same lines, or
/// `null` where it has no text of its own: `native/instrument/src/fault.rs`.
#[napi(js_name = "faulted", catch_unwind)]
pub fn faulted_module(source: String, file: String, ordinal: u32) -> Option<String> {
    variance_sense_instrument::faulted(&source, &file, ordinal)
}

/// What this build writes under a mode: `recipe()` of the instrumenter crate.
#[napi(js_name = "probeRecipe")]
pub fn probe_recipe(entries: bool) -> String {
    use variance_sense_instrument::{recipe, Mode};
    recipe(if entries { Mode::Entries } else { Mode::Presence })
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
