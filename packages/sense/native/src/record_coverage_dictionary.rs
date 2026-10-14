//! The strings a folded record names, and the rank each takes in its sorted
//! dictionary.
//!
//! A fold of shards learns its strings one shard at a time and lets each shard
//! go, so it keeps them: [`Dictionary`]. A layering holds both records it reads
//! until it has written, and every string it names is in one of their
//! dictionaries, so it keeps none: [`Merged`] ranks the two in one walk, and
//! the output's dictionary is spelled from the records themselves.

use rustc_hash::FxHashMap;

use crate::order;
use crate::record_coverage::Text;

/// A record's dictionary as it is written: the strings it names, sorted and
/// laid end to end, and the rank each id the fold gave out takes among them.
pub(crate) struct Spelled {
    pub blob: Vec<u8>,
    pub offsets: Vec<u32>,
    /// `u32::MAX` for an id the output does not name.
    pub rank: Vec<u32>,
}

impl Spelled {
    /// `names`, sorted, spelled; `names` is walked twice, so the dictionary is
    /// written into the room it takes rather than copied as it grows.
    fn of<'a, Names: Iterator<Item = (&'a str, u32)>>(names: impl Fn() -> Names, ids: usize) -> Self {
        let (count, bytes) = names().fold((0, 0), |(count, bytes), (value, _)| (count + 1, bytes + value.len()));
        let mut offsets = Vec::with_capacity(count + 1);
        offsets.push(0);
        let mut spelled = Spelled { blob: Vec::with_capacity(bytes), offsets, rank: vec![u32::MAX; ids] };
        for (at, (value, id)) in names().enumerate() {
            spelled.blob.extend_from_slice(value.as_bytes());
            spelled.offsets.push(spelled.blob.len() as u32);
            spelled.rank[id as usize] = at as u32;
        }
        spelled
    }
}

/// Strings the output may name, owned, numbered as they are first named and
/// ranked once the output is known.
#[derive(Default)]
pub(crate) struct Dictionary {
    ids: FxHashMap<Box<str>, u32>,
}

impl Dictionary {
    pub fn id(&mut self, value: &str) -> u32 {
        if let Some(id) = self.ids.get(value) {
            return *id;
        }
        let id = self.ids.len() as u32;
        self.ids.insert(value.into(), id);
        id
    }

    pub fn len(&self) -> usize {
        self.ids.len()
    }

    /// The strings `used` names, sorted.
    pub fn spelled(self, used: &[bool]) -> Spelled {
        let mut kept: Vec<(Box<str>, u32)> = self.ids.into_iter().filter(|(_, id)| used[*id as usize]).collect();
        kept.sort_unstable_by(|left, right| order::code_unit(&left.0, &right.0));
        Spelled::of(|| kept.iter().map(|(value, id)| (&**value, *id)), used.len())
    }
}

/// Two records' dictionaries as one: every string of either, ranked in
/// code-unit order, a string both hold one rank. The ranks are the fold's ids.
pub(crate) struct Merged {
    /// The rank of each string of the previous record, by its id there.
    pub previous: Vec<u32>,
    /// The rank of each string of the current record, by its id there.
    pub current: Vec<u32>,
    /// Per rank, where it is spelled: an id of the previous record, or the
    /// previous record's length plus an id of the current one.
    spelling: Vec<u32>,
}

impl Merged {
    pub fn new(previous: Text, current: Text) -> Self {
        let (before, now) = (Sorted::of(previous), Sorted::of(current));
        let mut merged = Merged {
            previous: vec![u32::MAX; previous.len()],
            current: vec![u32::MAX; current.len()],
            spelling: Vec::with_capacity(previous.len().max(current.len())),
        };
        let (mut left, mut right) = (0, 0);
        while left < before.len() || right < now.len() {
            let value = match (before.get(left), now.get(right)) {
                (Some(held), Some(read)) => std::cmp::min_by(previous.at(held), current.at(read), |a, b| order::code_unit(a, b)),
                (Some(held), None) => previous.at(held),
                (None, Some(read)) => current.at(read),
                (None, None) => break,
            };
            let rank = merged.spelling.len() as u32;
            let mut spelled = None;
            // A record that holds a string twice gives both ids the one rank.
            while let Some(held) = before.get(left).filter(|held| previous.at(*held) == value) {
                merged.previous[held as usize] = rank;
                spelled.get_or_insert(held);
                left += 1;
            }
            while let Some(read) = now.get(right).filter(|read| current.at(*read) == value) {
                merged.current[read as usize] = rank;
                spelled.get_or_insert(previous.len() as u32 + read);
                right += 1;
            }
            merged.spelling.push(spelled.unwrap_or_default());
        }
        merged
    }

    pub fn len(&self) -> usize {
        self.spelling.len()
    }

    /// The ranks `used` names, spelled from the two records.
    pub fn spelled(&self, previous: Text, current: Text, used: &[bool]) -> Spelled {
        let split = previous.len() as u32;
        let spell = |at: u32| if at < split { previous.at(at) } else { current.at(at - split) };
        Spelled::of(
            || (0..self.spelling.len() as u32).filter(|rank| used[*rank as usize]).map(|rank| (spell(self.spelling[rank as usize]), rank)),
            used.len(),
        )
    }
}

/// A record's string ids in code-unit order of their text: none held for the
/// sorted dictionary every record this build writes holds, where an id is its
/// own place.
enum Sorted {
    Already(usize),
    Ids(Vec<u32>),
}

impl Sorted {
    fn of(text: Text) -> Self {
        if (1..text.len() as u32).all(|id| order::code_unit(text.at(id - 1), text.at(id)).is_lt()) {
            return Sorted::Already(text.len());
        }
        let mut ids: Vec<u32> = (0..text.len() as u32).collect();
        ids.sort_by(|left, right| order::code_unit(text.at(*left), text.at(*right)));
        Sorted::Ids(ids)
    }

    fn get(&self, at: usize) -> Option<u32> {
        match self {
            Sorted::Already(len) => (at < *len).then_some(at as u32),
            Sorted::Ids(ids) => ids.get(at).copied(),
        }
    }

    fn len(&self) -> usize {
        match self {
            Sorted::Already(len) => *len,
            Sorted::Ids(ids) => ids.len(),
        }
    }
}

#[cfg(test)]
#[path = "record_coverage_dictionary_tests.rs"]
mod tests;
