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
    Rows(columns)
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
