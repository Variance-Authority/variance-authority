//! The text heap of the parse columns: the signatures, docs and lines the
//! parse cut, each distinct text once, and the runs' heaps joined into one.

// compass: variance-authority.reach.source-index

use std::hash::BuildHasher;

use crate::segment::{u32s, u8_parts, Column, NONE};

/// The size a part of the text heap's blob grows to before the next opens.
pub(super) const PART: usize = 16 << 20;

/// The text heap: the signatures, docs and lines the parse cut, each distinct
/// text once, as a dictionary encoding keeps a repeated value: the line a
/// bundle's declarations share is one text, however many name it. Not the
/// segment's dictionary: these are long and never looked up by value, and
/// sorting them into it was most of what they cost to write. The blob is held
/// in the parts it was written in, `held` bytes before `blob`; a run's
/// distinct texts are copied into the joined heap, and the joined heap once
/// into the segment.
#[derive(Default)]
pub(super) struct Heap {
    pub(super) parts: Vec<Vec<u8>>,
    /// The offset each of `parts` starts at.
    starts: Vec<usize>,
    held: usize,
    blob: Vec<u8>,
    ends: Vec<u32>,
    /// A text's hash to its id; a hash another text holds moves to the next.
    ids: std::collections::HashMap<u64, u32, rustc_hash::FxBuildHasher>,
}

impl Heap {
    /// The id of `text`, appended unless the heap holds it, or `NONE` when
    /// there is none.
    pub(super) fn push(&mut self, text: Option<&str>) -> u32 {
        text.map_or(NONE, |text| self.keep(text.as_bytes()))
    }

    /// The id of `text`, appended unless the heap holds it.
    fn keep(&mut self, text: &[u8]) -> u32 {
        let mut hash = rustc_hash::FxBuildHasher.hash_one(text);
        while let Some(&id) = self.ids.get(&hash) {
            if self.text(id) == text {
                return id;
            }
            hash = hash.wrapping_add(1);
        }
        // A part that would grow is closed instead: growing copies what it
        // holds, and the copy keeps every page it reaches.
        if self.blob.len() + text.len() > self.blob.capacity() && self.blob.capacity() >= PART {
            self.starts.push(self.held);
            self.held += self.blob.len();
            self.parts.push(std::mem::replace(&mut self.blob, Vec::with_capacity(PART)));
        }
        self.blob.extend_from_slice(text);
        self.ends.push((self.held + self.blob.len()) as u32);
        let id = self.ends.len() as u32 - 1;
        self.ids.insert(hash, id);
        id
    }

    /// The bytes of the `id`-th text; a text never spans two parts.
    fn text(&self, id: u32) -> &[u8] {
        let end = self.ends[id as usize] as usize;
        let start = id.checked_sub(1).map_or(0, |before| self.ends[before as usize] as usize);
        if start >= self.held {
            return &self.blob[start - self.held..end - self.held];
        }
        let part = self.starts.partition_point(|&first| first <= start) - 1;
        let first = self.starts[part];
        &self.parts[part][start - first..end - first]
    }

    /// `other`'s texts after these, each kept once: the id these give each
    /// id `other` gave. Ids run in the order one pass would first meet them.
    pub(super) fn append(&mut self, other: Heap) -> Vec<u32> {
        (0..other.ends.len() as u32).map(|id| self.keep(other.text(id))).collect()
    }

    /// `texts.blob` and `texts.off`: the `id`-th text runs from offset `id`
    /// to offset `id + 1`, and the first offset is 0.
    pub(super) fn columns(mut self) -> [Column; 2] {
        let mut off = Vec::with_capacity(self.ends.len() + 1);
        off.push(0);
        off.extend(self.ends);
        self.parts.push(self.blob);
        [u8_parts("texts.blob", self.parts), u32s("texts.off", off)]
    }
}
