//! Communities at every scale, by modularity (Louvain): each node moves to the
//! neighbouring community that gains most, then each community becomes one
//! node and the moves repeat, so every pass is a coarser partition.
//!
//! Modularity charges a community for the connections its size alone would
//! predict, which is what keeps a hub from swallowing the graph: label
//! propagation, the simpler alternative, let one label take 954 of Kibana's
//! 1,497 packages.
//!
//! Deterministic: nodes are visited in the order given, a neighbour's
//! communities in the order its connections were given, and a tie goes to the
//! lower community number.

// compass: variance-authority.reach.relations

use std::collections::HashMap;

/// Two gains this close are one gain.
const TIE: f64 = 1e-12;

/// A node's neighbours in the order first connected, each with its summed weight.
#[derive(Default)]
struct Neighbours {
    order: Vec<(usize, f64)>,
    at: HashMap<usize, usize>,
}

impl Neighbours {
    fn add(&mut self, node: usize, weight: f64) {
        match self.at.get(&node) {
            Some(&at) => self.order[at].1 += weight,
            None => {
                self.at.insert(node, self.order.len());
                self.order.push((node, weight));
            }
        }
    }
}

/// `edges` over nodes `0..n`, undirected; one community per node per pass,
/// finest first. A graph with no weight has no passes.
pub(crate) fn louvain(n: usize, edges: &[(usize, usize, f64)]) -> Vec<Vec<u32>> {
    const PASSES: usize = 8;
    const SWEEPS: usize = 50;
    let mut passes: Vec<Vec<u32>> = Vec::new();
    let mut size = n;
    let mut current: Vec<(usize, usize, f64)> = edges.to_vec();
    // Each original node's node in the current graph.
    let mut of: Vec<usize> = (0..n).collect();
    for _ in 0..PASSES {
        let mut adjacent: Vec<Neighbours> = (0..size).map(|_| Neighbours::default()).collect();
        let mut degree = vec![0f64; size];
        let mut twice = 0f64;
        for &(i, j, w) in &current {
            adjacent[i].add(j, w);
            adjacent[j].add(i, w);
            degree[i] += w;
            degree[j] += w;
            twice += 2.0 * w;
        }
        if twice == 0.0 {
            break;
        }
        let mut community: Vec<usize> = (0..size).collect();
        let mut total = degree.clone();
        let (mut moved, mut any) = (true, false);
        let mut sweep = 0;
        while moved && sweep < SWEEPS {
            sweep += 1;
            moved = false;
            for i in 0..size {
                let own = community[i];
                let mut towards = Neighbours::default();
                for &(j, w) in &adjacent[i].order {
                    if j != i {
                        towards.add(community[j], w);
                    }
                }
                total[own] -= degree[i];
                let into_own = towards.at.get(&own).map_or(0.0, |&at| towards.order[at].1);
                let (mut best, mut gain) = (own, into_own - total[own] * degree[i] / twice);
                for &(c, w) in &towards.order {
                    let g = w - total[c] * degree[i] / twice;
                    if g > gain + TIE || ((g - gain).abs() <= TIE && c < best) {
                        best = c;
                        gain = g;
                    }
                }
                total[best] += degree[i];
                if best != own {
                    community[i] = best;
                    moved = true;
                    any = true;
                }
            }
        }
        if !any {
            break;
        }
        let mut renumbered: HashMap<usize, usize> = HashMap::new();
        for &c in &community {
            let next = renumbered.len();
            renumbered.entry(c).or_insert(next);
        }
        let count = renumbered.len();
        for node in of.iter_mut() {
            *node = renumbered[&community[*node]];
        }
        passes.push(of.iter().map(|&c| c as u32).collect());
        // What a community holds inside stays, as a loop on its node: it is
        // part of its degree.
        let mut merged: Vec<(usize, usize, f64)> = Vec::new();
        let mut at: HashMap<(usize, usize), usize> = HashMap::new();
        for &(i, j, w) in &current {
            let (a, b) = (renumbered[&community[i]], renumbered[&community[j]]);
            let key = if a < b { (a, b) } else { (b, a) };
            match at.get(&key) {
                Some(&slot) => merged[slot].2 += w,
                None => {
                    at.insert(key, merged.len());
                    merged.push((key.0, key.1, w));
                }
            }
        }
        current = merged;
        size = count;
    }
    passes
}

#[cfg(test)]
mod tests {
    use super::louvain;

    /// Two triangles joined by one thin edge are two communities.
    #[test]
    fn two_triangles_are_two_communities() {
        let edges = [(0, 1, 1.0), (1, 2, 1.0), (0, 2, 1.0), (3, 4, 1.0), (4, 5, 1.0), (3, 5, 1.0), (2, 3, 0.1)];
        let passes = louvain(6, &edges);
        let first = &passes[0];
        assert_eq!(first[0], first[1]);
        assert_eq!(first[1], first[2]);
        assert_eq!(first[3], first[4]);
        assert_eq!(first[4], first[5]);
        assert_ne!(first[0], first[3]);
    }

    #[test]
    fn no_weight_has_no_passes() {
        assert!(louvain(3, &[]).is_empty());
    }
}
