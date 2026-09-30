//! How much code each package pulls in: the effective lines over every file
//! its shipped files reach through an edge a runtime loads.
//!
//! The walk is the fold's own: the files are the counted files the code map is
//! read from, the split between shipped and the tests' side is `tests` in
//! `orient_map_read.rs`, and a file's lines are the ones its parse stored. A
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
    /// Whether each counted file is shipped: not on the tests' side.
    pub shipped: Vec<bool>,
    /// The nodes each counted file loads, through every request kind but `type`.
    pub outgoing: Vec<Vec<u32>>,
    pub leaves: u32,
}

/// One package's runtime closure.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct Closure {
    /// Effective lines over every sized file the closure holds, the package's own included.
    pub lines: u64,
    /// Effective lines in the package's own shipped files.
    pub own: u64,
    /// Files summed.
    pub files: u32,
    /// Files and targets reached with no size; above zero, `lines` is a lower bound.
    pub unsized_files: u32,
}

/// Every package's closure, by package index.
pub(crate) fn closures(nodes: &Nodes, packages: usize) -> Vec<Closure> {
    let counted = nodes.lines.len();
    let total = counted + nodes.leaves as usize;
    let mut seeds: Vec<Vec<u32>> = vec![Vec::new(); packages];
    for at in 0..counted {
        if nodes.shipped[at] {
            seeds[nodes.owner[at] as usize].push(at as u32);
        }
    }
    seeds
        .par_iter()
        .map_init(
            || (vec![u32::MAX; total], Vec::<u32>::new()),
            |(stamp, queue), starts| walk(nodes, starts, stamp, queue),
        )
        .collect()
}

/// One breadth-first walk from `starts`. `stamp` marks a node visited by the
/// first seed of the walk that marked it, so one buffer serves every walk a
/// worker makes without being cleared.
fn walk(nodes: &Nodes, starts: &[u32], stamp: &mut [u32], queue: &mut Vec<u32>) -> Closure {
    let mut closure = Closure::default();
    let Some(&mark) = starts.first() else { return closure };
    let counted = nodes.lines.len() as u32;
    queue.clear();
    for &start in starts {
        stamp[start as usize] = mark;
        queue.push(start);
        closure.own += u64::from(nodes.lines[start as usize].unwrap_or(0));
    }
    let mut head = 0;
    while head < queue.len() {
        let at = queue[head];
        head += 1;
        if at >= counted {
            closure.unsized_files += 1;
            continue;
        }
        match nodes.lines[at as usize] {
            Some(lines) => {
                closure.lines += u64::from(lines);
                closure.files += 1;
            }
            None => closure.unsized_files += 1,
        }
        for &to in &nodes.outgoing[at as usize] {
            if stamp[to as usize] != mark {
                stamp[to as usize] = mark;
                queue.push(to);
            }
        }
    }
    closure
}

#[cfg(test)]
mod tests {
    use super::{closures, Closure, Nodes};

    /// a0 → a1 → b0 → leaf; b0 → a0 (a cycle); a2 is a's test file.
    fn nodes() -> Nodes {
        Nodes {
            lines: vec![Some(10), Some(5), Some(100), Some(7)],
            owner: vec![0, 0, 1, 0],
            shipped: vec![true, true, true, false],
            outgoing: vec![vec![1], vec![2], vec![4, 0], vec![0]],
            leaves: 1,
        }
    }

    #[test]
    fn a_closure_sums_what_its_shipped_files_reach_and_counts_what_it_cannot_size() {
        let found = closures(&nodes(), 3);
        assert_eq!(found[0], Closure { lines: 115, own: 15, files: 3, unsized_files: 1 });
        assert_eq!(found[1], Closure { lines: 115, own: 100, files: 3, unsized_files: 1 });
        // A package with no shipped file pulls in nothing.
        assert_eq!(found[2], Closure::default());
    }

    #[test]
    fn a_file_with_no_stored_size_is_unsized_not_empty() {
        let mut graph = nodes();
        graph.lines[1] = None;
        let found = closures(&graph, 2);
        assert_eq!(found[0], Closure { lines: 110, own: 10, files: 2, unsized_files: 2 });
    }
}
