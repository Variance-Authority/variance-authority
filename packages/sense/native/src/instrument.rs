//! `instrument`: the instrumenter crate's cut, as columns for JavaScript.
//!
//! The tree never leaves the arena: what crosses is the instrumented text and one
//! column per block field, which `src/instrument/spliced.ts` turns back into
//! blocks. There is no JavaScript walk to fall back to, so a platform without this
//! addon does not record. The cut and the header are
//! [`variance_sense_instrument`]'s, which a Rust pipeline calls directly.

use napi::bindgen_prelude::{Buffer, Uint32Array};
use napi_derive::napi;
use variance_sense_instrument::native::{cut, header};

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
pub fn instrument_module(source: String, file: String, entries: bool, module: Option<String>) -> Option<Instrumented> {
    let mut out = cut(&source, &file, entries)?;
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
    Some(Instrumented {
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
    })
}

/// The header one module carries, for a caller that writes a module by hand.
#[napi(js_name = "probeHeader")]
pub fn probe_header(module: String, count: u32) -> String {
    header(&module, count as usize)
}

/// What this build writes under a mode: `recipe()` of the instrumenter crate.
#[napi(js_name = "probeRecipe")]
pub fn probe_recipe(entries: bool) -> String {
    use variance_sense_instrument::{recipe, Mode};
    recipe(if entries { Mode::Entries } else { Mode::Presence })
}
