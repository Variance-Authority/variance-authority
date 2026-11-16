//! One output pool, and the translation of each input pool into it.
//!
//! Each input set is read once and interned once, however many regions name
//! it; a union or a difference is interned once per distinct pair. That keeps
//! a layering at the size of the sets rather than of the crossings they stand
//! for.

use rustc_hash::FxHashMap;

use crate::crossing_sets::{decode_set, set_slice, SetPool};

/// The empty set's id in a translation's pool, which interns it first.
pub(crate) const EMPTY: u32 = 0;

/// An input pool as it is stored: its bytes and offsets, and how many cases its ids range over.
pub(crate) struct Pool<'a> {
    pub bytes: &'a [u8],
    pub offsets: &'a [u32],
    pub tests: usize,
}

impl Pool<'_> {
    pub(crate) fn members(&self, set: u32) -> Result<Vec<u32>, String> {
        decode_set(set_slice(self.bytes, self.offsets, set)?, self.tests)
    }
}

/// An input pool's sets translated into the output pool through a remap of
/// its cases, each set once.
pub(crate) struct Source<'a> {
    pool: Pool<'a>,
    remap: Vec<i64>,
    memo: FxHashMap<u32, u32>,
}

pub(crate) struct Translation {
    sets: SetPool,
    members: Vec<Vec<u32>>,
    unions: FxHashMap<(u32, u32), u32>,
    differences: FxHashMap<(u32, u32), u32>,
}

impl Translation {
    pub(crate) fn new(tests: usize) -> Self {
        let mut translation = Translation { sets: SetPool::new(tests), members: Vec::new(), unions: FxHashMap::default(), differences: FxHashMap::default() };
        translation.intern(Vec::new());
        translation
    }

    /// `pool`'s sets through `remap`, which names -1 for a case that is gone.
    pub(crate) fn from<'a>(pool: Pool<'a>, remap: Vec<i64>) -> Source<'a> {
        Source { pool, remap, memo: FxHashMap::default() }
    }

    /// The output set of `set`, an input set of `from`.
    pub(crate) fn translate(&mut self, from: &mut Source<'_>, set: u32) -> Result<u32, String> {
        if let Some(found) = from.memo.get(&set) {
            return Ok(*found);
        }
        let mut members = Vec::new();
        for test in from.pool.members(set)? {
            let to = *from.remap.get(test as usize).ok_or_else(|| "a case index names a case it does not hold".to_owned())?;
            if to >= 0 {
                members.push(to as u32);
            }
        }
        members.sort_unstable();
        let found = self.intern(members);
        from.memo.insert(set, found);
        Ok(found)
    }

    pub(crate) fn union(&mut self, left: u32, right: u32) -> u32 {
        if left == right || right == EMPTY {
            return left;
        }
        if left == EMPTY {
            return right;
        }
        let key = (left.min(right), left.max(right));
        if let Some(found) = self.unions.get(&key) {
            return *found;
        }
        let mut members: Vec<u32> = self.members[left as usize].iter().chain(&self.members[right as usize]).copied().collect();
        members.sort_unstable();
        members.dedup();
        let found = self.intern(members);
        self.unions.insert(key, found);
        found
    }

    /// The output set of `members`, which are output cases.
    pub(crate) fn of(&mut self, members: impl IntoIterator<Item = u32>) -> u32 {
        let mut members: Vec<u32> = members.into_iter().collect();
        members.sort_unstable();
        members.dedup();
        self.intern(members)
    }

    /// The cases of `left` that `right` does not hold.
    pub(crate) fn minus(&mut self, left: u32, right: u32) -> u32 {
        if left == EMPTY || right == EMPTY {
            return left;
        }
        if let Some(found) = self.differences.get(&(left, right)) {
            return *found;
        }
        let without = &self.members[right as usize];
        let members: Vec<u32> = self.members[left as usize].iter().copied().filter(|test| without.binary_search(test).is_err()).collect();
        let found = self.intern(members);
        self.differences.insert((left, right), found);
        found
    }

    /// The cases an output set holds, ascending.
    pub(crate) fn members(&self, set: u32) -> &[u32] {
        &self.members[set as usize]
    }

    pub(crate) fn into_pool(self) -> SetPool {
        self.sets
    }

    fn intern(&mut self, members: Vec<u32>) -> u32 {
        let id = self.sets.intern(&members);
        if id as usize == self.members.len() {
            self.members.push(members);
        }
        id
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interns_the_empty_set_first_and_each_union_and_difference_once() {
        let mut sets = Translation::new(8);
        let (left, right) = (sets.of([3, 1, 3]), sets.of([2, 3]));
        assert_eq!(sets.members(EMPTY), &[] as &[u32]);
        assert_eq!(sets.members(left), &[1, 3]);
        let both = sets.union(left, right);
        assert_eq!(sets.members(both), &[1, 2, 3]);
        assert_eq!(sets.union(right, left), both);
        assert_eq!(sets.union(left, EMPTY), left);
        let rest = sets.minus(both, right);
        assert_eq!(sets.members(rest), &[1]);
        assert_eq!(sets.minus(EMPTY, right), EMPTY);
    }
}
