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
use crate::package_graph::fold;

/// For each of `files` the index holds a record for, every file that reaches it
/// by imports, itself included. `None` when nothing was published at `index`,
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
    let folded = fold(&layers);
    let mut paths: Vec<&str> = folded.keys().copied().collect();
    paths.sort_unstable();
    let ids: HashMap<&str, u32> = paths.iter().enumerate().map(|(id, &path)| (path, id as u32)).collect();

    // Importers by target: one edge per resolved target that is a file the index holds.
    let mut importing: Vec<Vec<u32>> = vec![Vec::new(); paths.len()];
    for (&path, &(layer, row)) in &folded {
        let (stored, records) = (&layers[layer].stored, &layers[layer].records);
        if records.targets_present[row] != 1 {
            continue;
        }
        let from = ids[path];
        for target in records.targets.range(row) {
            let Some(to) = stored.optional(records.target_path.at(target)).and_then(|to| ids.get(to)) else { continue };
            importing[*to as usize].push(from);
        }
    }

    let mut answer = HashMap::new();
    for &file in files {
        let Some(&start) = ids.get(file) else { continue };
        let mut seen: HashSet<u32> = HashSet::from([start]);
        let mut queue = vec![start];
        while let Some(at) = queue.pop() {
            for &from in &importing[at as usize] {
                if seen.insert(from) {
                    queue.push(from);
                }
            }
        }
        answer.insert(file.to_owned(), seen.into_iter().map(|id| paths[id as usize].to_owned()).collect());
    }
    Ok(Some(answer))
}
