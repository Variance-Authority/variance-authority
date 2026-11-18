//! The regions and insertions a walk emits at the boundaries it visits.

use std::fmt::Write;

use super::{Block, Edit, Kind, Walker};

impl Walker {
    pub fn open(&mut self, kind: Kind, path: &str, start: u32, end: u32, owner: Option<u32>) -> u32 {
        let ordinal = self.opened;
        self.opened += 1;
        self.source_regions += u32::from(end > start);
        if !self.emit {
            return ordinal;
        }
        let name = self.scope().name.clone();
        self.blocks.push(Block { kind, owner, name, path: path.to_string(), start, end });
        ordinal
    }

    pub(super) fn push(&mut self, at: u32, text: std::fmt::Arguments) {
        if !self.emit {
            return;
        }
        let from = self.texts.len() as u32;
        let _ = self.texts.write_fmt(text);
        self.edits.push(Edit { at, from, to: self.texts.len() as u32 });
    }

    pub(super) fn hit(&mut self, at: u32, ordinal: u32) {
        if !self.emit {
            return;
        }
        let probe = self.probe(ordinal);
        self.push(at, format_args!("{probe};"));
    }

    /// The region head: returns the ordinal and, for a bare statement, the closer's offset.
    pub(super) fn enter(&mut self, span: (u32, u32), block: bool, kind: Kind, path: &str) -> (u32, Option<u32>) {
        let owner = self.owner;
        let ordinal = self.open(kind, path, span.0, span.1, Some(owner));
        if !self.emit {
            return (ordinal, None);
        }
        if block {
            self.hit(span.0 + 1, ordinal);
            return (ordinal, None);
        }
        let probe = self.probe(ordinal);
        self.push(span.0, format_args!("{{{probe};"));
        (ordinal, Some(span.1))
    }

    pub(super) fn close(&mut self, closer: Option<u32>) {
        if let Some(at) = closer {
            self.push(at, format_args!("}}"));
        }
    }

}
