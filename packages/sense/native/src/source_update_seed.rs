//! An update with no chain of its own stands on another checkout's: the
//! repository's checkouts hold one tree's records, so a worktree's first index
//! reads only what differs from its primary checkout's, never every file.

// compass: variance-authority.reach.source-index

use napi_derive::napi;
use rayon::prelude::*;

use crate::compact::{Layer, ParseView};
use crate::index::way;
use crate::index_chain::{read_chain, Chain};
use crate::parse_store::Opened;

/// The index an update with none to stand on starts from, and whether it is
/// CI's: a checkout's first, since it is on this machine, then the one fetched.
pub(super) fn chosen(o: &super::UpdateOptions) -> (Option<(String, Chain)>, bool) {
    match other(o.others.as_deref().unwrap_or_default(), &o.config) {
        Some(other) => (Some(other), false),
        None => (other(o.published.as_deref().unwrap_or_default(), &o.config), true),
    }
}

/// The first of `others` an update with no chain to stand on starts from under
/// `config`, as `chosen` takes it: asked before the update waits on CI's index,
/// which it does not when another checkout's fits.
#[napi(js_name = "sourceIndexSeed", catch_unwind)]
pub fn source_index_seed(others: Vec<String>, config: String) -> Option<String> {
    other(&others, &config).map(|(path, _)| path)
}

/// The first of `others` whose every segment opens and whose last was made
/// under `config`, and its path: one that does not is passed over for the next.
pub(super) fn other(others: &[String], config: &str) -> Option<(String, Chain)> {
    others.iter().find_map(|path| {
        let chain = read_chain(path).ok().flatten().filter(|chain| chain.dropped == 0)?;
        let layers = opened(&chain)?;
        (layers.last()?.config == Some(config)).then_some(())?;
        drop(layers);
        Some((path.clone(), chain))
    })
}

/// `other`'s layers, where every one of its segments opens.
pub(super) fn opened(other: &Chain) -> Option<Vec<Layer<'_>>> {
    other.segments.par_iter().map(|bytes| Layer::open(bytes)).collect::<Result<Vec<_>, _>>().ok()
}

/// Whether another checkout's record of `file` at `digest` stands here. Its
/// row may be of bytes that checkout edited after git named them, which nothing
/// in the row tells apart; the store holds only parses of the blob itself, so a
/// row stands where it holds no parse, or the store holds its parse as the row's.
pub(super) fn proven(layers: &[Layer], store: &Opened, file: &str, digest: &str) -> bool {
    let way = way(file);
    let Some((layer, row)) = crate::chain_lookup::parse(layers, digest, &way) else { return true };
    store.view(digest, &way).and_then(|view| view.read()).is_some_and(|stored| ParseView::of(&layers[layer], row).read() == Some(stored))
}
