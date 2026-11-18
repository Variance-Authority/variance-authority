//! A source update's slice facts become records and existing parse generations.

// compass: variance-authority.reach.source-index

use std::collections::HashSet;
use std::time::{Duration, Instant};

use rayon::prelude::*;

use super::Row;
use crate::acquire::Answer;
use crate::batch::Acquired;
use crate::compact::{Layer, ParseView};
use crate::index::{parses_only, way};
use crate::parse_columns::ParseRow;
use crate::parse_store::{key, Parse};
use crate::record::{built, Settling};

#[derive(Default)]
pub(super) struct Parses {
    pub segments: Vec<Vec<u8>>,
    seen: HashSet<String>,
    count: usize,
    largest: usize,
    settling: Duration,
    encoding: Duration,
    releasing: Duration,
}

impl Parses {
    /// Keep each root key once. Kept reads contain only resolver facts, so the
    /// whole parse is taken from its existing view when this root lacks it.
    pub fn consume<'s, 'a: 's>(
        &mut self,
        files: &[String],
        read: Vec<Answer>,
        acquired: Vec<Acquired>,
        targets: &[Vec<Vec<String>>],
        settling: &Settling,
        layers: &[Layer],
        held: &(impl Fn(&str, &str) -> Option<ParseView<'s, 'a>> + Sync),
    ) -> Vec<(String, Row)> {
        self.largest = self.largest.max(read.len());
        let began = Instant::now();
        let rows = files.par_iter().zip(read.par_iter()).zip(acquired.par_iter()).zip(targets.par_iter())
            .map(|(((file, (read, _, outcome)), acquired), targets)| {
                let indexed = built(file, &acquired.identity, read, *outcome, targets, settling);
                (file.clone(), Row { indexed, parsed: outcome.parsed() })
            }).collect();
        self.settling += began.elapsed();
        let began = Instant::now();
        let mut parses = Vec::new();
        for ((file, (read, _, outcome)), acquired) in files.iter().zip(&read).zip(&acquired) {
            if !outcome.parsed() || acquired.identity.is_empty() { continue }
            let way = way(file);
            let key = key(&acquired.identity, &way);
            if !self.seen.insert(key.clone()) { continue }
            let parse = if acquired.kept {
                Parse::Kept(held(&acquired.identity, file).expect("an acquired kept parse retains its full view"))
            } else {
                Parse::Read(read)
            };
            if crate::chain_lookup::parse(layers, &acquired.identity, &way).is_some_and(|(at, row)|
                !parse.harvested() || ParseView::of(&layers[at], row).harvested()) { continue }
            parses.push((key, parse));
        }
        if !parses.is_empty() {
            parses.sort_by(|left, right| crate::order::code_unit(&left.0, &right.0));
            let rows: Vec<_> = parses.iter().map(|(key, parse)| (key.as_str(), parse)).collect();
            self.segments.push(parses_only(&rows));
            self.count += rows.len();
        }
        self.encoding += began.elapsed();
        drop(parses);
        let began = Instant::now();
        read.into_par_iter().for_each(drop);
        self.releasing += began.elapsed();
        rows
    }

    pub fn trace(&self) {
        if std::env::var("VARIANCE_SENSE_TIMINGS").is_ok_and(|value| value == "1") {
            eprintln!("sense source slices: {} parse segments, {} unique root parses, {} encoded bytes, {} max rich rows per slice; settle {:.1} ms; encode {:.1} ms; release {:.1} ms",
                self.segments.len(), self.count, self.segments.iter().map(Vec::len).sum::<usize>(), self.largest,
                self.settling.as_secs_f64()*1000.0, self.encoding.as_secs_f64()*1000.0, self.releasing.as_secs_f64()*1000.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fresh_harvest_replaces_a_minimal_parse_already_in_the_root() {
        let file = "a.ts".to_owned();
        let key = key("digest", &way(&file));
        let minimal = crate::source_read::SourceRead::default();
        let base = parses_only(&[(key.as_str(), &minimal)]);
        let layers = [Layer::open(&base).unwrap()];
        let rich = crate::source_read::SourceRead::read(&file, "/** Kept docs. */ export function named() { return 1; }", &oxc_allocator::Allocator::default(), true);
        let expected = parses_only(&[(key.as_str(), &rich)]);
        let empty = HashSet::new();
        let settling = Settling { builtins: &empty, code: &empty, remembering: true, directories: &empty, aliases: None };
        let mut sink = Parses::default();
        sink.consume(&[file], vec![(rich, "digest".to_owned(), crate::acquire::Outcome::Parsed)], vec![Acquired { identity: "digest".to_owned(), kept: false }], &[Vec::new()], &settling, &layers, &|_, _| None);
        assert_eq!(sink.segments.len(), 1, "the existing key does not already hold this harvest");
        assert_eq!(crate::compact::merged(&[&base], &sink.segments.iter().map(Vec::as_slice).collect::<Vec<_>>()).unwrap(), expected);
    }

    #[test]
    fn duplicate_content_in_later_slices_is_kept_once_per_reading_way() {
        let read = crate::source_read::SourceRead::read("a.ts", "/** Kept docs. */ export function named() { return 1; }", &oxc_allocator::Allocator::default(), true);
        let empty = HashSet::new();
        let settling = Settling { builtins: &empty, code: &empty, remembering: true, directories: &empty, aliases: None };
        let mut sink = Parses::default();
        for files in [vec!["a.ts".to_owned()], vec!["duplicate.ts".to_owned(), "other.tsx".to_owned()], vec!["last.tsx".to_owned()]] {
            let reads = files.iter().map(|_| (read.clone(), "digest".to_owned(), crate::acquire::Outcome::Parsed)).collect();
            let acquired = files.iter().map(|_| Acquired { identity: "digest".to_owned(), kept: false }).collect();
            let targets = vec![Vec::new(); files.len()];
            let rows = sink.consume(&files, reads, acquired, &targets, &settling, &[], &|_, _| None);
            assert_eq!(rows.len(), files.len(), "deduplication of parses keeps every file record");
        }
        let layers: Vec<_> = sink.segments.iter().map(|bytes| Layer::open(bytes).unwrap()).collect();
        assert_eq!(layers.iter().map(|layer| layer.parses.key.len()).sum::<usize>(), 2);
        assert!(crate::chain_lookup::parse(&layers, "digest", &way("a.ts")).is_some());
        assert!(crate::chain_lookup::parse(&layers, "digest", &way("other.tsx")).is_some());
        let keys = [key("digest", &way("a.ts")), key("digest", &way("other.tsx"))];
        let expected = parses_only(&[(keys[0].as_str(), &read), (keys[1].as_str(), &read)]);
        assert_eq!(crate::compact::compacted(&sink.segments.iter().map(Vec::as_slice).collect::<Vec<_>>()).unwrap(), expected);
    }
}
