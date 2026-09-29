//! The path graph a source question opens, written from the index's layers.
//!
//! `encodeSourceTree` in `mcp/src/tools/source-tree-format.ts` is the twin:
//! same files, same ids, same columns, and the bytes are equal. Written here
//! because the fold already lives in this process; carrying every record to
//! JavaScript to be folded again was most of what publishing cost.

// compass: variance-authority.reach.source-index

use std::collections::HashMap;

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use rayon::prelude::*;

use crate::index_chain::read_chain;
use crate::package_graph::fold;
use crate::segment::{encode_as, u32s, u8s, Collected, Strings, NONE};
use crate::compact::Layer;

const FORMAT: &str = "variance-authority-source-tree";
const VERSION: u8 = 1;
/// `EDGE_KINDS` in `core/relate/graph.ts`, in its order.
const EDGE_KINDS: [&str; 8] = ["imports", "reexports", "dynamic", "type", "asset", "declared-in", "depends-on", "depends"];

pub(crate) fn tree(layers: &[Layer]) -> Vec<u8> {
    let folded = fold(layers);
    let mut files: Collected = Collected::default();
    for (&path, &(layer, row)) in &folded {
        files.insert(path);
        let (stored, records) = (&layers[layer].stored, &layers[layer].records);
        if let Some(edges) = records.edges_of(stored, row) {
            files.extend(edges.map(|(to, _)| to));
        }
    }
    let mut paths: Vec<&str> = files.iter().copied().collect();
    paths.par_sort_unstable_by(|left, right| crate::order::code_unit(left, right));

    let mut collected = files;
    for &(layer, row) in folded.values() {
        let (stored, records) = (&layers[layer].stored, &layers[layer].records);
        collected.extend(records.unknown_of(stored, row));
    }
    let mut strings = Strings::of(collected);
    let at: HashMap<&str, u32> = paths.iter().enumerate().map(|(index, &path)| (path, index as u32)).collect();

    let mut offsets = Vec::with_capacity(paths.len() + 1);
    let (mut targets, mut kinds) = (Vec::new(), Vec::new());
    let mut unknown = vec![NONE; paths.len()];
    let mut row_edges: Vec<(u32, u8)> = Vec::new();
    for (index, &path) in paths.iter().enumerate() {
        offsets.push(targets.len() as u32);
        let Some(&(layer, row)) = folded.get(path) else { continue };
        let (stored, records) = (&layers[layer].stored, &layers[layer].records);
        row_edges.clear();
        if let Some(edges) = records.edges_of(stored, row) {
            for (to, kind) in edges {
                let (Some(&target), Some(kind)) = (at.get(to), EDGE_KINDS.iter().position(|known| *known == kind)) else { continue };
                row_edges.push((target, kind as u8));
            }
        }
        row_edges.sort_unstable();
        row_edges.dedup();
        for &(target, kind) in &row_edges {
            targets.push(target);
            kinds.push(kind);
        }
        unknown[index] = strings.optional(records.unknown_of(stored, row));
    }
    offsets.push(targets.len() as u32);

    let [blob, off] = strings.columns();
    let ids: Vec<u32> = paths.iter().map(|path| strings.id(path)).collect();
    encode_as(FORMAT, VERSION, vec![
        blob, off,
        u32s("files.path", ids),
        u32s("files.unknown", unknown),
        u32s("edges.offset", offsets),
        u32s("edges.target", targets),
        u8s("edges.kind", kinds),
    ])
}

/// The tree bytes for the index at `index`, or `None` when there is none.
#[napi(catch_unwind)]
pub fn encode_source_tree_from_index(index: String) -> napi::Result<Option<Buffer>> {
    let fail = |error: String| napi::Error::from_reason(format!("the source index at {index} did not read: {error}"));
    let Some(chain) = read_chain(&index).map_err(fail)? else { return Ok(None) };
    let layers = chain.segments.par_iter().enumerate()
        .map(|(at, bytes)| Layer::open(bytes).map_err(|error| format!("segment {at}: {error}")))
        .collect::<Result<Vec<_>, _>>()
        .map_err(fail)?;
    Ok(Some(tree(&layers).into()))
}
