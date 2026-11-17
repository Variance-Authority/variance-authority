//! Exact parse-store seeds can help publish independent root segments.

use std::path::PathBuf;
use std::os::unix::fs::MetadataExt;

use super::{key, prune_parse_store, read_chain, Stores};
use crate::index::parses_only;
use crate::log::{file_name, written_reusing, Over};
use crate::parse_origin::FromBlob;
use crate::source_read::SourceRead;

struct Fixture(PathBuf);

impl Fixture {
    fn new(name: &str) -> Self {
        let path = std::env::temp_dir().join(format!("va-store-cow-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    fn path(&self, name: &str) -> String { self.0.join(name).to_string_lossy().into_owned() }
}

impl Drop for Fixture {
    fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
}

fn generations() -> Vec<Vec<u8>> {
    let read = SourceRead::default();
    ["first", "second"].iter().map(|digest| parses_only(&[(key(digest, "").as_str(), &read)])).collect()
}

#[test]
fn a_verbatim_seed_survives_pruning_before_the_root_publication() {
    let fixture = Fixture::new("seed-prune");
    let (store, root) = (fixture.path("store.bin"), fixture.path("root.bin"));
    let encoded = generations();
    let parts: Vec<_> = encoded.iter().map(Vec::as_slice).collect();
    crate::log::publish(&store, &[], &parts, &[]).unwrap();
    let leftover = read_chain(&store).unwrap().unwrap();
    let corrupt = file_name(&format!("{store}.segments"), &leftover.references[0].digest);
    std::fs::remove_file(&store).unwrap();
    std::fs::write(corrupt, vec![b'x'; encoded[0].len()]).unwrap();
    let receipts = {
        let stores = Stores::read(std::slice::from_ref(&store));
        stores.add_encoded(&stores.open(), &encoded, &FromBlob::default(), &[])
    };
    assert_eq!(receipts.len(), 2, "the receipts outlive store views and borrow only the original generations");
    let seeded = read_chain(&store).unwrap().unwrap();
    assert_eq!(seeded.segments, encoded, "a missing store's same-length corrupt leftover was replaced from the original bytes");
    let old_paths: Vec<_> = seeded.references.iter().map(|reference| file_name(&format!("{store}.segments"), &reference.digest)).collect();
    let old_inodes: Vec<_> = old_paths.iter().map(|path| std::fs::metadata(path).unwrap().ino()).collect();
    assert_eq!(prune_parse_store(store.clone(), Vec::new(), 0.0).unwrap(), 2);
    assert!(old_paths.iter().all(|path| !std::path::Path::new(path).exists()));
    assert!(written_reusing(&root, Over::Nothing, &[], &parts, &[], 0, &receipts).unwrap());
    let published = read_chain(&root).unwrap().unwrap();
    assert_eq!(published.segments, encoded);
    for (at, reference) in published.references.iter().enumerate() {
        let path = file_name(&format!("{root}.segments"), &reference.digest);
        assert_ne!(std::fs::metadata(path).unwrap().ino(), old_inodes[at]);
    }
}

#[test]
fn a_seed_loser_returns_no_receipt_and_does_not_append_after_the_winner() {
    let fixture = Fixture::new("seed-race");
    let store = fixture.path("store.bin");
    let winner = Stores::read(std::slice::from_ref(&store));
    let loser = Stores::read(std::slice::from_ref(&store));
    let encoded = generations();
    let receipts = winner.add_encoded(&winner.open(), &encoded, &FromBlob::default(), &[]);
    assert_eq!(receipts.len(), 2);
    let other = vec![parses_only(&[(key("loser", "").as_str(), &SourceRead::default())])];
    assert!(loser.add_encoded(&loser.open(), &other, &FromBlob::default(), &[]).is_empty());
    assert_eq!(read_chain(&store).unwrap().unwrap().segments, encoded, "a lost seed is still attempted, so the loser cannot append afterwards");
}

#[test]
fn an_optional_store_failure_leaves_original_bytes_available_for_root_publication() {
    let fixture = Fixture::new("store-failure");
    std::fs::write(fixture.0.join("blocked"), b"not a directory").unwrap();
    let store = fixture.path("blocked/store.bin");
    let root = fixture.path("root.bin");
    let encoded = generations();
    let receipts = {
        let stores = Stores::read(std::slice::from_ref(&store));
        stores.add_encoded(&stores.open(), &encoded, &FromBlob::default(), &[])
    };
    assert!(receipts.is_empty());
    let parts: Vec<_> = encoded.iter().map(Vec::as_slice).collect();
    assert!(written_reusing(&root, Over::Nothing, &[], &parts, &[], 0, &receipts).unwrap());
    assert_eq!(read_chain(&root).unwrap().unwrap().segments, encoded);
}
