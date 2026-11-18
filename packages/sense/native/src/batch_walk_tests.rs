//! Slice consumption and acquisition invariants of the shared closure walk.

use super::*;

type Row = (String, Option<u8>);

#[test]
fn a_slice_is_consumed_on_its_resolver_thread_while_the_next_reads() {
    use std::sync::mpsc::channel;
    use std::time::Duration;
    let wave = vec!["first.ts".to_owned(), "second.ts".to_owned()];
    let coordinator = std::thread::current().id();
    let (consuming, consumed) = channel();
    let (reading, read) = channel();
    let mut consume = move |files: &[String], rows: Vec<String>, kept: Vec<bool>, resolver: &[std::thread::ThreadId]| {
        assert_ne!(std::thread::current().id(), coordinator);
        assert_eq!(resolver, [std::thread::current().id()]);
        assert_eq!(rows, files);
        assert_eq!(kept, [false]);
        if files[0] == "first.ts" {
            consuming.send(()).unwrap();
            read.recv_timeout(Duration::from_secs(2)).expect("the next read overlaps consumption");
        }
        files[0].clone()
    };
    let (slices, _) = read_resolved(&wave, 1, vec![None; 2], |files, _| {
        if files[0] == "second.ts" {
            consumed.recv_timeout(Duration::from_secs(2)).expect("the previous slice is consumed before acquisition returns");
            reading.send(()).unwrap();
        }
        (files.to_vec(), vec![false])
    }, |_, _| vec![std::thread::current().id()], &mut consume);
    assert_eq!(slices, wave, "consumed results preserve slice order");
}

/// Each file's row, kept flag and targets come from that file, in the wave's
/// order, whether the wave is one slice, a few, or slices that do not divide it.
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
        let (slices, targets) = read_resolved(&wave, slice, oids.clone(), reading, resolving, &mut |_, rows, kept, _| (rows, kept));
        let read: Vec<_> = slices.iter().flat_map(|(rows, _)| rows.iter().cloned()).collect();
        let kept: Vec<_> = slices.into_iter().flat_map(|(_, kept)| kept).collect();
        assert_eq!(read, expected, "slice {slice}");
        assert_eq!(kept, oids.iter().map(Option::is_some).collect::<Vec<_>>(), "slice {slice}");
        assert_eq!(targets, wave.iter().map(|file| vec![format!("{file} read {file}")]).collect::<Vec<_>>(), "slice {slice}");
    }
}

#[test]
fn an_empty_wave_reads_and_resolves_nothing() {
    let (read, targets) = read_resolved(
        &[],
        SLICE,
        Vec::new(),
        |_: &[String], _| -> (Vec<Row>, Vec<bool>) { panic!("nothing to read") },
        |_: &[String], _: &[Row]| -> Vec<Vec<String>> { panic!("nothing to resolve") },
        &mut |_, _: Vec<Row>, _: Vec<bool>, _: &[Vec<String>]| -> () { panic!("nothing to consume") },
    );
    assert!(read.is_empty() && targets.is_empty());
}

#[test]
fn a_kept_parse_without_size_is_gated_by_its_git_blob_not_worktree_metadata() {
    let root = crate::git_fixture::repository("walk-kept-blob-size", &[
        ("a.ts", b"export const committed = 'larger than this scan accepts';\n"),
    ]);
    let oid = git::parse_oid(crate::git_fixture::git(&root, &["rev-parse", "HEAD:a.ts"]).as_bytes()).unwrap();
    let identity = git::spell(&oid);
    let files = vec!["a.ts".to_owned()];
    let listing = Listing::of(Arc::new(HashMap::from([("a.ts".to_owned(), 0)])), Arc::new(vec![true]), &[]);
    let cached = SourceRead::default();
    assert_eq!(cached.size(), None);
    crate::git_fixture::write(&root, "a.ts", b"x;\n");
    let kept = |asked: &str, _: &str| (asked == identity).then(|| cached.clone());
    let (read, acquired) = read_kept(root.to_str().unwrap(), &TreeObjects::default(), &files,
        vec![Some(oid)], Some(32), Some(true), Some(1), &kept, None, &FromBlob::default(), Some(&listing));
    std::fs::remove_dir_all(root).unwrap();

    assert_eq!(read[0].2, Outcome::Declined, "the listed blob exceeds the limit even though its worktree file is tiny");
    assert!(!acquired[0].kept, "an unknown cached size cannot admit a parse");
    assert_eq!(acquired[0].identity, identity, "the decline is proved by the acquired blob");
    assert!(read[0].1.is_empty(), "a declined blob has no public parsed-byte digest");
}

#[test]
fn an_unsized_git_parse_is_reused_after_acquisition_even_without_a_worktree_file() {
    let root = crate::git_fixture::repository("walk-kept-unsized", &[("a.css", b"a { color: red; }\n")]);
    let oid = git::parse_oid(crate::git_fixture::git(&root, &["rev-parse", "HEAD:a.css"]).as_bytes()).unwrap();
    let identity = git::spell(&oid);
    let files = vec!["a.css".to_owned()];
    let listing = Listing::of(Arc::new(HashMap::from([("a.css".to_owned(), 0)])), Arc::new(vec![true]), &[]);
    let cached = SourceRead::Module(crate::source_style::read("a.css", "@import './kept.css';"));
    assert_eq!(cached.size(), None);
    std::fs::remove_file(root.join("a.css")).unwrap();
    let kept = |asked: &str, _: &str| (asked == identity).then(|| cached.clone());
    for cached_scan in [false, true] {
        let lookup: Kept = if cached_scan { &kept } else { &|_, _| None };
        let (read, acquired) = read_kept(root.to_str().unwrap(), &TreeObjects::default(), &files,
            vec![Some(oid)], None, Some(true), Some(1), lookup, None, &FromBlob::default(), Some(&listing));
        assert_eq!(read[0].2, Outcome::Parsed, "Git source admission is independent of cache presence");
        assert_eq!(acquired[0].identity, identity);
        assert_eq!(acquired[0].kept, cached_scan, "bounded acquisition reuses a whole cached parse");
        if cached_scan { assert_eq!(read[0].0.requests().next().unwrap().value, "./kept.css"); }
    }
    std::fs::remove_dir_all(root).unwrap();
}

#[cfg(feature = "grammars")]
#[test]
fn rust_module_facts_are_acquired_once_and_unreached_fresh_parses_are_counted() {
    let root = crate::git_fixture::repository("walk-rust-once", &[
        ("src/lib.rs", b"mod child;\n"),
        ("src/child.rs", b"pub struct Child;\n"),
        ("unused/other.rs", b"fn unused() {}\n"),
    ]);
    let files = ["src/lib.rs", "src/child.rs", "unused/other.rs"];
    let at: HashMap<String, u32> = files.iter().enumerate().map(|(index, file)| ((*file).to_owned(), index as u32)).collect();
    let listing = Arc::new(Listing::of(Arc::new(at.clone()), Arc::new(vec![true; files.len()]), &[]));
    let asked = RefCell::new(HashMap::<String, usize>::new());
    let kept = |_: &str, file: &str| {
        *asked.borrow_mut().entry(file.to_owned()).or_default() += 1;
        None
    };
    let paths: Vec<String> = files.iter().map(|file| (*file).to_owned()).collect();
    let session = crate::scan_session::State::default();
    let walked = walk_beyond(GraphOptions {
        root: root.to_string_lossy().into_owned(), seeds: vec!["src/lib.rs".to_owned()],
        largest_file: None, readers: Some(1), tsconfig: crate::resolve::Tsconfig::Off,
        condition_names: None, include_parses: false,
    }, &paths, &at, &vec![[0; 20]; files.len()], listing, &|_| false, &kept, None, &FromBlob::default(), &TreeObjects::worktree(), &session);
    assert_eq!(walked.files, ["src/lib.rs", "src/child.rs"]);
    assert_eq!(walked.targets[0], [vec!["src/child.rs".to_owned()]]);
    assert_eq!(walked.parsed, 3, "the unseeded file was also parsed to learn the complete module tree");
    assert!(walked.identities.iter().zip(&walked.read).all(|(identity, (_, digest, _))| identity == digest));
    let prefetched = session.prefetched.borrow();
    let prepared = crate::scan_session::prepared_parses(&prefetched, None);
    assert_eq!(prepared.len(), 1);
    assert_eq!(prepared[0].file, "unused/other.rs");
    assert_eq!(prepared[0].identity, prefetched["unused/other.rs"].0.1, "prepared facts keep the acquired byte identity too");
    assert!(asked.borrow().values().all(|count| *count == 1), "prefetched answers are consumed instead of acquired again");
    assert_eq!(asked.borrow().len(), files.len());
    std::fs::remove_dir_all(root).unwrap();
}

#[cfg(feature = "grammars")]
#[test]
fn a_rust_session_reuses_prepared_reads_and_world_across_three_frontiers() {
    let root = crate::git_fixture::repository("walk-rust-session", &[
        ("src/lib.rs", b"mod child;\n"),
        ("src/child.rs", b"pub struct Child;\n"),
        ("unused/other.rs", b"fn unused() {}\n"),
    ]);
    let paths: Vec<String> = ["src/lib.rs", "src/child.rs", "unused/other.rs"].into_iter().map(str::to_owned).collect();
    let at: HashMap<String, u32> = paths.iter().enumerate().map(|(index, file)| (file.clone(), index as u32)).collect();
    let listing = Arc::new(Listing::of(Arc::new(at.clone()), Arc::new(vec![true; paths.len()]), &[]));
    let asked = Cell::new(0);
    let kept = |_: &str, _: &str| { asked.set(asked.get() + 1); None };
    let session = crate::scan_session::State::default();
    for (index, file) in paths.iter().enumerate() {
        let walked = walk_beyond(GraphOptions {
            root: root.to_string_lossy().into_owned(), seeds: vec![file.clone()],
            largest_file: None, readers: Some(1), tsconfig: crate::resolve::Tsconfig::Off,
            condition_names: None, include_parses: false,
        }, &paths, &at, &vec![[0; 20]; paths.len()], Arc::clone(&listing), &|_| true,
            &kept, None, &FromBlob::default(), &TreeObjects::worktree(), &session);
        assert_eq!(walked.files, vec![file.clone()]);
        assert_eq!(walked.parsed, if index == 0 { 3 } else { 0 });
        if index == 0 { assert_eq!(walked.targets[0], [vec!["src/child.rs".to_owned()]]); }
    }
    assert_eq!(asked.get(), 3, "the second and third frontier acquire no Rust file again");
    std::fs::remove_dir_all(root).unwrap();
}
