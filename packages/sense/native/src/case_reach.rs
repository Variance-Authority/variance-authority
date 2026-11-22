//! The line each case's frames first reached a region at, held per module
//! slice of the bounded fold and merged across its replays.

use rayon::prelude::*;
use rustc_hash::FxHashMap;

/// The line each frame first reached a region of the slice at: keyed by the
/// case for its own frame and by the file's first case for an ambient one,
/// each map cut into shards by key so many replays' reaches merge at once.
pub(crate) struct Reach {
    width: u64,
    own: Vec<FxHashMap<u64, u64>>,
    ambient: Vec<FxHashMap<u64, u64>>,
}

const SHARDS: usize = 64;

fn shard(key: u64) -> usize {
    (key.wrapping_mul(0x9E37_79B9_7F4A_7C15) >> 58) as usize
}

impl Reach {
    pub(crate) fn new(width: usize) -> Self {
        let maps = || (0..SHARDS).map(|_| FxHashMap::default()).collect();
        Reach { width: width as u64, own: maps(), ambient: maps() }
    }

    fn key(&self, test: u32, local: usize) -> u64 {
        u64::from(test) * self.width + local as u64
    }

    pub(crate) fn reached(&mut self, test: u32, local: usize, line: u32, ambient: bool) {
        let key = self.key(test, local);
        let held = if ambient { &mut self.ambient } else { &mut self.own };
        held[shard(key)].entry(key).or_insert(u64::from(line) * 2 + u64::from(ambient));
    }

    pub(crate) fn get(&self, ambient: bool, test: u32, local: usize) -> Option<u64> {
        let key = self.key(test, local);
        let held = if ambient { &self.ambient } else { &self.own };
        held[shard(key)].get(&key).copied()
    }

    /// The replays' reaches as one, earliest first: a region keeps the line
    /// of the first replay that reached it, as one replay in order would.
    pub(crate) fn merged(width: usize, reaches: Vec<Reach>) -> Reach {
        let mut own: Vec<Vec<FxHashMap<u64, u64>>> = (0..SHARDS).map(|_| Vec::with_capacity(reaches.len())).collect();
        let mut ambient: Vec<Vec<FxHashMap<u64, u64>>> = (0..SHARDS).map(|_| Vec::with_capacity(reaches.len())).collect();
        for reach in reaches {
            for (at, map) in reach.own.into_iter().enumerate() {
                own[at].push(map);
            }
            for (at, map) in reach.ambient.into_iter().enumerate() {
                ambient[at].push(map);
            }
        }
        let first = |maps: Vec<FxHashMap<u64, u64>>| {
            let mut maps = maps.into_iter();
            let mut held = maps.next().unwrap_or_default();
            for later in maps {
                for (key, line) in later {
                    held.entry(key).or_insert(line);
                }
            }
            held
        };
        Reach { width: width as u64, own: own.into_par_iter().map(first).collect(), ambient: ambient.into_par_iter().map(first).collect() }
    }
}
