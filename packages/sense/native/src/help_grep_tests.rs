//! A search that reads tracked, unchanged files out of git's object store
//! answers exactly what the same search over the worktree answers.

use std::path::Path;

use super::search;
use crate::git_fixture::{commit, git, repository, settle, write};

/// Each hit as `file:line:text`, then each error, for a comparison that names what differs.
fn answer(root: &Path, pattern: &str, files: &[String], crossover: usize) -> (Vec<String>, usize) {
    let (found, stored) = search(root, pattern, files, crossover).unwrap();
    let mut lines: Vec<String> =
        (0..found.file.len()).map(|at| format!("{}:{}:{}", files[found.file[at] as usize], found.line[at], found.text[at])).collect();
    lines.extend(found.errors.iter().map(|error| format!("error {error}")));
    (lines, stored)
}

#[test]
fn the_store_and_the_worktree_answer_the_same_lines_for_binary_and_bom_encoded_files() {
    // A NUL late in a file decides it is binary only when the searcher reaches
    // it, and `rg` stops at that point rather than before the first match.
    let mut late_nul = b"needle early\n".to_vec();
    late_nul.extend(std::iter::repeat_n(b'x', 60_000));
    late_nul.extend(b"\0\nneedle late\n");
    let mut utf16 = vec![0xff, 0xfe];
    for unit in "needle in utf-16\nnone\n".encode_utf16() {
        utf16.extend(unit.to_le_bytes());
    }
    let root = repository("help-grep-bytes", &[
        ("late-nul.bin", &late_nul),
        ("utf16.txt", &utf16),
        ("crlf.ts", b"const needle = 1;\r\nnone\r\n"),
        ("plain.ts", b"needle\nneedle again\n"),
        ("empty.ts", b""),
    ]);
    let files: Vec<String> = ["late-nul.bin", "utf16.txt", "crlf.ts", "plain.ts", "empty.ts", "gone.ts"].map(String::from).to_vec();

    let (worktree, none) = answer(&root, "needle", &files, usize::MAX);
    let (stored, read) = answer(&root, "needle", &files, 0);

    assert_eq!(none, 0, "a list under the crossover never opens the store");
    assert_eq!(read, 5, "every tracked file but the missing one came from the store");
    assert_eq!(stored, worktree);
    assert!(worktree.iter().any(|line| line == "utf16.txt:1:needle in utf-16"), "{worktree:?}");
}

#[test]
fn a_root_below_the_checkout_searches_its_own_files_from_the_store() {
    let root = repository("help-grep-nested", &[("src/a.ts", b"needle top\n"), ("apps/x/src/a.ts", b"needle nested\n")]);
    let files = vec!["src/a.ts".to_owned()];

    let (stored, read) = answer(&root.join("apps/x"), "needle", &files, 0);

    assert_eq!(read, 1);
    assert_eq!(stored, ["src/a.ts:1:needle nested"]);
}

const POINTER: &[u8] = b"version https://git-lfs.github.com/spec/v1\noid sha256:4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393\nsize 20\n";

#[test]
fn a_search_from_the_store_still_finds_what_only_the_worktree_holds() {
    let root = repository("help-grep-differs", &[
        (".gitattributes", b"crlf.txt text eol=crlf\nbig.bin filter=lfs\n"),
        ("clean.ts", b"needle clean\n"),
        ("crlf.txt", b"needle crlf\n"),
        ("edited.ts", b"needle before\n"),
    ]);
    // git-lfs's clean turns the content into its pointer, so the blob is the
    // pointer and the stat the index records is the content's, at one length.
    let pointer = root.with_file_name(format!("{}-pointer", root.file_name().unwrap().to_str().unwrap()));
    std::fs::write(&pointer, POINTER).unwrap();
    git(&root, &["config", "filter.lfs.clean", &format!("sh -c 'cat >/dev/null; cat {}'", pointer.display())]);
    git(&root, &["config", "filter.lfs.smudge", "cat"]);
    let mut content = b"needle lfs ".to_vec();
    content.resize(POINTER.len() - 1, b'x');
    content.push(b'\n');
    write(&root, "big.bin", &content);
    commit(&root);
    git(&root, &["repack", "-d", "-q"]);
    write(&root, "second.ts", b"needle second\n");
    commit(&root);
    git(&root, &["repack", "-d", "-q"]);
    write(&root, "loose.ts", b"needle loose\n");
    commit(&root);
    std::fs::remove_file(root.join("crlf.txt")).unwrap();
    git(&root, &["checkout", "--", "crlf.txt"]);
    settle(&root);
    git(&root, &["update-index", "--refresh"]);
    write(&root, "edited.ts", b"needle after!\n");
    write(&root, "untracked.ts", b"needle untracked\n");
    let packs = std::fs::read_dir(root.join(".git/objects/pack")).unwrap().flatten();
    assert_eq!(packs.filter(|entry| entry.path().extension().is_some_and(|ext| ext == "pack")).count(), 2);
    let files: Vec<String> =
        ["clean.ts", "second.ts", "loose.ts", "crlf.txt", "edited.ts", "big.bin", "untracked.ts", "gone.ts"].map(String::from).to_vec();

    let (worktree, _) = answer(&root, "needle", &files, usize::MAX);
    let (stored, read) = answer(&root, "needle", &files, 0);
    assert_eq!(read, 3, "the packed, the second pack's and the loose file; every other is opened");
    assert_eq!(stored, worktree);
    for line in ["edited.ts:1:needle after!", "untracked.ts:1:needle untracked", &format!("big.bin:1:{}", String::from_utf8_lossy(&content[..content.len() - 1]))] {
        assert!(worktree.iter().any(|held| held == line), "{line} in {worktree:?}");
    }
    let (worktree, _) = answer(&root, r"crlf\r$", &files, usize::MAX);
    assert!(worktree.iter().any(|line| line.starts_with("crlf.txt:1:")), "the checkout's CRLF: {worktree:?}");
    assert_eq!(answer(&root, r"crlf\r$", &files, 0).0, worktree);
    std::fs::remove_file(pointer).unwrap();
}

#[test]
fn a_repository_whose_checkout_may_differ_at_the_same_length_is_searched_from_the_worktree() {
    let smudged = repository("help-grep-smudge", &[(".gitattributes", b"*.txt filter=same\n"), ("a.txt", b"aaaa\n"), ("plain.ts", b"bbbb\n")]);
    git(&smudged, &["config", "filter.same.smudge", "tr a b"]);
    git(&smudged, &["config", "filter.same.clean", "tr b a"]);
    std::fs::remove_file(smudged.join("a.txt")).unwrap();
    git(&smudged, &["checkout", "--", "a.txt"]);
    settle(&smudged);
    git(&smudged, &["update-index", "--refresh"]);
    let ident = repository("help-grep-ident", &[(".gitattributes", b"*.txt ident\n"), ("a.txt", b"$Id$ bbbb\n"), ("plain.ts", b"bbbb\n")]);
    std::fs::remove_file(ident.join("a.txt")).unwrap();
    git(&ident, &["checkout", "--", "a.txt"]);
    settle(&ident);
    git(&ident, &["update-index", "--refresh"]);
    let files: Vec<String> = ["a.txt", "plain.ts"].map(String::from).to_vec();

    for root in [smudged, ident] {
        let (worktree, _) = answer(&root, "bbbb", &files, usize::MAX);
        let (stored, read) = answer(&root, "bbbb", &files, 0);
        assert_eq!(read, 0, "{}: refused whole, the clean file with it", root.display());
        assert_eq!(stored, worktree);
        assert!(worktree.iter().any(|line| line.starts_with("a.txt:1:")), "{worktree:?}");
    }
}
