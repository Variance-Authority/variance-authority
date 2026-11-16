//! The files that import a module, read off the source index.
//!
//! A region that ran while its module evaluated is credited to no case: the
//! module evaluates once per realm, for whichever case imported it first. The
//! cases whose files import the module ran it, and the source index names
//! them — the importer closure of the file, the same set `covering --file`
//! takes from the file graph (`loadersOf` in `reverse.ts`). This is that walk
//! over the published index, without handing a record to JavaScript.
//!
//! One difference is on the page: `covering` also rules out a case whose file
//! mocks the module, through the taint the file graph carries, and the index
//! holds no such taint. A case that mocks the module is named here and not
//! there.

// compass: variance-authority.reach.relations

use std::collections::{HashMap, HashSet};

use rayon::prelude::*;

use crate::compact::Layer;
use crate::index_chain::read_chain;

/// For each of `files` the index holds a record for, every file that reaches it
/// by imports, itself included, read backwards from the files reached
/// (`importers` in `chain_lookup.rs`) rather than from every record. `None` when nothing was published at `index`,
/// and a file the index holds no record for is absent from the map.
pub(crate) fn importers(index: &str, files: &[&str]) -> Result<Option<HashMap<String, HashSet<String>>>, String> {
    let unread = |error: String| format!("the source index at {index} did not read: {error}");
    let Some(chain) = read_chain(index).map_err(unread)? else { return Ok(None) };
    let layers = chain
        .segments
        .par_iter()
        .enumerate()
        .map(|(at, bytes)| Layer::open(bytes).map_err(|error| format!("segment {at}: {error}")))
        .collect::<Result<Vec<_>, _>>()
        .map_err(unread)?;
    let mut answer = HashMap::new();
    for &file in files {
        let Some((start, _)) = crate::chain_lookup::record(&layers, file) else { continue };
        let mut seen: HashSet<&str> = HashSet::from([start]);
        let mut queue = vec![start];
        while let Some(at) = queue.pop() {
            for (from, _) in crate::chain_lookup::importers(&layers, at) {
                if seen.insert(from) {
                    queue.push(from);
                }
            }
        }
        answer.insert(file.to_owned(), seen.into_iter().map(str::to_owned).collect());
    }
    Ok(Some(answer))
}
