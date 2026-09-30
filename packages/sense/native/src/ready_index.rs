//! Readying a source index: its working layer folded into its base, before work
//! rather than during it.
//!
//! An update (`source_update.rs`) rewrites the working layer and never the base,
//! so what one costs grows with what changed since the index was last readied,
//! not with the repository. `variance index` leaves the readying to the
//! follow-ups it detaches, ahead of everything they make from the chain, and
//! only once the working layer is worth folding.

// compass: variance-authority.reach.source-index

use napi::bindgen_prelude::AsyncTask;
use napi_derive::napi;
use rayon::prelude::*;

use crate::compact::{compacted, Layer};
use crate::index_chain::read_chain;
use crate::log::{written, LogSegment, Over};
use crate::off_thread::{off_thread, OffThread};

/// The working layer is folded once its rows are this share of the base's. On
/// Kibana's 107,163 files a one-file update costs 165 ms over an empty working
/// layer, 170 ms over a thousand files and 220 ms over eleven thousand, while
/// the fold is 620 ms: below a tenth, carrying the layer is the cheaper side.
const SHARE: f64 = 0.10;

/// Fold the working layer of the index at `index` into its base when it has
/// grown past `SHARE` of it, and say whether a base was written. A chain another
/// writer moved meanwhile is left as that writer published it.
#[napi(ts_return_type = "Promise<boolean>")]
pub fn ready_source_index(index: String) -> AsyncTask<OffThread<bool>> {
    off_thread(move || readied(&index).map_err(|error| napi::Error::from_reason(format!("the source index at {index} was not readied: {error}"))))
}

fn readied(index: &str) -> Result<bool, String> {
    let Some(chain) = read_chain(index)? else { return Ok(false) };
    if chain.working == 0 || chain.dropped > 0 {
        return Ok(false);
    }
    let base = chain.segments.len() - chain.working;
    let rows = chain.segments.par_iter().enumerate()
        .map(|(at, bytes)| Layer::open(bytes).map(|layer| rows(&layer)).map_err(|error| format!("segment {at}: {error}")))
        .collect::<Result<Vec<_>, _>>()?;
    let (under, over): (usize, usize) = (rows[..base].iter().sum(), rows[base..].iter().sum());
    if (over as f64) < SHARE * under as f64 {
        return Ok(false);
    }
    let layers: Vec<&[u8]> = chain.segments.iter().map(Vec::as_slice).collect();
    let one = compacted(&layers)?;
    let references: Vec<LogSegment> = chain.references.iter()
        .map(|reference| LogSegment { digest: reference.digest.clone(), length: reference.length as i64 })
        .collect();
    // A chain another writer moved while this one folded is left as it is.
    written(index, Over::Published(chain.published()), &[], &[&one], &references, 0).map_err(|error| error.to_string())
}

/// What a layer carries: the rows it puts and the rows it deletes, since a
/// layer of deletions is as much for readying to fold as one of puts.
fn rows(layer: &Layer) -> usize {
    layer.records.file.len() + layer.parses.key.len()
        + layer.records.deleted.len() + layer.parses.deleted.len() + layer.directories.deleted.len()
}
