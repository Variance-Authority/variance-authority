//! The record's layout, read from `record-layout.json`, the one definition the
//! addon and `format-layout.ts` both read: the framing, the coverage sections and
//! their sentinels, the case parts, the set containers and the case index's
//! versions. A number here is never written a second time on either side.

use std::sync::LazyLock;

use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Layout {
    pub alignment: usize,
    pub pack_above: usize,
    pub run: usize,
    pub blob_run: usize,
    pub codecs: Codecs,
    pub levels: Levels,
    pub coverage: Coverage,
    pub sets: Sets,
    pub cases: Cases,
}

#[derive(Deserialize)]
pub struct Codecs {
    pub raw: u8,
    pub zstd: u8,
}

#[derive(Deserialize)]
pub struct Levels {
    pub numbers: i32,
    pub text: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Coverage {
    pub format: u8,
    /// The layout before the case parts: a record that kept no cases.
    pub uncased: u8,
    /// The layout before `tests.duration`, which the JVM agent writes.
    pub untimed: u8,
    /// The layout before `tests.phases`: a record whose runner reported no phases.
    pub unphased: u8,
    pub no_duration: u32,
    /// The owner a block with no owner carries: the module root's.
    pub no_owner: u32,
    /// The line a region written on no lines holds at both ends.
    pub no_line: u32,
    /// Every coverage section, in the order a record holds them.
    pub sections: Vec<String>,
    /// The section the untimed layout lacks.
    pub duration: String,
    /// The section every layout before the current one lacks.
    pub phases: String,
    /// The phases `tests.phases` holds a word each of for every test, in order.
    pub phase_names: Vec<String>,
    /// The case parts, `(part, section)`, in the order a record holds them after the coverage sections.
    pub parts: Vec<(String, String)>,
    pub block_kinds: Vec<String>,
    /// The kinds of region each reading of an edit leaves running as they ran;
    /// a reading absent here spares nothing.
    pub spared: std::collections::HashMap<String, Vec<String>>,
}

impl Coverage {
    /// The section a case part is stored under: `index`, `before`, `last` or
    /// `eyes`. Every caller names a part the layout defines, so one it does not
    /// is a build that cannot read its own records, and stops here.
    pub fn part(&self, part: &str) -> &str {
        match self.parts.iter().find(|(name, _)| name == part) {
            Some((_, section)) => section,
            None => panic!("record-layout.json names no case part {part}"),
        }
    }

    /// The layouts a reader opens: the current one, the one before phases,
    /// the one before the case parts, and the untimed one the JVM agent
    /// writes. `readableFormat` in `format-layout.ts` opens the same four.
    pub fn readable(&self, version: u8) -> bool {
        version == self.format || version == self.unphased || version == self.uncased || version == self.untimed
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sets {
    pub list: u8,
    pub bits: u8,
    pub runs: u8,
    pub narrow: usize,
}

impl Sets {
    /// Bytes one member of a list or a run takes, for a pool over `tests` tests.
    pub fn width(&self, tests: usize) -> usize {
        if tests < self.narrow { 2 } else { 4 }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cases {
    pub format: u8,
    /// Each case's duration, a word a case, `coverage.no_duration` where none was reported.
    pub duration: String,
    /// Each case's lines, a blob of one row a case.
    pub lines: String,
    pub lines_offsets: String,
}

pub static LAYOUT: LazyLock<Layout> = LazyLock::new(|| {
    // The file is compiled in; a layout that does not parse is a build defect,
    // which the unit test below fails on before any release carries it.
    serde_json::from_str(include_str!("../../record-layout.json")).expect("record-layout.json is the record's layout")
});

#[cfg(test)]
mod tests {
    use super::LAYOUT;

    #[test]
    fn reads_the_layout_both_sides_read() {
        assert_eq!(LAYOUT.coverage.sections.len(), 28);
        assert!(LAYOUT.coverage.sections.contains(&LAYOUT.coverage.phases));
        assert_eq!(LAYOUT.coverage.phase_names.len(), crate::record_coverage::PHASES);
        assert!(LAYOUT.coverage.sections.contains(&LAYOUT.coverage.duration));
        assert_eq!(LAYOUT.coverage.part("index"), "cases");
        assert!(LAYOUT.coverage.readable(LAYOUT.coverage.untimed));
        assert!(LAYOUT.coverage.readable(LAYOUT.coverage.uncased));
        assert!(!LAYOUT.coverage.readable(LAYOUT.coverage.untimed - 1));
        assert!(!LAYOUT.coverage.readable(LAYOUT.coverage.format + 1));
    }

    #[test]
    fn spares_every_kind_under_no_change_and_the_top_level_under_a_body_edit() {
        assert_eq!(LAYOUT.coverage.spared["none"], LAYOUT.coverage.block_kinds);
        assert_eq!(LAYOUT.coverage.spared["bodies"], ["module"]);
        assert!(!LAYOUT.coverage.spared.contains_key("load"));
    }
}
