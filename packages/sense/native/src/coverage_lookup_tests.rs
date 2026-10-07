use std::cmp::Ordering;

use super::{code_unit_order, Coverage};
use crate::journey_columns::{encode, Column};

/// The order JavaScript's `<` puts two strings in.
fn javascript_order(left: &str, right: &str) -> Ordering {
    left.encode_utf16().cmp(right.encode_utf16())
}

struct Recorded {
    modules: Vec<String>,
    tests: Vec<(String, Vec<String>)>,
    blocks: Vec<(String, String)>,
}

/// A coverage record holding these rows, sorted and interned as the writer does.
fn record(recorded: &Recorded, version: u8) -> Vec<u8> {
    let mut dictionary: Vec<&str> = recorded
        .modules
        .iter()
        .chain(recorded.tests.iter().flat_map(|(path, inputs)| std::iter::once(path).chain(inputs)))
        .chain(recorded.blocks.iter().flat_map(|(name, path)| [name, path]))
        .map(String::as_str)
        .collect();
    dictionary.sort_by(|left, right| javascript_order(left, right));
    dictionary.dedup();
    let id = |value: &str| dictionary.iter().position(|entry| *entry == value).unwrap() as u32;
    let mut offsets = vec![0];
    let mut blob = Vec::new();
    for entry in &dictionary {
        blob.extend_from_slice(entry.as_bytes());
        offsets.push(blob.len() as u32);
    }
    let mut modules = recorded.modules.clone();
    modules.sort_by(|left, right| javascript_order(left, right));
    let mut tests = recorded.tests.iter().collect::<Vec<_>>();
    tests.sort_by(|left, right| javascript_order(&left.0, &right.0));
    let mut bounds = vec![0];
    let mut names = Vec::new();
    for (_, inputs) in &tests {
        names.extend(inputs.iter().map(|input| id(input)));
        bounds.push(names.len() as u32);
    }
    encode(
        vec![
            Column::Words("strings.off", offsets.clone()),
            Column::Blob("strings.blob", blob, offsets),
            Column::Words("modules.path", modules.iter().map(|path| id(path)).collect()),
            Column::Words("tests.path", tests.iter().map(|(path, _)| id(path)).collect()),
            Column::Words("tests.preconditions", bounds),
            Column::Words("preconditions.name", names),
            Column::Words("blocks.name", recorded.blocks.iter().map(|(name, _)| id(name)).collect()),
            Column::Words("blocks.path", recorded.blocks.iter().map(|(_, path)| id(path)).collect()),
        ],
        version,
    )
    .unwrap()
}

fn open(bytes: &Vec<u8>) -> Coverage {
    Coverage::open(bytes, bytes.len()).unwrap()
}

#[test]
fn orders_utf8_as_javascript_orders_utf16() {
    let samples = ["", "a", "ab", "z", "\u{7f}", "\u{80}", "\u{7ff}", "\u{800}", "\u{d7ff}", "\u{e000}", "\u{ff21}", "\u{ffff}", "\u{10000}", "\u{1f600}", "\u{10ffff}", "\u{e000}a", "\u{1f600}a"];
    for left in samples {
        for right in samples {
            assert_eq!(code_unit_order(left.as_bytes(), right.as_bytes()), javascript_order(left, right), "{left:?} against {right:?}");
        }
    }
}

#[test]
fn finds_every_row_test_and_string_outside_the_basic_plane() {
    let files = ["src/\u{e000}.ts", "src/\u{1f600}.ts", "src/\u{ff21}.ts", "src/z.ts"];
    let recorded = Recorded {
        modules: files.iter().map(|file| file.to_string()).collect(),
        tests: files
            .iter()
            .map(|file| {
                let own = format!("test/{file}");
                (own.clone(), vec![own, "src/\u{1f600}.config.ts".into(), "src/\u{e000}.config.ts".into()])
            })
            .collect(),
        blocks: Vec::new(),
    };
    let bytes = record(&recorded, 10);
    let coverage = open(&bytes);
    let door = &bytes;
    for file in files {
        assert_eq!(coverage.modules(door, file).unwrap().len(), 1, "{file}");
        let test = coverage.test(door, &format!("test/{file}")).unwrap().unwrap();
        assert_eq!(coverage.test_paths(door, &[test]).unwrap(), vec![format!("test/{file}")]);
        let id = coverage.interned(door, file).unwrap().unwrap();
        assert_eq!(coverage.string(door, id).unwrap(), file);
    }
    assert_eq!(coverage.shared(door).unwrap(), vec!["src/\u{1f600}.config.ts", "src/\u{e000}.config.ts"]);
    assert_eq!(coverage.interned(door, "src/absent.ts").unwrap(), None);
}

#[test]
fn reads_columns_packed_into_runs() {
    // Enough rows that every column is packed: words above 64 KiB, and a
    // dictionary blob above it too.
    let modules: Vec<String> = (0..20_000).map(|at| format!("packages/p{}/src/module-{at:05}.ts", at % 7)).collect();
    let tests: Vec<(String, Vec<String>)> = (0..300)
        .map(|at| {
            let own = format!("packages/p{}/test/case-{at:03}.test.ts", at % 7);
            let mut inputs = vec![own.clone(), "vitest.config.ts".to_owned()];
            inputs.extend((0..60).map(|step| modules[(at * 61 + step) % modules.len()].clone()));
            (own, inputs)
        })
        .collect();
    let blocks: Vec<(String, String)> = (0..20_000).map(|at| (format!("block{}", at % 50), modules[at].clone())).collect();
    let recorded = Recorded { modules: modules.clone(), tests: tests.clone(), blocks };
    let bytes = record(&recorded, 10);
    let coverage = open(&bytes);
    let door = &bytes;

    let mut sorted = modules.clone();
    sorted.sort_by(|left, right| javascript_order(left, right));
    for probe in [0, 1, 4095, 4096, 4097, 12_345, 19_999] {
        assert_eq!(coverage.modules(door, &sorted[probe]).unwrap(), vec![probe as u32]);
    }
    assert_eq!(coverage.shared(door).unwrap(), vec!["vitest.config.ts"]);

    let asked = vec![modules[61].clone(), "nowhere.ts".to_owned(), "vitest.config.ts".to_owned()];
    let governed = coverage.governed(door, &asked).unwrap();
    assert_eq!(governed.len(), 300);
    let mut sorted_tests = tests.clone();
    sorted_tests.sort_by(|left, right| javascript_order(&left.0, &right.0));
    let declares = |row: usize| sorted_tests[row].1.contains(&modules[61]);
    for (test, files) in &governed {
        let expected: Vec<u32> = sorted_tests[*test as usize]
            .1
            .iter()
            .filter_map(|input| asked.iter().position(|file| file == input).map(|at| at as u32))
            .collect();
        assert_eq!(files, &expected);
        assert_eq!(files.contains(&0), declares(*test as usize));
    }

    let (strings, names, paths) = coverage.regions(door, &[0, 50, 19_999]).unwrap();
    let named: Vec<(&str, &str)> = names.iter().zip(&paths).map(|(name, path)| (strings[*name as usize].as_str(), strings[*path as usize].as_str())).collect();
    assert_eq!(named, vec![("block0", modules[0].as_str()), ("block0", modules[50].as_str()), ("block49", modules[19_999].as_str())]);
    assert_eq!(strings.len(), 5);
}

#[test]
fn returns_every_row_two_builds_recorded_under_one_path() {
    let recorded = Recorded {
        modules: vec!["a.ts".into(), "b.ts".into(), "b.ts".into(), "b.ts".into(), "c.ts".into()],
        tests: Vec::new(),
        blocks: Vec::new(),
    };
    let bytes = record(&recorded, 10);
    let coverage = open(&bytes);
    assert_eq!(coverage.modules(&bytes, "b.ts").unwrap(), vec![1, 2, 3]);
    assert_eq!(coverage.shared(&bytes).unwrap(), Vec::<String>::new());
}

#[test]
fn refuses_what_it_cannot_read_in_the_reader_s_words() {
    let recorded = Recorded { modules: vec!["a.ts".into()], tests: Vec::new(), blocks: Vec::new() };
    let old = record(&recorded, 7);
    let refused = Coverage::open(&old, old.len()).err().unwrap();
    assert_eq!(refused.reason, "unsupported test coverage version: 7");
    let refused = Coverage::open(&b"nonsense".to_vec(), 8).err().unwrap();
    assert_eq!(refused.reason, "not a variance-authority test coverage artifact");
}
