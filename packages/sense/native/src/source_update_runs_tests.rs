//! A generation written from slice runs against one written from the reads.

use oxc_allocator::Allocator;

use super::{view, Runs};
use crate::compact::Layer;
use crate::generation::{encode_generation, Deleted, Generation};
use crate::index::{parses_only, way};
use crate::order::code_unit;
use crate::parse_store::key;
use crate::read::{read_module, Read};

/// Modules that fill every column a read writes: requests and their bindings,
/// exports with signatures and docs, symbols, members, mocks, member uses, and
/// one declined read.
const SOURCES: [(&str, &str); 6] = [
    (
        "src/a.ts",
        "import React, { useState as useS } from 'react';\nimport type { B } from './b';\n/** Adds. */\nexport function add(x: number, y: number): number { return x + y; }\nexport default class Panel extends React.Component { render() { return this.props.x.y; } }\nexport { B };\n",
    ),
    ("src/b.ts", "export * from './c';\nexport type B = { b: string };\nexport const b = 1, c = () => 2;\n"),
    (
        "src/c.test.ts",
        "import { add } from './a';\njest.mock('./b', () => ({ b: 3 }));\nconst api = require('./c');\ndescribe('add', () => { it('adds', () => { expect(add(1, 2)).toBe(api.three); }); });\n",
    ),
    ("src/d.ts", "/** A thing. */\nexport interface Thing { name: string }\nexport enum Way { One, Two }\nexport namespace N { export const n = 1; }\n"),
    ("src/e.css", "@import './a.css';\n.a { color: red }\n"),
    ("src/f.ts", "export async function* walk() { yield await import('./a'); }\nexport { add as plus } from './a';\n"),
];

fn reads() -> Vec<(String, String, Read)> {
    let mut reads: Vec<(String, String, Read)> = SOURCES
        .iter()
        .enumerate()
        .map(|(row, (file, source))| ((*file).to_owned(), format!("git:{row}"), read_module(file, source, &Allocator::default(), true)))
        .collect();
    // A file read twice under one name, as two paths holding the same bytes are.
    reads.push(("src/again/a.ts".to_owned(), "git:0".to_owned(), reads[0].2.clone()));
    reads.push(("src/declined.ts".to_owned(), "git:x".to_owned(), Read { unknown: Some("too large".to_owned()), ..Read::default() }));
    reads
}

fn keyed<P>(rows: impl Iterator<Item = (String, P)>) -> Vec<(String, P)> {
    let mut rows: Vec<(String, P)> = rows.collect();
    rows.sort_by(|left, right| code_unit(&left.0, &right.0));
    rows.dedup_by(|left, right| left.0 == right.0);
    rows
}

fn generation<P: crate::parse_columns::ParseRow>(parses: &[(&str, &P)]) -> Vec<u8> {
    encode_generation(&Generation { config: Some("v1:c"), directories: &[], parses, records: &[], deleted: Deleted::default() })
}

/// However the walk slices its reads, the index's generation and the store's
/// segment written from the runs are the bytes the reads themselves write.
#[test]
fn a_read_run_writes_the_bytes_its_read_does() {
    let reads = reads();
    let from_reads = keyed(reads.iter().map(|(file, identity, read)| (key(identity, &way(file)), read)));
    let from_reads: Vec<(&str, &Read)> = from_reads.iter().map(|(key, read)| (key.as_str(), *read)).collect();
    let (index, store) = (generation(&from_reads), parses_only(&from_reads));
    for slice in [1, 2, 3, reads.len()] {
        let runs = Runs::default();
        let mut places = Vec::new();
        for chunk in reads.chunks(slice) {
            let files: Vec<String> = chunk.iter().map(|(file, _, _)| file.clone()).collect();
            let identities: Vec<String> = chunk.iter().map(|(_, identity, _)| identity.clone()).collect();
            let read: Vec<&Read> = chunk.iter().map(|(_, _, read)| read).collect();
            places.extend(runs.add(&files, &identities, &read, |_| true));
        }
        let runs = runs.into_inner();
        let opened: Vec<Layer> = runs.iter().map(|bytes| Layer::open(bytes).unwrap()).collect();
        let from_runs = keyed(reads.iter().zip(&places).map(|((file, identity, _), place)| (key(identity, &way(file)), view(&opened, place.unwrap()))));
        let from_runs: Vec<(&str, &_)> = from_runs.iter().map(|(key, view)| (key.as_str(), view)).collect();
        assert!(generation(&from_runs) == index, "the index from slices of {slice}");
        assert!(parses_only(&from_runs) == store, "the store from slices of {slice}");
    }
}

/// A row the walk does not parse anew is left out of its run, and a slice with none writes no run.
#[test]
fn a_row_not_fresh_has_no_place_and_a_slice_without_one_no_run() {
    let reads = reads();
    let files: Vec<String> = reads.iter().map(|(file, _, _)| file.clone()).collect();
    let identities: Vec<String> = reads.iter().map(|(_, identity, _)| identity.clone()).collect();
    let read: Vec<&Read> = reads.iter().map(|(_, _, read)| read).collect();
    let runs = Runs::default();
    assert!(runs.add(&files, &identities, &read, |_| false).iter().all(Option::is_none));
    let places = runs.add(&files, &identities, &read, |row| row == 0 || row == 6);
    assert_eq!(places[0], places[6], "one key, one row");
    assert!(places.iter().enumerate().all(|(row, place)| place.is_some() == (row == 0 || row == 6)));
    assert_eq!(runs.into_inner().len(), 1);
}
