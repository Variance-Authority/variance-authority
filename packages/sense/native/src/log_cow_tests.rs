//! Reusing a writer's own durable bytes preserves the ordinary log boundary.

use std::path::PathBuf;
use std::os::unix::fs::MetadataExt;

use super::{named, segments_named};
use crate::log::{file_name, publish, written_retaining, written_reusing, Over, WrittenSegment};

struct Fixture(PathBuf);

impl Fixture {
    fn new(name: &str) -> Self {
        let path = std::env::temp_dir().join(format!("va-log-cow-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    fn path(&self, name: &str) -> String { self.0.join(name).to_string_lossy().into_owned() }
}

impl Drop for Fixture {
    fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
}

fn retained<'a>(path: &str, bytes: &[&'a [u8]]) -> Vec<WrittenSegment<'a>> {
    written_retaining(path, Over::Nothing, &[], bytes, &[], 0).unwrap().expect("the seed won")
}

fn segment(path: &str, bytes: &[u8]) -> String { file_name(&format!("{path}.segments"), &named(bytes).digest) }

#[test]
fn borrowed_receipts_preserve_order_and_root_segments_have_independent_inodes() {
    let fixture = Fixture::new("independent");
    let (store, root, ordinary) = (fixture.path("store.bin"), fixture.path("root.bin"), fixture.path("ordinary.bin"));
    let (first, second) = (b"first parse".to_vec(), b"second parse".to_vec());
    let receipts = retained(&store, &[&first, &second]);
    let ordered: &[&[u8]] = &[&second, &first, b"metadata"];
    assert!(written_reusing(&root, Over::Nothing, &[], ordered, &[], 0, &receipts).unwrap());
    publish(&ordinary, &[], ordered, &[]).unwrap();
    assert_eq!(std::fs::read(&root).unwrap(), std::fs::read(&ordinary).unwrap(), "receipt lookup preserves the caller's segment order and manifest bytes");
    for bytes in [&first, &second] {
        let source = segment(&store, bytes);
        let destination = segment(&root, bytes);
        assert_ne!(std::fs::metadata(&source).unwrap().ino(), std::fs::metadata(&destination).unwrap().ino());
        std::fs::write(&source, b"store changed").unwrap();
        assert_eq!(std::fs::read(&destination).unwrap(), *bytes, "store writes must not reach retained root bytes");
        std::fs::remove_file(&source).unwrap();
        assert_eq!(std::fs::read(&destination).unwrap(), *bytes);
    }
    assert_eq!(segments_named(&root), ordered.iter().map(|bytes| named(bytes).digest).collect::<Vec<_>>());
}

#[test]
fn same_start_shorter_slice_and_other_allocations_publish_their_own_bytes() {
    let fixture = Fixture::new("unmatched");
    let source = b"original bytes".to_vec();
    let equal = source.clone();
    let wrong = b"different data".to_vec();
    assert_eq!(source.len(), wrong.len());
    let receipts = retained(&fixture.path("store.bin"), &[&source]);
    for (name, bytes) in [("subslice", &source[..4]), ("equal", equal.as_slice()), ("wrong", wrong.as_slice())] {
        let root = fixture.path(name);
        assert!(written_reusing(&root, Over::Nothing, &[], &[bytes], &[], 0, &receipts).unwrap());
        assert_eq!(segments_named(&root), [named(bytes).digest]);
        assert_eq!(std::fs::read(segment(&root, bytes)).unwrap(), bytes, "neither starting address nor length alone identifies the borrowed segment");
    }
}

#[test]
fn a_replaced_store_path_cannot_redirect_a_retained_open_file() {
    let fixture = Fixture::new("replaced-path");
    let (store, root) = (fixture.path("store.bin"), fixture.path("root.bin"));
    let bytes = b"own synced bytes".to_vec();
    let receipts = retained(&store, &[&bytes]);
    let source = segment(&store, &bytes);
    std::fs::remove_file(&source).unwrap();
    std::fs::write(&source, vec![b'x'; bytes.len()]).unwrap();
    assert!(written_reusing(&root, Over::Nothing, &[], &[&bytes], &[], 0, &receipts).unwrap());
    assert_eq!(std::fs::read(segment(&root, &bytes)).unwrap(), bytes, "the published pathname is not the receipt's identity");
}

#[test]
fn a_root_cas_loss_creates_no_new_segment_and_leaves_the_receipt_usable() {
    let fixture = Fixture::new("cas");
    let (store, root, retry) = (fixture.path("store.bin"), fixture.path("root.bin"), fixture.path("retry.bin"));
    let bytes = b"own synced bytes".to_vec();
    let receipts = retained(&store, &[&bytes]);
    publish(&root, &[], &[b"winner"], &[]).unwrap();
    let before = std::fs::read(&root).unwrap();
    assert!(!written_reusing(&root, Over::Nothing, &[], &[&bytes], &[], 0, &receipts).unwrap());
    assert_eq!(std::fs::read(&root).unwrap(), before);
    assert_eq!(std::fs::read_dir(format!("{root}.segments")).unwrap().count(), 1);
    assert!(!std::path::Path::new(&segment(&root, &bytes)).exists());
    assert!(written_reusing(&retry, Over::Nothing, &[], &[&bytes], &[], 0, &receipts).unwrap());
    assert_eq!(std::fs::read(segment(&retry, &bytes)).unwrap(), bytes);
}

#[test]
fn a_refused_clone_replaces_partial_scratch_bytes_with_the_bound_original() {
    let fixture = Fixture::new("clone-fallback");
    let bytes = b"own synced bytes".to_vec();
    let receipts = retained(&fixture.path("store.bin"), &[&bytes]);
    let temporary = fixture.path("root.tmp");
    let file = super::super::materialize_with(&temporary, &bytes, Some(&receipts[0]), |_, destination| {
        std::fs::write(destination, b"partial clone")?;
        Err(std::io::Error::new(std::io::ErrorKind::Unsupported, "clone refused"))
    }).unwrap();
    drop(file);
    assert_eq!(std::fs::read(&temporary).unwrap(), bytes);
    assert_eq!(std::fs::read_dir(&fixture.0).unwrap().filter_map(Result::ok).filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp")).count(), 1, "fallback uses the same scratch name");
}

#[cfg(target_os = "macos")]
#[test]
fn the_native_clone_primitive_has_independent_attributes_and_data() {
    let fixture = Fixture::new("native-clone");
    let bytes = b"own synced bytes".to_vec();
    let receipts = retained(&fixture.path("store.bin"), &[&bytes]);
    let destination = fixture.path("clone.bin");
    if let Err(error) = super::super::clone_segment(&receipts[0].file, &destination) {
        assert!(matches!(error.raw_os_error(), Some(libc::ENOTSUP | libc::EXDEV | libc::ENOSYS)), "unexpected clone failure: {error}");
        return;
    }
    assert_ne!(receipts[0].file.metadata().unwrap().ino(), std::fs::metadata(&destination).unwrap().ino());
    std::fs::write(&destination, b"clone changed").unwrap();
    assert_eq!(std::fs::read(segment(&fixture.path("store.bin"), &bytes)).unwrap(), bytes);
}
