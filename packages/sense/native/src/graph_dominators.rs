//! Dominance over a rooted directed graph: which node every path from the root
//! to another one passes through.
//!
//! Cooper, Harvey and Kennedy's iteration — intersect the predecessors'
//! immediate dominators in reverse postorder until nothing changes — over local
//! ids, then entry and exit times over the dominator tree, so "a dominates b"
//! is one interval test. The caller walks its own graph and hands over what the
//! iteration needs: a postorder of the nodes the root reaches, the root `0`
//! last, each node's place in it, and each node's predecessors as compressed
//! rows. The buffers are kept between calls, so a caller asking it once per
//! test file allocates once per thread.

// compass: variance-authority.reach.relations

const NONE: u32 = u32::MAX;

/// The dominator tree of the last graph built, and the buffers that built it.
#[derive(Default)]
pub(crate) struct Dominators {
    idom: Vec<u32>,
    below: Vec<u32>,
    children: Vec<u32>,
    tin: Vec<u32>,
    tout: Vec<u32>,
    stack: Vec<(u32, u32)>,
}

impl Dominators {
    /// The dominators of the graph whose root is node `0`: `order` is a
    /// postorder of every node the root reaches, `number[node]` its place in
    /// it, and `predecessors[into[node]..into[node + 1]]` the nodes with an
    /// edge into `node`.
    pub fn build(&mut self, order: &[u32], number: &[u32], into: &[u32], predecessors: &[u32]) {
        let count = number.len();
        self.idom.clear();
        self.idom.resize(count, NONE);
        if count == 0 {
            return;
        }
        self.idom[0] = 0;
        let mut changed = true;
        while changed {
            changed = false;
            for at in (0..order.len().saturating_sub(1)).rev() {
                let node = order[at] as usize;
                let mut next = NONE;
                for from in &predecessors[into[node] as usize..into[node + 1] as usize] {
                    if self.idom[*from as usize] == NONE {
                        continue;
                    }
                    next = if next == NONE { *from } else { intersect(&self.idom, number, *from, next) };
                }
                if next != NONE && self.idom[node] != next {
                    self.idom[node] = next;
                    changed = true;
                }
            }
        }
        self.tree(count);
    }

    /// The immediate dominator of `node`; the root's is itself.
    pub fn idom(&self, node: usize) -> u32 {
        self.idom[node]
    }

    /// Whether every path from the root to `node` passes through `over`, `node` itself included.
    pub fn dominates(&self, over: usize, node: usize) -> bool {
        self.tin[over] <= self.tin[node] && self.tout[node] <= self.tout[over]
    }

    /// Entry and exit times over the dominator tree.
    fn tree(&mut self, count: usize) {
        self.below.clear();
        self.below.resize(count + 1, 0);
        for node in 1..count {
            self.below[self.idom[node] as usize + 1] += 1;
        }
        for at in 0..count {
            self.below[at + 1] += self.below[at];
        }
        self.children.clear();
        self.children.resize(count - 1, 0);
        let mut fill = self.below.clone();
        for node in 1..count {
            let parent = self.idom[node] as usize;
            self.children[fill[parent] as usize] = node as u32;
            fill[parent] += 1;
        }
        self.tin.clear();
        self.tin.resize(count, 0);
        self.tout.clear();
        self.tout.resize(count, 0);
        let mut clock = 0;
        self.stack.clear();
        self.stack.push((0, 0));
        while let Some(&(node, cursor)) = self.stack.last() {
            let (from, to) = (self.below[node as usize], self.below[node as usize + 1]);
            if from + cursor == to {
                self.stack.pop();
                clock += 1;
                self.tout[node as usize] = clock;
                continue;
            }
            self.stack.last_mut().unwrap().1 += 1;
            let child = self.children[(from + cursor) as usize];
            clock += 1;
            self.tin[child as usize] = clock;
            self.stack.push((child, 0));
        }
    }
}

fn intersect(idom: &[u32], number: &[u32], left: u32, right: u32) -> u32 {
    let (mut a, mut b) = (left, right);
    while a != b {
        while number[a as usize] < number[b as usize] {
            a = idom[a as usize];
        }
        while number[b as usize] < number[a as usize] {
            b = idom[b as usize];
        }
    }
    a
}

#[cfg(test)]
mod tests {
    use super::Dominators;

    /// `edges` over nodes `0..count`, root `0`, as `build` takes them.
    fn built(count: usize, edges: &[(u32, u32)]) -> Dominators {
        let mut successors = vec![Vec::new(); count];
        for (from, to) in edges {
            successors[*from as usize].push(*to);
        }
        let (mut order, mut seen, mut stack) = (Vec::new(), vec![false; count], vec![(0u32, 0usize)]);
        seen[0] = true;
        while let Some(&(node, cursor)) = stack.last() {
            if cursor == successors[node as usize].len() {
                stack.pop();
                order.push(node);
                continue;
            }
            stack.last_mut().unwrap().1 += 1;
            let next = successors[node as usize][cursor];
            if !seen[next as usize] {
                seen[next as usize] = true;
                stack.push((next, 0));
            }
        }
        let mut number = vec![0; count];
        for (at, node) in order.iter().enumerate() {
            number[*node as usize] = at as u32;
        }
        let mut into = vec![0u32; count + 1];
        for (_, to) in edges {
            into[*to as usize + 1] += 1;
        }
        for at in 0..count {
            into[at + 1] += into[at];
        }
        let mut predecessors = vec![0; edges.len()];
        let mut fill = into.clone();
        for (from, to) in edges {
            predecessors[fill[*to as usize] as usize] = *from;
            fill[*to as usize] += 1;
        }
        let mut dominators = Dominators::default();
        dominators.build(&order, &number, &into, &predecessors);
        dominators
    }

    #[test]
    fn a_chain_is_dominated_link_by_link() {
        // test 0 -> a 1 -> b 2 -> c 3
        let found = built(4, &[(0, 1), (1, 2), (2, 3)]);
        assert_eq!((0..4).map(|node| found.idom(node)).collect::<Vec<_>>(), [0, 0, 1, 2]);
        assert!(found.dominates(0, 3));
        assert!(found.dominates(1, 3));
    }

    #[test]
    fn parting_paths_meet_at_the_first_shared_node() {
        // test 0 -> {a 1, b 2} -> shared 3 -> deep 4
        let found = built(5, &[(0, 1), (0, 2), (1, 3), (2, 3), (3, 4)]);
        assert_eq!((1..5).map(|node| found.idom(node)).collect::<Vec<_>>(), [0, 0, 0, 3]);
        assert!(!found.dominates(1, 4));
        assert!(found.dominates(3, 4));
    }

    #[test]
    fn a_cycle_with_an_exit_keeps_the_chain_to_the_exit() {
        // test 0 -> a 1 -> b 2 -> c 3 -> {a 1, d 4}
        let found = built(5, &[(0, 1), (1, 2), (2, 3), (3, 1), (3, 4)]);
        assert_eq!((1..5).map(|node| found.idom(node)).collect::<Vec<_>>(), [0, 1, 2, 3]);
        assert!(found.dominates(1, 4));
    }

    #[test]
    fn a_predecessor_settled_later_is_skipped_until_it_is() {
        // test 0 -> a 1 -> b 2, and b 2 -> a 1 arrives before b has a dominator.
        // A node the root does not reach is never handed in: the caller numbers only what its walk reached.
        let found = built(3, &[(2, 1), (0, 1), (1, 2)]);
        assert_eq!((0..3).map(|node| found.idom(node)).collect::<Vec<_>>(), [0, 0, 1]);
    }

    #[test]
    fn a_diamond_is_dominated_by_its_top() {
        // 0 -> 1 -> {2, 3} -> 4
        let found = built(5, &[(0, 1), (1, 2), (1, 3), (2, 4), (3, 4)]);
        assert_eq!((1..5).map(|node| found.idom(node)).collect::<Vec<_>>(), [0, 1, 1, 1]);
        assert!(found.dominates(1, 4));
        assert!(!found.dominates(2, 4));
        assert!(found.dominates(4, 4));
    }

    #[test]
    fn a_cycle_back_into_a_chain_keeps_the_chain() {
        // 0 -> 1 -> 2 -> 3 -> 1
        let found = built(4, &[(0, 1), (1, 2), (2, 3), (3, 1)]);
        assert_eq!((1..4).map(|node| found.idom(node)).collect::<Vec<_>>(), [0, 1, 2]);
        assert!(found.dominates(1, 3));
        assert!(!found.dominates(3, 1));
    }
}
