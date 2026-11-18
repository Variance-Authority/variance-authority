//! Persistent bounded object requests use the same Git protocol owner as text reads.

use super::{Open, PackedBlob};

#[test]
fn packed_batches_keep_order_limits_and_session_without_worktree_files() {
    let root = std::env::temp_dir().join(format!("variance-packed-session-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    let git = |args: &[&str], input| crate::git::answer(root.to_str().unwrap(), args, input).unwrap();
    git(&["init", "--quiet"], None);
    let blob = |bytes: &[u8]| {
        let hex = git(&["hash-object", "-w", "--stdin"], Some(bytes.to_vec()));
        crate::git::parse_oid(hex.strip_suffix(b"\n").unwrap()).unwrap()
    };
    let small = blob(b"small\n");
    let empty = blob(b"");
    let large = blob(&vec![b'x'; 200_000]);
    let missing = [0; 20];
    let tree = git(&["mktree"], Some(Vec::new()));
    let tree = crate::git::parse_oid(tree.strip_suffix(b"\n").unwrap()).unwrap();
    let mut open = Open::packed(root.to_str().unwrap()).unwrap();

    let found = open.blobs(&[small, large, missing, tree, empty, small], 6).unwrap();
    assert!(matches!(&found[0], Ok(PackedBlob::Bytes(bytes)) if bytes == b"small\n"));
    assert!(matches!(&found[1], Ok(PackedBlob::Large(200_000))));
    assert!(found[2].as_ref().unwrap_err().contains("missing"));
    assert!(found[3].as_ref().unwrap_err().contains("tree"));
    assert!(matches!(&found[4], Ok(PackedBlob::Bytes(bytes)) if bytes.is_empty()));
    assert!(matches!(&found[5], Ok(PackedBlob::Bytes(bytes)) if bytes == b"small\n"));

    // Both directions exceed a pipe buffer, and a second batch uses the same process.
    let found = open.blobs(&vec![small; 4096], 6).unwrap();
    assert_eq!(found.len(), 4096);
    assert!(found.iter().all(|row| matches!(row, Ok(PackedBlob::Bytes(bytes)) if bytes == b"small\n")));
    assert!(matches!(&open.blobs(&[large, small], 200_000).unwrap()[0], Ok(PackedBlob::Bytes(bytes)) if bytes.len() == 200_000));
    drop(open);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_failed_batch_ends_the_process_instead_of_reusing_a_desynchronized_pipe() {
    let root = std::env::temp_dir().join(format!("variance-packed-dead-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    crate::git::answer(root.to_str().unwrap(), &["init", "--quiet"], None).unwrap();
    let mut open = Open::packed(root.to_str().unwrap()).unwrap();
    open.child.kill().unwrap();
    open.child.wait().unwrap();
    assert!(open.blobs(&[[0; 20]], 10).is_err());
    drop(open);
    std::fs::remove_dir_all(root).unwrap();
}
