//! How much code each package pulls in: the effective lines over every file
//! its entries reach through an edge a runtime loads.
//!
//! The walk is the fold's own: the files are the counted files the code map is
//! read from, a package's entries are the ones `tests` in `orient_map_read.rs`
//! starts shipped code at, and a file's lines are the ones its parse stored. A
//! file of the package that no entry loads, dead or reached only by a type, is
//! not in its closure. A
//! type-only request is not followed, because nothing loads it; an `import()`
//! is, because something does. A file the walk reaches with no stored size — a
//! stylesheet, a file the index holds no parse for, a target that is not a
//! counted file, a request the index could not resolve — is counted as
//! unsized, so the sum is a lower bound and says so. An installed package is
//! not a file of the checkout and is not followed.

// compass: variance-authority.reach.relations

use std::collections::VecDeque;

use rayon::prelude::*;

/// The graph a closure is walked over. Nodes below `lines.len()` are counted
/// files; every node from there up to `lines.len() + leaves` is a target with
/// no file record of its own, which the walk reaches and cannot size.
pub(crate) struct Nodes {
    /// Each counted file's effective lines; absent when its parse stored none.
    pub lines: Vec<Option<u32>>,
    /// Each counted file's package.
    pub owner: Vec<u32>,
    /// Whether each counted file is an entry of its package: where its closure starts.
    pub roots: Vec<bool>,
    /// The nodes each counted file loads, through every request kind but `type`.
    pub outgoing: Vec<Vec<u32>>,
    pub leaves: u32,
}

/// One package's runtime closure.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct Closure {
    /// Effective lines over every sized file the closure holds, the package's own included.
    pub lines: u64,
    /// Effective lines in the package's own files the closure holds.
    pub own: u64,
    /// Files summed.
    pub files: u32,
    /// Files and targets reached with no size; above zero, `lines` is a lower bound.
    pub unsized_files: u32,
}

/// Packages one walk carries at once, a bit each in a word per node.
const BLOCK: usize = 64;

/// Every package's closure, by package index.
///
/// A walk per package costs the packages times what each reaches, which grows
/// with the square of the checkout. Instead each block of 64 packages walks
/// the graph once as a bitset: a node holds the bits of every package that
/// reached it, and is visited again only while it carries bits it has not yet
/// passed on, so a file reached by many packages, or along many paths, is
/// walked once per block rather than once per package and path. A node's
/// size is then added to each package whose bit it holds. The blocks run in
/// parallel.
pub(crate) fn closures(nodes: &Nodes, packages: usize) -> Vec<Closure> {
    let counted = nodes.lines.len();
    let total = counted + nodes.leaves as usize;
    let mut seeds: Vec<Vec<u32>> = vec![Vec::new(); packages];
    for at in 0..counted {
        if nodes.roots[at] {
            seeds[nodes.owner[at] as usize].push(at as u32);
        }
    }
    let outgoing = |at: usize| nodes.outgoing.get(at).map_or(&[][..], Vec::as_slice);
    (0..packages.div_ceil(BLOCK))
        .into_par_iter()
        .flat_map_iter(|block| {
            let first = block * BLOCK;
            let width = BLOCK.min(packages - first);
            let mut reached = vec![0u64; total];
            let mut pending = vec![0u64; total];
            let mut queue: VecDeque<u32> = VecDeque::new();
            for bit in 0..width {
                for &start in &seeds[first + bit] {
                    if pending[start as usize] == 0 {
                        queue.push_back(start);
                    }
                    reached[start as usize] |= 1 << bit;
                    pending[start as usize] |= 1 << bit;
                }
            }
            while let Some(at) = queue.pop_front() {
                let carried = std::mem::take(&mut pending[at as usize]);
                for &to in outgoing(at as usize) {
                    let to = to as usize;
                    let new = carried & !reached[to];
                    if new != 0 {
                        reached[to] |= new;
                        if pending[to] == 0 {
                            queue.push_back(to as u32);
                        }
                        pending[to] |= new;
                    }
                }
            }
            let mut found = vec![Closure::default(); width];
            for (at, &mask) in reached.iter().enumerate() {
                let sized = nodes.lines.get(at).copied().flatten();
                // A file's own lines count only for the package that owns it.
                if let Some(lines) = sized {
                    let own = (nodes.owner[at] as usize).wrapping_sub(first);
                    if own < width && mask & (1 << own) != 0 {
                        found[own].own += u64::from(lines);
                    }
                }
                let mut bits = mask;
                while bits != 0 {
                    let closure = &mut found[bits.trailing_zeros() as usize];
                    match sized {
                        Some(lines) => {
                            closure.lines += u64::from(lines);
                            closure.files += 1;
                        }
                        None => closure.unsized_files += 1,
                    }
                    bits &= bits - 1;
                }
            }
            found
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{closures, Closure, Nodes};

    /// a0 → a1 → b0 → leaf; b0 → a0 (a cycle); a2 is a's test file; a3 is a
    /// file of a no entry loads. a0 and b0 are the entries.
    fn nodes() -> Nodes {
        Nodes {
            lines: vec![Some(10), Some(5), Some(100), Some(7), Some(20)],
            owner: vec![0, 0, 1, 0, 0],
            roots: vec![true, false, true, false, false],
            outgoing: vec![vec![1], vec![2], vec![5, 0], vec![0], vec![]],
            leaves: 1,
        }
    }

    #[test]
    fn a_closure_sums_what_its_entries_reach_and_counts_what_it_cannot_size() {
        let found = closures(&nodes(), 3);
        assert_eq!(found[0], Closure { lines: 115, own: 15, files: 3, unsized_files: 1 });
        assert_eq!(found[1], Closure { lines: 115, own: 100, files: 3, unsized_files: 1 });
        // A package with no shipped file pulls in nothing.
        assert_eq!(found[2], Closure::default());
    }

    /// Each package walked on its own, breadth first: what a closure means.
    fn walked(nodes: &Nodes, packages: usize) -> Vec<Closure> {
        let counted = nodes.lines.len();
        (0..packages)
            .map(|package| {
                let mut seen = vec![false; counted + nodes.leaves as usize];
                let mut queue: Vec<usize> = (0..counted).filter(|&at| nodes.roots[at] && nodes.owner[at] as usize == package).collect();
                queue.iter().for_each(|&at| seen[at] = true);
                let mut closure = Closure::default();
                while let Some(at) = queue.pop() {
                    match nodes.lines.get(at).copied().flatten() {
                        Some(lines) => {
                            closure.lines += u64::from(lines);
                            closure.own += if nodes.owner[at] as usize == package { u64::from(lines) } else { 0 };
                            closure.files += 1;
                        }
                        None => closure.unsized_files += 1,
                    }
                    for &to in nodes.outgoing.get(at).map_or(&[][..], Vec::as_slice) {
                        if !std::mem::replace(&mut seen[to as usize], true) {
                            queue.push(to as usize);
                        }
                    }
                }
                closure
            })
            .collect()
    }

    #[test]
    fn every_closure_is_what_its_own_walk_reaches_through_cycles_and_across_blocks() {
        // More packages than one block of the fold holds, files in cycles, and
        // packages with no entry, from a fixed seed.
        let mut seed = 7u64;
        let mut next = |below: usize| {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            ((seed >> 33) as usize) % below
        };
        let (files, packages, leaves) = (3000, 700, 40);
        let owner: Vec<u32> = (0..files).map(|_| next(packages) as u32).collect();
        let nodes = Nodes {
            lines: (0..files).map(|_| if next(10) == 0 { None } else { Some(next(200) as u32) }).collect(),
            roots: (0..files).map(|_| next(3) == 0).collect(),
            outgoing: (0..files).map(|_| (0..next(4)).map(|_| next(files + leaves as usize) as u32).collect()).collect(),
            owner,
            leaves,
        };
        assert_eq!(closures(&nodes, packages + 1), walked(&nodes, packages + 1));
    }

    #[test]
    fn converging_paths_and_a_cycle_through_many_packages_count_each_file_once() {
        // A lattice where every file of a rank loads every file of the next,
        // so each bottom file is reached along thousands of paths, and one
        // cycle that runs through a file of each of 300 packages, more than a
        // block holds, owned by packages on both sides of the lattice.
        let (width, ranks, ring) = (12usize, 10usize, 300usize);
        let lattice = width * ranks;
        let files = lattice + ring;
        let mut outgoing: Vec<Vec<u32>> = vec![Vec::new(); files];
        for rank in 0..ranks - 1 {
            for at in 0..width {
                outgoing[rank * width + at] = (0..width).map(|to| ((rank + 1) * width + to) as u32).collect();
            }
        }
        for at in 0..ring {
            outgoing[lattice + at].push((lattice + (at + 1) % ring) as u32);
        }
        // The lattice's bottom enters the ring, and the ring re-enters the lattice's top.
        outgoing[lattice - 1].push(lattice as u32);
        outgoing[lattice + ring / 2].push(0);
        let packages = ring + width;
        let owner: Vec<u32> = (0..files).map(|at| if at < lattice { (ring + at % width) as u32 } else { (at - lattice) as u32 }).collect();
        let nodes = Nodes {
            lines: (0..files).map(|at| if at % 17 == 0 { None } else { Some((at % 23) as u32 + 1) }).collect(),
            roots: (0..files).map(|at| at < width || (at >= lattice && at % 5 == 0)).collect(),
            outgoing,
            owner,
            leaves: 0,
        };
        assert_eq!(closures(&nodes, packages), walked(&nodes, packages));
    }

    #[test]
    fn a_file_with_no_stored_size_is_unsized_not_empty() {
        let mut graph = nodes();
        graph.lines[1] = None;
        let found = closures(&graph, 2);
        assert_eq!(found[0], Closure { lines: 110, own: 10, files: 2, unsized_files: 2 });
    }
}
