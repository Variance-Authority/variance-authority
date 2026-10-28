//! A case's walk written out as steps: the routes `journeys_walk.rs` chose,
//! kept to the ones that lead to a function the case entered.

// compass: variance-authority.reach.relations

use super::{Kind, Walk};
use crate::journeys_record::NONE;
use crate::journeys_steps::Step;

/// The tree: region nodes, and the test helpers and unrecorded functions on a
/// route to one, each placed once, depth first in call order.
pub(super) fn emit(walk: &Walk, starts: &[u32], parent: &[u32]) -> Vec<Step> {
    let mut kids: Vec<Vec<u32>> = vec![Vec::new(); walk.nodes.len()];
    for &rank in parent.iter().filter(|&&rank| rank != NONE) {
        kids[walk.edges[rank as usize].from as usize].push(rank);
    }
    for list in &mut kids {
        list.sort_unstable();
    }
    let mut useful: Vec<Option<bool>> = vec![None; walk.nodes.len()];
    fn is_useful(node: u32, walk: &Walk, kids: &[Vec<u32>], useful: &mut [Option<bool>]) -> bool {
        if let Some(known) = useful[node as usize] {
            return known;
        }
        useful[node as usize] = Some(false);
        let value = walk.nodes[node as usize].kind == Kind::Region
            || kids[node as usize].iter().any(|&rank| is_useful(walk.edges[rank as usize].to, walk, kids, useful));
        useful[node as usize] = Some(value);
        value
    }
    let mut placed = vec![false; walk.nodes.len()];
    let mut steps = Vec::new();
    // Depth first, iteratively: (node, depth, next kid).
    for &start in starts {
        let mut stack: Vec<(u32, u32, usize)> = vec![(start, 0, 0)];
        while let Some(top) = stack.last_mut() {
            let (node, depth, next) = *top;
            let Some(&rank) = kids[node as usize].get(next) else {
                stack.pop();
                continue;
            };
            top.2 += 1;
            let edge = &walk.edges[rank as usize];
            if !is_useful(edge.to, walk, &kids, &mut useful) || placed[edge.to as usize] {
                continue;
            }
            placed[edge.to as usize] = true;
            let to = &walk.nodes[edge.to as usize];
            steps.push(Step { depth, region: to.region, file: to.file, tag: edge.tag, known: edge.known });
            stack.push((edge.to, depth + 1, 0));
        }
    }
    steps
}
