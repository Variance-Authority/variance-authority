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

/// Packages one fold carries at once, a bit each in this many words per node.
const WORDS: usize = 4;
const BLOCK: usize = WORDS * 64;

/// Every package's closure, by package index.
///
/// A walk per package costs the packages times what each reaches, which grows
/// with the square of the checkout. Instead the files are folded into their
/// strongly connected components once, every component reaching the same
/// files, and each block of packages is carried down that acyclic graph as a
/// bitset: a component is reached by every package whose bit any component
/// above it carries. That is one pass over the edges per block, a word per 64
/// packages, and a component's sizes are summed once and added to each
/// package that reaches it.
pub(crate) fn closures(nodes: &Nodes, packages: usize) -> Vec<Closure> {
    let counted = nodes.lines.len();
    let mut seeds: Vec<Vec<u32>> = vec![Vec::new(); packages];
    for at in 0..counted {
        if nodes.roots[at] {
            seeds[nodes.owner[at] as usize].push(at as u32);
        }
    }
    let seeded: Vec<usize> = (0..packages).filter(|&package| !seeds[package].is_empty()).collect();
    let mut found = vec![Closure::default(); packages];
    if seeded.is_empty() {
        return found;
    }
    // Each package's place among the seeded, which names its block and its bit.
    let mut rank = vec![u32::MAX; packages];
    for (at, &package) in seeded.iter().enumerate() {
        rank[package] = at as u32;
    }
    let graph = Condensed::new(nodes);
    let blocks: Vec<Vec<Closure>> =
        seeded.par_chunks(BLOCK).enumerate().map(|(first, block)| graph.fold(nodes, &seeds, &rank, first * BLOCK, block)).collect();
    for (block, closures) in seeded.chunks(BLOCK).zip(blocks) {
        for (&package, closure) in block.iter().zip(closures) {
            found[package] = closure;
        }
    }
    found
}

/// The graph's strongly connected components, numbered so that every edge
/// between two of them runs from a higher number to a lower one, with what
/// each holds summed.
struct Condensed {
    component: Vec<u32>,
    /// The nodes of component `c` are `members[start[c]..start[c + 1]]`.
    start: Vec<u32>,
    members: Vec<u32>,
    lines: Vec<u64>,
    files: Vec<u32>,
    unsized_files: Vec<u32>,
}

impl Condensed {
    fn new(nodes: &Nodes) -> Condensed {
        let counted = nodes.lines.len();
        let total = nodes.lines.len() + nodes.leaves as usize;
        let (component, count) = components(total, |at| nodes.outgoing.get(at).map_or(&[][..], Vec::as_slice));
        let count = count as usize;
        let mut start = vec![0u32; count + 1];
        for &c in &component {
            start[c as usize + 1] += 1;
        }
        for c in 0..count {
            start[c + 1] += start[c];
        }
        let mut members = vec![0u32; component.len()];
        let mut filled = start.clone();
        let (mut lines, mut files, mut unsized_files) = (vec![0u64; count], vec![0u32; count], vec![0u32; count]);
        for (at, &c) in component.iter().enumerate() {
            let c = c as usize;
            members[filled[c] as usize] = at as u32;
            filled[c] += 1;
            match nodes.lines.get(at).copied().flatten() {
                Some(sized) if at < counted => {
                    lines[c] += u64::from(sized);
                    files[c] += 1;
                }
                _ => unsized_files[c] += 1,
            }
        }
        Condensed { component, start, members, lines, files, unsized_files }
    }

    /// The closures of `block`, at most [`BLOCK`] packages, in its order:
    /// the seeded packages ranked from `first`.
    fn fold(&self, nodes: &Nodes, seeds: &[Vec<u32>], rank: &[u32], first: usize, block: &[usize]) -> Vec<Closure> {
        let count = self.start.len() - 1;
        let mut reached = vec![[0u64; WORDS]; count];
        for (at, &package) in block.iter().enumerate() {
            for &start in &seeds[package] {
                reached[self.component[start as usize] as usize][at / 64] |= 1 << (at % 64);
            }
        }
        let mut found = vec![Closure::default(); block.len()];
        // Highest first is every component before any it reaches.
        for c in (0..count).rev() {
            let carried = reached[c];
            if carried == [0; WORDS] {
                continue;
            }
            for &at in &self.members[self.start[c] as usize..self.start[c + 1] as usize] {
                let at = at as usize;
                if let Some(Some(sized)) = nodes.lines.get(at) {
                    let own = (rank[nodes.owner[at] as usize] as usize).wrapping_sub(first);
                    if own < block.len() && carried[own / 64] & (1 << (own % 64)) != 0 {
                        found[own].own += u64::from(*sized);
                    }
                }
                for &to in nodes.outgoing.get(at).map_or(&[][..], Vec::as_slice) {
                    let below = self.component[to as usize] as usize;
                    if below != c {
                        for (word, bits) in reached[below].iter_mut().zip(carried) {
                            *word |= bits;
                        }
                    }
                }
            }
            for (word, mut bits) in carried.into_iter().enumerate() {
                while bits != 0 {
                    let closure = &mut found[word * 64 + bits.trailing_zeros() as usize];
                    closure.lines += self.lines[c];
                    closure.files += self.files[c];
                    closure.unsized_files += self.unsized_files[c];
                    bits &= bits - 1;
                }
            }
        }
        found
    }
}

/// Each of `total` nodes' strongly connected component, by Tarjan's algorithm
/// without recursion, and how many there are, where `outgoing` gives a node's
/// successors. A component is numbered once every one it reaches is, so an
/// edge never runs to a higher number. The code map's package layers read the
/// same order.
pub(crate) fn components<'a>(total: usize, outgoing: impl Fn(usize) -> &'a [u32]) -> (Vec<u32>, u32) {
    const UNSEEN: u32 = u32::MAX;
    let (mut index, mut low, mut held) = (vec![UNSEEN; total], vec![0u32; total], vec![false; total]);
    let mut component = vec![UNSEEN; total];
    let (mut stack, mut calls): (Vec<u32>, Vec<(u32, u32)>) = (Vec::new(), Vec::new());
    let (mut next, mut count) = (0u32, 0u32);
    for root in 0..total {
        if index[root] != UNSEEN {
            continue;
        }
        index[root] = next;
        low[root] = next;
        next += 1;
        stack.push(root as u32);
        held[root] = true;
        calls.push((root as u32, 0));
        while let Some(&(at, edge)) = calls.last() {
            let at = at as usize;
            if let Some(&to) = outgoing(at).get(edge as usize) {
                calls.last_mut().expect("a call is open").1 += 1;
                let to = to as usize;
                if index[to] == UNSEEN {
                    index[to] = next;
                    low[to] = next;
                    next += 1;
                    stack.push(to as u32);
                    held[to] = true;
                    calls.push((to as u32, 0));
                } else if held[to] {
                    low[at] = low[at].min(index[to]);
                }
                continue;
            }
            calls.pop();
            if let Some(&(caller, _)) = calls.last() {
                low[caller as usize] = low[caller as usize].min(low[at]);
            }
            if low[at] == index[at] {
                loop {
                    let member = stack.pop().expect("the component's root is on the stack") as usize;
                    held[member] = false;
                    component[member] = count;
                    if member == at {
                        break;
                    }
                }
                count += 1;
            }
        }
    }
    (component, count)
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
    fn a_file_with_no_stored_size_is_unsized_not_empty() {
        let mut graph = nodes();
        graph.lines[1] = None;
        let found = closures(&graph, 2);
        assert_eq!(found[0], Closure { lines: 110, own: 10, files: 2, unsized_files: 2 });
    }
}
