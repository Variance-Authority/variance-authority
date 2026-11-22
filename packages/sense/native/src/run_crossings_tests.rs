use super::*;
use crate::journal_scan::{MAGIC, NAMED, TIME_BYTES};

/// One worker's frame for `test`, its rows `(path, hits, shared, loaded)` as plain ordinals.
fn frame(test: &str, rows: &[(&str, &[u32], &[u32], &[u32])]) -> Vec<u8> {
    let mut out = MAGIC.to_vec();
    let text = |out: &mut Vec<u8>, value: &str| {
        out.push(value.len() as u8);
        out.extend_from_slice(value.as_bytes());
    };
    text(&mut out, test);
    out.extend_from_slice(&[0; TIME_BYTES]);
    out.push(rows.len() as u8);
    for (path, hits, shared, loaded) in rows {
        out.push(NAMED);
        text(&mut out, path);
        for list in [hits, shared, loaded] {
            out.push(list.len() as u8);
            let mut last = 0;
            for value in list.iter() {
                out.push((value - last) as u8);
                last = *value;
            }
        }
    }
    out
}

fn options<'a>(readings: &'a HashMap<ModuleId, Reading>, placed: Option<&'a HashSet<ModuleId>>) -> Options<'a> {
    Options { root: "/repo", readings, placed }
}

#[test]
fn credits_a_region_entered_while_loading_to_every_consumer_and_any_other_to_its_own_file() {
    let a = frame("/repo/a.test.ts", &[("src/m.ts", &[1, 2], &[1], &[1])]);
    let b = frame("/repo/b.test.ts", &[("src/m.ts", &[3], &[], &[]), ("src/n.ts", &[0], &[], &[])]);
    let readings = HashMap::new();
    let folded = fold(&[&a, &b], &[], &options(&readings, None)).unwrap();
    assert_eq!(folded.tests, vec!["a.test.ts", "b.test.ts"]);
    assert_eq!(folded.ids, vec!["src/m.ts", "src/n.ts"]);
    // m: ordinal 1 is shared, so both consumers; 2 is a's, 3 is b's. n: 0 is b's.
    assert_eq!(folded.hits, vec![3, 1, 2, 0, 1, 2, 1, 0, 3, 1, 1, 1, 0, 1, 1]);
    assert_eq!(folded.loaded, vec![1, 1, 2, 0, 1, 0]);
    assert_eq!(folded.journals, vec![0, 1, 0, 1, 2, 0, 1]);
    assert_eq!(folded.collected, vec![0.0, 0.0]);
    assert!(folded.unplaced.is_empty());
}

#[test]
fn leaves_out_a_module_the_run_could_not_place_and_names_its_file() {
    let a = frame("/repo/a.test.ts", &[("src/gone.ts", &[1], &[], &[]), ("src/m.ts", &[1], &[], &[])]);
    let carried = [Carried {
        test_file: "/repo/page.test.ts".to_owned(),
        rows: vec![CarriedRow { id: "src/m.ts".to_owned(), hits: vec![2], shared: vec![], loaded: vec![] }],
    }];
    let readings = HashMap::new();
    let placed: HashSet<ModuleId> = ["src/m.ts".to_owned()].into();
    let folded = fold(&[&a], &carried, &options(&readings, Some(&placed))).unwrap();
    assert_eq!(folded.tests, vec!["a.test.ts", "page.test.ts"]);
    assert_eq!(folded.ids, vec!["src/m.ts"]);
    assert_eq!(folded.hits, vec![2, 1, 1, 0, 2, 1, 1]);
    assert_eq!(folded.unplaced, vec![0]);
    assert_eq!(named_modules(&[&a], &carried).unwrap(), vec!["src/gone.ts", "src/m.ts"]);
}

#[test]
fn reads_two_reads_of_one_file_as_one_row_in_its_record() {
    // The second read's ordinals 0 and 1 land on 4 and nothing.
    let a = frame("/repo/a.test.ts", &[("src/m.ts", &[0], &[], &[]), ("src/m.ts?raw", &[0, 1], &[], &[])]);
    let readings: HashMap<ModuleId, Reading> =
        [("src/m.ts?raw".to_owned(), Reading { id: "src/m.ts".to_owned(), lands: vec![Some(4), None] })].into();
    let folded = fold(&[&a], &[], &options(&readings, None)).unwrap();
    assert_eq!(folded.ids, vec!["src/m.ts"]);
    assert_eq!(folded.hits, vec![2, 0, 1, 0, 4, 1, 0]);
    assert_eq!(folded.journals, vec![0, 1, 0]);
}

#[test]
fn numbers_the_tests_in_the_order_the_record_keeps() {
    let b = frame("/repo/b.test.ts", &[("src/m.ts", &[0], &[], &[])]);
    let a = frame("/repo/a.test.ts", &[("src/m.ts", &[0], &[], &[])]);
    let readings = HashMap::new();
    let folded = fold(&[&b, &a], &[], &options(&readings, None)).unwrap();
    assert_eq!(folded.tests, vec!["a.test.ts", "b.test.ts"]);
    assert_eq!(folded.hits, vec![1, 0, 2, 0, 1]);
    // The journals keep the order given, each naming its test by its new number.
    assert_eq!(folded.journals, vec![1, 1, 0, 0, 1, 0]);
}

#[test]
fn names_a_file_as_the_checkout_does() {
    assert_eq!(project_path("/repo", "/repo/src/./a.ts"), "src/a.ts");
    assert_eq!(project_path("/repo/pkg", "/repo/src/a.ts"), "../src/a.ts");
    assert_eq!(project_path("/repo/", "/repo/x/../a.ts"), "a.ts");
}
