//! The one breadth-first walk the addon runs over a file graph's compressed rows.

// compass: variance-authority.reach.source-index

/// Every node reached from `seeds` at once, in the order entered, first in,
/// first out. `enter(from, edge, to)` decides whether `to` is entered, and
/// records whatever the caller keeps: `from` and `edge` are absent for a seed.
pub(crate) fn breadth_first(offset: &[u32], target: &[u32], seeds: &[u32], mut enter: impl FnMut(Option<(u32, usize)>, u32) -> bool) -> Vec<u32> {
    let mut queue: Vec<u32> = seeds.iter().copied().filter(|&seed| enter(None, seed)).collect();
    let mut head = 0;
    while head < queue.len() {
        let node = queue[head];
        head += 1;
        for edge in offset[node as usize] as usize..offset[node as usize + 1] as usize {
            let next = target[edge];
            if enter(Some((node, edge)), next) {
                queue.push(next);
            }
        }
    }
    queue
}
