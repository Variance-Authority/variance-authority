//! The map as a tree: the packages split into a dozen or so parts the three
//! signals agree on, and each part split the same way, down to parts small
//! enough to list.
//!
//! A signal is judged inside the part being split, so `under src` says
//! nothing at the top of `src/` and a great deal at the top of the repository,
//! and the communities of use are found again inside each part rather than
//! inherited from the whole. A signal agrees with a set of packages by
//! precision times recall of its best key.

// compass: variance-authority.reach.relations

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use crate::louvain::louvain;
use crate::orient_map_signals::Signals;

const FAN: usize = 12;
const LEAF: usize = 12;
const MIN_SIZE: usize = 3;
const ACCEPT: [f64; 2] = [1.5, 1.0];
const CAP_SHARE: f64 = 1.0 / 3.0;
const ABSORB: f64 = 0.34;

pub(crate) struct Node {
    /// Positions in [`Signals::packages`], ascending, which is name order.
    pub members: Vec<usize>,
    pub parts: Vec<Node>,
    /// Members no part took.
    pub alone: Vec<usize>,
    /// Carved off because the manifests answered it: for development.
    pub answered: bool,
}

pub(crate) fn tree(signals: &Signals) -> Node {
    let all: Vec<usize> = (0..signals.packages.len()).collect();
    split(signals, all, 0, false)
}

/// Keys of one signal inside one part: each member's, and each key's members,
/// in the order first seen.
struct Index {
    of: Vec<Vec<usize>>,
    keys: Vec<String>,
    members: Vec<Vec<usize>>,
    kept: Vec<bool>,
}

impl Index {
    fn new(per: impl Iterator<Item = Vec<String>>, count: usize) -> Index {
        let mut index = Index { of: Vec::new(), keys: Vec::new(), members: Vec::new(), kept: Vec::new() };
        let mut at: HashMap<String, usize> = HashMap::new();
        for (member, keys) in per.enumerate() {
            let mut mine = Vec::new();
            for key in keys {
                let slot = *at.entry(key.clone()).or_insert_with(|| {
                    index.keys.push(key);
                    index.members.push(Vec::new());
                    index.keys.len() - 1
                });
                if index.members[slot].last() != Some(&member) {
                    index.members[slot].push(member);
                    mine.push(slot);
                }
            }
            index.of.push(mine);
        }
        // A key every member carries says nothing inside this part.
        index.kept = index.members.iter().map(|members| members.len() != count).collect();
        index
    }

    /// The best key for `set` (local positions): its score and key slot.
    fn agree(&self, set: &[usize]) -> (f64, Option<usize>) {
        let mut hits: HashMap<usize, usize> = HashMap::new();
        for &member in set {
            for &slot in &self.of[member] {
                if self.kept[slot] {
                    *hits.entry(slot).or_default() += 1;
                }
            }
        }
        let mut best: (f64, Option<usize>) = (0.0, None);
        for (slot, n) in hits {
            let score = (n as f64 / set.len() as f64) * (n as f64 / self.members[slot].len() as f64);
            let wins = match best.1 {
                None => score > 0.0,
                Some(held) => score > best.0 || (score == best.0 && crate::order::code_unit(&self.keys[slot], &self.keys[held]) == Ordering::Less),
            };
            if wins {
                best = (score, Some(slot));
            }
        }
        best
    }
}

struct Proposal {
    /// Local positions, ascending.
    set: Vec<usize>,
    quality: f64,
}

fn split(signals: &Signals, all: Vec<usize>, depth: usize, answered: bool) -> Node {
    let mut node = Node { members: all.clone(), parts: Vec::new(), alone: Vec::new(), answered };
    if all.len() <= LEAF {
        node.alone = all;
        return node;
    }
    // What an owner answered is carved off first, and the rest is judged as if it were the whole.
    let mut pre: Vec<Vec<usize>> = Vec::new();
    if depth == 0 {
        let carved: Vec<usize> = all.iter().copied().filter(|p| signals.development.contains(p)).collect();
        if carved.len() >= MIN_SIZE && carved.len() < all.len() {
            pre.push(carved);
        }
    }
    let carved: HashSet<usize> = pre.iter().flatten().copied().collect();
    let n: Vec<usize> = all.iter().copied().filter(|p| !carved.contains(p)).collect();
    let local_at: HashMap<usize, usize> = n.iter().enumerate().map(|(i, &p)| (p, i)).collect();
    let local: Vec<(usize, usize, f64)> = signals
        .wedges
        .iter()
        .filter_map(|&(i, j, w)| Some((*local_at.get(&i)?, *local_at.get(&j)?, w)))
        .collect();
    let near = louvain(n.len(), &local);
    let indexes: Vec<Index> = (0..3)
        .map(|s| {
            let per = n.iter().enumerate().map(|(i, &p)| {
                let mut keys = signals.keys[s][p].clone();
                if s == 2 {
                    keys.extend(near.iter().enumerate().map(|(k, pass)| format!("together here {k}:{}", pass[i])));
                }
                keys
            });
            Index::new(per, n.len())
        })
        .collect();
    let judge = |set: &[usize]| indexes.iter().map(|index| index.agree(set).0).sum::<f64>();
    // Every kept key's members, once per distinct set, in the order proposed.
    let mut proposals: Vec<Vec<usize>> = Vec::new();
    let mut proposed: HashSet<Vec<usize>> = HashSet::new();
    for index in &indexes {
        for (slot, members) in index.members.iter().enumerate() {
            if index.kept[slot] && proposed.insert(members.clone()) {
                proposals.push(members.clone());
            }
        }
    }
    // Coarsest agreed first: a part mostly inside a larger one the signals
    // also agree on waits for the level below.
    let order = |a: &Proposal, b: &Proposal| {
        b.set.len().cmp(&a.set.len()).then(b.quality.partial_cmp(&a.quality).unwrap_or(Ordering::Equal)).then(a.set[0].cmp(&b.set[0]))
    };
    let mut out: Vec<Vec<usize>> = Vec::new();
    let mut taken = vec![false; n.len()];
    let room = FAN.saturating_sub(pre.len());
    let cap = MIN_SIZE.max((n.len() as f64 * CAP_SHARE).ceil() as usize);
    if room > 0 {
        let mut min = MIN_SIZE.max(n.len().div_ceil(room));
        while out.len() < room {
            for bar in ACCEPT {
                let mut queue: Vec<Proposal> = proposals
                    .iter()
                    .map(|set| set.iter().copied().filter(|&p| !taken[p]).collect::<Vec<_>>())
                    .filter(|set| set.len() >= min && set.len() <= cap)
                    .map(|set| Proposal { quality: judge(&set), set })
                    .collect();
                queue.sort_by(order);
                let mut queue: std::collections::VecDeque<Proposal> = queue.into();
                while out.len() < room {
                    let Some(x) = queue.pop_front() else { break };
                    if x.quality < bar {
                        continue;
                    }
                    let set: Vec<usize> = x.set.iter().copied().filter(|&p| !taken[p]).collect();
                    if set.len() < min {
                        continue;
                    }
                    if set.len() < x.set.len() {
                        let y = Proposal { quality: judge(&set), set };
                        if y.quality < bar {
                            continue;
                        }
                        let at = queue.iter().position(|z| order(&y, z) == Ordering::Less).unwrap_or(queue.len());
                        queue.insert(at, y);
                        continue;
                    }
                    for &p in &set {
                        taken[p] = true;
                    }
                    out.push(set);
                }
            }
            if min == MIN_SIZE {
                break;
            }
            min = MIN_SIZE.max(min >> 1);
        }
    }
    for carved in pre.iter() {
        node.parts.push(split(signals, carved.clone(), depth + 1, true));
    }
    if out.is_empty() && pre.is_empty() {
        node.alone = n;
        return node;
    }
    // A package no part took joins the part holding most of its connections
    // here, when one part holds at least a third of them.
    let mut part_of: HashMap<usize, usize> = HashMap::new();
    for (q, set) in out.iter().enumerate() {
        for &p in set {
            part_of.insert(p, q);
        }
    }
    if out.len() > 1 {
        let mut degree = vec![0f64; n.len()];
        let mut towards: Vec<(usize, Vec<(usize, f64)>)> = Vec::new();
        let mut slot: HashMap<usize, usize> = HashMap::new();
        for &(a, b, w) in &local {
            for (x, y) in [(a, b), (b, a)] {
                degree[x] += w;
                let Some(&q) = part_of.get(&y) else { continue };
                if part_of.contains_key(&x) {
                    continue;
                }
                let at = *slot.entry(x).or_insert_with(|| {
                    towards.push((x, Vec::new()));
                    towards.len() - 1
                });
                match towards[at].1.iter_mut().find(|(part, _)| *part == q) {
                    Some(entry) => entry.1 += w,
                    None => towards[at].1.push((q, w)),
                }
            }
        }
        for (x, parts) in &towards {
            let best = parts.iter().copied().min_by(|u, v| v.1.partial_cmp(&u.1).unwrap_or(Ordering::Equal).then(u.0.cmp(&v.0)));
            if let Some((q, w)) = best {
                if w >= ABSORB * degree[*x] {
                    out[q].push(*x);
                    taken[*x] = true;
                }
            }
        }
    }
    let rest: Vec<usize> = (0..n.len()).filter(|&p| !taken[p]).map(|p| n[p]).collect();
    for set in out {
        let mut members: Vec<usize> = set.into_iter().map(|p| n[p]).collect();
        members.sort_unstable();
        node.parts.push(split(signals, members, depth + 1, false));
    }
    if rest.len() > 3 {
        node.parts.push(split(signals, rest, depth + 1, false));
    } else {
        node.alone = rest;
    }
    node
}
