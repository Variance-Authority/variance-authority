//! The published-name table's rows are matched by the asked name's pooled id,
//! and a row whose id is outside the pool refuses the answer, as reading its
//! text would.

use std::collections::HashMap;

use super::Rows;
use crate::help_store::NONE;

fn u32s(values: &[u32]) -> Vec<u8> {
    values.iter().flat_map(|value| value.to_le_bytes()).collect()
}

/// A pool of `start` and `other`, and one path import whose names are `names`.
fn rows(names: &[u32]) -> Rows {
    let columns: HashMap<&'static str, Vec<u8>> = [
        ("strings.blob", b"startother".to_vec()),
        ("strings.off", u32s(&[0, 5, 10])),
        ("deep.namesOff", u32s(&[0, names.len() as u32])),
        ("use.name", u32s(names)),
    ].into_iter().collect();
    Rows { columns, ..Rows::default() }
}

#[test]
fn the_rows_naming_the_asked_name_are_found_and_an_absent_name_is_passed_over() {
    assert_eq!(rows(&[1, NONE, 0, 1, 0]).path_uses("start"), Some(vec![2, 4]));
    assert_eq!(rows(&[1, NONE]).path_uses("start"), Some(vec![]));
}

#[test]
fn a_row_whose_id_is_outside_the_pool_refuses_the_answer() {
    assert_eq!(rows(&[0, 7]).path_uses("start"), None);
    assert_eq!(rows(&[7, 0]).path_uses("start"), None);
}

/// Interleaved rows make the file lookup preserve stored order, not file order.
fn exports(files: usize, each: usize) -> Rows {
    let mut strings = vec!["Item".to_owned(), "@example/lib".to_owned()];
    strings.extend((0..files).map(|file| format!("src/{file:06}.ts")));
    let mut off = vec![0];
    let mut blob = Vec::new();
    for string in &strings { blob.extend(string.as_bytes()); off.push(blob.len() as u32); }
    let count = files * each;
    let at: Vec<_> = (0..count).map(|row| (row % files + 2) as u32).collect();
    Rows { columns: [
        ("strings.blob", blob), ("strings.off", u32s(&off)),
        ("files", u32s(&(2..files as u32 + 2).collect::<Vec<_>>())),
        ("names.name", u32s(&[0])), ("exp.name", u32s(&vec![0; count])),
        ("exp.at", u32s(&at)), ("exp.by", u32s(&vec![1; count])),
        ("exp.bound", u32s(&vec![0; count])),
    ].into_iter().collect(), ..Rows::default() }
}

#[test]
fn a_files_exports_keep_row_order_and_repeated_or_absent_lookups_agree() {
    let rows = exports(3, 2);
    for _ in 0..2 {
        let held = rows.exports_in("src/000001.ts").unwrap();
        assert_eq!(held.iter().map(|one| one.row()).collect::<Vec<_>>(), vec![1, 4]);
        assert!(held.iter().all(|one| one.name == "Item" && one.at == "src/000001.ts" && one.by == "@example/lib" && one.bound == Some("Item")));
        assert!(rows.exports_in("src/missing.ts").unwrap().is_empty());
    }
}

#[test]
fn an_invalid_export_file_refuses_even_an_absent_file_lookup() {
    for id in [NONE, 7] {
        let mut rows = exports(3, 2);
        rows.columns.get_mut("exp.at").unwrap()[4..8].copy_from_slice(&id.to_le_bytes());
        assert!(rows.exports_in("src/000000.ts").is_none());
        assert!(rows.exports_in("src/missing.ts").is_none());
    }
}

#[test]
#[ignore = "manual scale replay; run with --ignored --nocapture"]
fn export_file_lookup_scale() {
    for (control, files, each, asked) in [
        ("growth", 32, 8, 16), ("growth", 256, 8, 128), ("growth", 2048, 8, 512),
        // Same 128 selected rows and 16 lookups, with more unrelated exports.
        ("fixed-selected", 32, 8, 16), ("fixed-selected", 256, 8, 16), ("fixed-selected", 2048, 8, 16),
        // Same 2,048 exports and 128 selected rows, with more candidate files.
        ("fixed-exports", 32, 64, 2), ("fixed-exports", 256, 8, 16), ("fixed-exports", 2048, 1, 128),
    ] {
        let setup = std::time::Instant::now();
        let rows = exports(files, each);
        let setup = setup.elapsed();
        let began = std::time::Instant::now();
        let mut count = 0;
        for file in 0..asked {
            count += std::hint::black_box(rows.exports_in(&format!("src/{file:06}.ts")).unwrap()).len();
        }
        assert_eq!(count, asked * each);
        if control != "growth" { assert_eq!(count, 128); }
        if control == "fixed-exports" { assert_eq!(files * each, 2048); }
        println!("control={control} files={files} exports={} lookups={asked} selected={count} setup_us={} lookup_us={}", files * each, setup.as_micros(), began.elapsed().as_micros());
    }
}

#[test]
fn different_file_lookups_do_not_rescan_the_export_file_column() {
    let rows = exports(32, 8);
    for file in 0..32 {
        assert_eq!(rows.exports_in(&format!("src/{file:06}.ts")).unwrap().len(), 8);
    }
    // One pass counts rows and one places them; later lookups read the grouping.
    assert!(rows.file_rows_read.get() <= 2 * 32 * 8, "read {} export-file rows for a 256-row store", rows.file_rows_read.get());
}

#[test]
fn an_empty_export_table_and_an_exact_path_miss_are_empty() {
    assert!(exports(0, 0).exports_in("src/000000.ts").unwrap().is_empty());
    let rows = exports(3, 2);
    for path in ["000001.ts", "src/000001", "src/000001.ts/", "src/000001.tsx"] {
        assert!(rows.exports_in(path).unwrap().is_empty());
    }
}

#[test]
fn unrelated_export_metadata_is_not_decoded_but_invalid_path_text_refuses() {
    let mut rows = exports(3, 2);
    rows.columns.get_mut("exp.by").unwrap()[4..8].copy_from_slice(&NONE.to_le_bytes());
    assert_eq!(rows.exports_in("src/000000.ts").unwrap().len(), 2);
    assert!(rows.exports_in("src/000001.ts").is_none());
    let mut rows = exports(3, 2);
    *rows.columns.get_mut("strings.blob").unwrap().last_mut().unwrap() = 0xff;
    assert!(rows.exports_in("src/000000.ts").is_none());
    assert!(rows.exports_in("src/missing.ts").is_none());
}
