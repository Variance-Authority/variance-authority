//! A publish lands where `openImmutableLog` looks for it, and a compaction
//! removes only what its manifest stopped naming.

use super::{publish, LogSegment};
use sha2::{Digest, Sha256};

#[test]
fn segments_land_under_their_digest_and_the_manifest_names_them() {
    let directory = std::env::temp_dir().join(format!("va-log-{}", std::process::id()));
    std::fs::create_dir_all(&directory).unwrap();
    let path = directory.join("index.bin");
    let path = path.to_str().unwrap();
    publish(path, &[], &[b"one", b"second"], &[]).unwrap();
    let manifest = std::fs::read(path).unwrap();
    assert_eq!(&manifest[..8], b"VAIDXLSM");
    let length = u32::from_le_bytes(manifest[8..12].try_into().unwrap()) as usize;
    assert_eq!(length, manifest.len() - 12);
    let digest = crate::digest::of_sha256(Sha256::digest(b"one").as_slice());
    let json = std::str::from_utf8(&manifest[12..]).unwrap();
    assert_eq!(
        json,
        format!(
            r#"{{"format":"variance-authority-immutable-log","version":1,"segments":[{{"digest":"{digest}","length":3}},{{"digest":"{}","length":6}}]}}"#,
            crate::digest::of_sha256(Sha256::digest(b"second").as_slice())
        )
    );
    let segment = format!("{path}.segments/{}.bin", digest.replacen(':', "-", 1));
    assert_eq!(std::fs::read(segment).unwrap(), b"one");
    let left: Vec<_> = std::fs::read_dir(format!("{path}.segments")).unwrap().flatten().collect();
    assert_eq!(left.len(), 2, "no scratch file is left behind");
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn a_publish_that_fails_leaves_no_scratch_file() {
    let directory = std::env::temp_dir().join(format!("va-log-failed-{}", std::process::id()));
    // The manifest's rename lands on a directory that is not empty, so the
    // publish fails after every scratch name has been handed out.
    let path = directory.join("index.bin");
    std::fs::create_dir_all(path.join("occupied")).unwrap();
    let path_text = path.to_str().unwrap();
    assert!(publish(path_text, &[], &[b"one"], &[]).is_err());
    let scratch = |entry: &std::fs::DirEntry| entry.file_name().to_string_lossy().ends_with(".tmp");
    let left: Vec<_> = std::fs::read_dir(&directory)
        .unwrap()
        .chain(std::fs::read_dir(format!("{path_text}.segments")).unwrap())
        .flatten()
        .filter(scratch)
        .collect();
    assert!(left.is_empty(), "scratch files left: {left:?}");
    std::fs::remove_dir_all(directory).unwrap();
}

fn named(bytes: &[u8]) -> LogSegment {
    LogSegment {
        digest: crate::digest::of_sha256(Sha256::digest(bytes).as_slice()),
        length: bytes.len() as i64,
    }
}

fn segments_named(path: &str) -> Vec<String> {
    let manifest = std::fs::read(path).unwrap();
    let json: serde_json::Value = serde_json::from_slice(&manifest[12..]).unwrap();
    json["segments"].as_array().unwrap().iter().map(|segment| segment["digest"].as_str().unwrap().to_owned()).collect()
}

#[test]
fn an_append_keeps_the_chain_and_a_compaction_removes_what_it_replaced() {
    let directory = std::env::temp_dir().join(format!("va-log-chain-{}", std::process::id()));
    std::fs::create_dir_all(&directory).unwrap();
    let path = directory.join("index.bin");
    let path = path.to_str().unwrap();
    let file = |bytes: &[u8]| format!("{path}.segments/{}.bin", named(bytes).digest.replacen(':', "-", 1));

    publish(path, &[], &[b"one"], &[]).unwrap();
    publish(path, &[named(b"one")], &[b"two"], &[]).unwrap();
    assert_eq!(segments_named(path), [named(b"one").digest, named(b"two").digest]);

    // The whole keeps `one` as its first layer, so only `two` goes.
    publish(path, &[], &[b"one", b"whole"], &[named(b"one"), named(b"two")]).unwrap();
    assert_eq!(segments_named(path), [named(b"one").digest, named(b"whole").digest]);
    assert!(std::path::Path::new(&file(b"one")).exists());
    assert!(!std::path::Path::new(&file(b"two")).exists());
    assert!(std::path::Path::new(&file(b"whole")).exists());
    std::fs::remove_dir_all(directory).unwrap();
}
