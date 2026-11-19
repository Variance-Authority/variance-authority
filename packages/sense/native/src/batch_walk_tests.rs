//! The walk's slicing: rows, kept flags and targets stay on their own file.

use super::*;

type Row = (String, Option<u8>);

/// Each file's row, kept flag and targets come from that file, in the wave's
/// order, whether the wave is one slice, a few, or slices that do not divide it;
/// each slice is settled whole, from where it starts in the wave.
#[test]
fn a_sliced_wave_keeps_every_file_on_its_own_row() {
    let wave: Vec<String> = (0..7).map(|n| format!("f{n}.ts")).collect();
    let oids: Vec<Option<Oid>> = (0..7u8).map(|n| (n % 2 == 0).then_some([n; 20])).collect();
    let expected: Vec<Row> = wave.iter().zip(0u8..).map(|(file, n)| (file.clone(), (n % 2 == 0).then_some(n))).collect();
    for slice in [1, 3, 7, 16] {
        let reading = |files: &[String], oids: Vec<Option<Oid>>| {
            assert_eq!(files.len(), oids.len());
            let rows: Vec<Row> = files.iter().zip(&oids).map(|(file, oid)| (file.clone(), oid.map(|oid| oid[0]))).collect();
            (rows, oids.iter().map(Option::is_some).collect())
        };
        let resolving = |files: &[String], rows: &[Row]| {
            files.iter().zip(rows).map(|(file, (row, _))| vec![format!("{file} read {row}")]).collect()
        };
        // Each slice is settled once it is resolved, knowing where it starts in the wave.
        let settling = |start: usize, files: &[String], rows: Vec<Row>, kept: &[bool], targets: &[Vec<String>]| {
            assert_eq!(files, &wave[start..start + files.len()], "slice {slice}");
            assert_eq!((rows.len(), kept.len(), targets.len()), (files.len(), files.len(), files.len()), "slice {slice}");
            rows
        };
        let (read, kept, targets) = read_resolved(&wave, slice, oids.clone(), reading, resolving, settling);
        assert_eq!(read, expected, "slice {slice}");
        assert_eq!(kept, oids.iter().map(Option::is_some).collect::<Vec<_>>(), "slice {slice}");
        assert_eq!(targets, wave.iter().map(|file| vec![format!("{file} read {file}")]).collect::<Vec<_>>(), "slice {slice}");
    }
}

/// A warm update walks round after round over one tree: the world it is
/// handed reads every `.rs` file for Rust's module tree once, not per round.
#[cfg(feature = "grammars")]
#[test]
fn rounds_over_one_world_read_the_module_tree_once() {
    use std::sync::Mutex;
    let files = [("src/lib.rs", "mod a;\nmod b;\n"), ("src/a.rs", "use crate::b;\n"), ("src/b.rs", "pub fn b() {}\n")];
    let root = std::env::temp_dir().join(format!("sense-walk-rounds-{}", std::process::id()));
    for (file, text) in files {
        std::fs::create_dir_all(root.join(file).parent().unwrap()).unwrap();
        std::fs::write(root.join(file), text).unwrap();
    }
    let known: HashMap<String, u32> = files.iter().map(|(file, _)| (*file).to_owned()).zip(0..).collect();
    let asked = Mutex::new(Vec::<String>::new());
    let parsing = |paths: &[&str]| {
        asked.lock().unwrap().extend(paths.iter().map(|path| (*path).to_owned()));
        let held = |path: &str| files.iter().find(|(file, _)| *file == path).map(|(_, text)| *text);
        paths.iter().map(|path| held(path).map(|text| crate::read_any::read_file(path, text, &oxc_allocator::Allocator::default(), true))).collect()
    };
    let texting = |_: &str| None;
    let world = World::new(Some(&known), None).reading(&parsing, &texting);
    let round = |seed: &str| {
        let options = GraphOptions {
            root: root.to_string_lossy().into_owned(),
            seeds: vec![seed.to_owned()],
            largest_file: None,
            readers: None,
            tsconfig: crate::resolve::Tsconfig::from_js(None),
            condition_names: None,
            include_parses: false,
        };
        let listing = Arc::new(Listing::default());
        walk_beyond(options, &HashMap::new(), &[], listing, &world, &Neighbours::default(), &|_| true, &|_, _| None, &FromBlob::default(), &TreeObjects::default())
    };
    let (first, second) = (round("src/lib.rs"), round("src/a.rs"));
    let _ = std::fs::remove_dir_all(&root);
    assert_eq!(first.targets[0].first, ["src/a.rs", "src/b.rs"]);
    assert_eq!(second.targets[0].first, ["src/b.rs"]);
    let mut asked = asked.into_inner().unwrap();
    asked.sort_unstable();
    assert_eq!(asked, ["src/a.rs", "src/b.rs", "src/lib.rs"]);
}

#[test]
fn an_empty_wave_reads_and_resolves_nothing() {
    let (read, kept, targets) = read_resolved(
        &[],
        SLICE,
        Vec::new(),
        |_: &[String], _| -> (Vec<Row>, Vec<bool>) { panic!("nothing to read") },
        |_: &[String], _: &[Row]| -> Vec<Vec<String>> { panic!("nothing to resolve") },
        |_: usize, _: &[String], _: Vec<Row>, _: &[bool], _: &[Vec<String>]| -> Vec<Row> { panic!("nothing to settle") },
    );
    assert!(read.is_empty() && kept.is_empty() && targets.is_empty());
}
