//! Unknown Git answers and alternate-index provenance cannot vouch for files.
use std::process::Command;
use crate::git_fixture::{git, repository};

#[test]
fn status_failure_declines_the_snapshot_instead_of_listing_nothing() {
    if let Some(root) = std::env::var_os("SENSE_GIT_STATUS_FAILURE") {
        assert!(crate::git::snapshot(root.to_str().unwrap()).is_none(), "unknown status must take the filesystem fallback");
        return;
    }
    let root = repository("inventory-status-failure", &[("a.ts", b"a\n")]);
    git(&root, &["config", "core.fsmonitor", "true"]);
    let actual = Command::new("which").arg("git").output().unwrap();
    assert!(actual.status.success());
    let actual = String::from_utf8(actual.stdout).unwrap().trim().replace('\'', "'\\''");
    let bin = root.join("bin");
    std::fs::create_dir(&bin).unwrap();
    let wrapper = bin.join("git");
    use std::os::unix::fs::PermissionsExt;
    let path = std::env::join_paths(std::iter::once(bin).chain(std::env::split_paths(&std::env::var_os("PATH").unwrap()))).unwrap();
    for failed in ["status", "ls-files"] {
        std::fs::write(&wrapper, format!("#!/bin/sh\nfor argument do\n  if [ \"$argument\" = {failed} ]; then exit 1; fi\ndone\nexec '{actual}' \"$@\"\n")).unwrap();
        std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o755)).unwrap();
        let result = Command::new(std::env::current_exe().unwrap()).args(["--exact", "held_listing::trust_tests::status_failure_declines_the_snapshot_instead_of_listing_nothing", "--nocapture"]).env("SENSE_GIT_STATUS_FAILURE", &root).env("PATH", &path).output().unwrap();
        assert!(result.status.success(), "{failed}: {}{}", String::from_utf8_lossy(&result.stdout), String::from_utf8_lossy(&result.stderr));
    }
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn alternate_index_never_reuses_or_records_default_index_stamps() {
    if let Some(root) = std::env::var_os("SENSE_GIT_ALTERNATE_TRUST") {
        let root = root.to_str().unwrap();
        let meta = super::Meta {
            watch: crate::watchman::Watch { socket: "socket".into(), watched: root.into(), relative: None, clock: "clock".into(), ignored: Vec::new(), vcs: Vec::new() },
            dirs: Vec::new(), inputs: Vec::new(), git: Vec::new(), config: None, files: 0,
        };
        assert!(!super::stands(&meta, &[], root, "socket", &[], |_| None), "default-index stamps cannot vouch for an alternate index");
        assert!(super::inputs(root).is_none(), "an alternate-index listing cannot record default-index stamps");
        return;
    }
    let root = repository("inventory-alternate-trust", &[("a.ts", b"a\n")]);
    let alternate = root.join(".git/alternate");
    std::fs::copy(root.join(".git/index"), &alternate).unwrap();
    let result = Command::new(std::env::current_exe().unwrap()).args(["--exact", "held_listing::trust_tests::alternate_index_never_reuses_or_records_default_index_stamps", "--nocapture"]).env("SENSE_GIT_ALTERNATE_TRUST", &root).env("GIT_INDEX_FILE", &alternate).output().unwrap();
    assert!(result.status.success(), "{}{}", String::from_utf8_lossy(&result.stdout), String::from_utf8_lossy(&result.stderr));
    std::fs::remove_dir_all(root).unwrap();
}
