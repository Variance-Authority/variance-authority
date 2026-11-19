//! An update with no chain of its own stands on another checkout's: the
//! repository's checkouts hold one tree's records, so a worktree's first index
//! reads only what differs from its primary checkout's, never every file.

// compass: variance-authority.reach.source-index

use rayon::prelude::*;

use crate::compact::{Layer, ParseView};
use crate::index::way;
use crate::index_chain::{read_chain, Chain};
use crate::parse_store::Opened;

/// The first of `others` that reads whole and was made under `config`.
pub(super) fn other(others: &[String], config: &str) -> Option<Chain> {
    others.iter().find_map(|path| {
        let chain = read_chain(path).ok().flatten().filter(|chain| chain.dropped == 0)?;
        let last = Layer::open(chain.segments.last()?).ok()?;
        (last.config == Some(config)).then_some(())?;
        drop(last);
        Some(chain)
    })
}

/// `other`'s layers, its segments, and how many of them are its base.
pub(super) fn opened(other: &Chain) -> (Vec<Layer<'_>>, &[Vec<u8>], usize) {
    match other.segments.par_iter().map(|bytes| Layer::open(bytes)).collect::<Result<Vec<_>, _>>() {
        Ok(layers) => (layers, &other.segments, other.segments.len().saturating_sub(other.working)),
        Err(_) => (Vec::new(), &[], 0),
    }
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
