//! What a wide answer's rows hold, whatever tree its files are in.

use super::{rows_of, Held, ROWS};

fn held(paths: &[(&'static str, usize)]) -> Vec<Held<'static>> {
    let mut files: Vec<_> = paths.iter().map(|(path, lines)| Held { path, lines: *lines, hops: 0 }).collect();
    files.sort_unstable_by(|left, right| left.path.cmp(right.path));
    files
}

fn rows(files: &[Held<'static>]) -> Vec<(String, usize)> {
    rows_of(files).iter().map(|row| (format!("{}{}", if row.rest { "rest " } else { "" }, row.path), row.lines)).collect()
}

#[test]
fn a_folder_sharing_a_files_name_is_its_own_row() {
    assert_eq!(rows(&held(&[("a/b.ts", 3), ("a/b-c/x.ts", 2), ("a/b/x.ts", 1)])), [
        ("a/b.ts".into(), 3), ("a/b-c/x.ts".into(), 2), ("a/b/x.ts".into(), 1),
    ]);
}

#[test]
fn files_of_several_top_folders_have_no_common_one() {
    assert_eq!(rows(&held(&[("a/x.ts", 1), ("b/y.ts", 2)])), [("b/y.ts".into(), 2), ("a/x.ts".into(), 1)]);
}

#[test]
fn a_name_that_is_not_ascii_is_split_at_its_separator() {
    assert_eq!(rows(&held(&[("値/甲.ts", 1), ("値/乙.ts", 1)])).len(), 2);
}

#[test]
fn the_rows_hold_every_line_once() {
    let names: Vec<&'static str> = (0..900).map(|at| &*format!("t{}/m{}/f{at}.ts", at % 7, at % 31).leak()).collect();
    let files = held(&names.iter().map(|name| (*name, 1 + name.len() % 3)).collect::<Vec<_>>());
    let said = rows(&files);
    assert!(said.len() <= ROWS);
    assert_eq!(said.iter().map(|(_, lines)| lines).sum::<usize>(), files.iter().map(|file| file.lines).sum::<usize>());
}

#[test]
fn a_folder_of_more_than_the_rows_says_the_widest_and_one_rest() {
    let names: Vec<&'static str> = (0..30).map(|at| &*format!("t/f{at:02}.ts").leak()).collect();
    let said = rows(&held(&names.iter().enumerate().map(|(at, name)| (*name, at + 1)).collect::<Vec<_>>()));
    assert_eq!(said.len(), ROWS);
    assert_eq!(said[0], ("rest t/".into(), (1..=21).sum()));
    assert_eq!(said[1], ("t/f29.ts".into(), 30));
}

#[test]
fn a_stray_file_beside_a_wide_folder_leaves_the_folder_split() {
    let names: Vec<&'static str> = (0..30).map(|at| &*format!("t/f{at:02}.ts").leak()).collect();
    let mut paths: Vec<_> = names.iter().enumerate().map(|(at, name)| (*name, at + 10)).collect();
    paths.push(("u/stray.ts", 1));
    let said = rows(&held(&paths));
    assert_eq!(said.len(), ROWS);
    assert_eq!(said[0], ("rest t/".into(), (10..=31).sum()));
    assert_eq!(said[1], ("t/f29.ts".into(), 39));
    assert_eq!(said[ROWS - 1], ("u/stray.ts".into(), 1));
}

#[test]
fn a_folder_is_split_only_where_two_of_its_parts_have_rows() {
    let wide: Vec<&'static str> = (0..5).map(|at| &*format!("w/f{at}.ts").leak()).collect();
    let single: Vec<&'static str> = (0..8).map(|at| &*format!("s{at:02}.ts").leak()).collect();
    let files = held(&wide.iter().chain(&single).enumerate().map(|(at, name)| (*name, if at < 5 { at + 2 } else { 1 })).collect::<Vec<_>>());
    let said = rows(&files);
    assert_eq!(said.len(), 9);
    assert_eq!(said[0], ("w/".into(), 20));
}

#[test]
fn a_folder_of_more_than_the_rows_and_half_the_lines_at_most_stays_whole() {
    let names: Vec<&'static str> = (0..30).map(|at| &*format!("t/f{at:02}.ts").leak()).collect();
    let paths: Vec<_> = names.iter().map(|name| (*name, 2)).collect();
    let beside = |lines| held(&[&paths[..], &[("u/one.ts", lines)]].concat());
    assert_eq!(rows(&beside(60)), [("t/".into(), 60), ("u/one.ts".into(), 60)]);
    assert_eq!(rows(&beside(59)).len(), ROWS);
}
