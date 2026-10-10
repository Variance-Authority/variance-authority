use super::*;

#[derive(Default)]
struct Seen {
    modules: Vec<(ModuleId, Vec<u32>, Vec<u32>, Vec<u32>)>,
}

impl Visitor for Seen {
    fn test(&mut self, _: &str) -> Result<(), String> {
        Ok(())
    }
    fn wants(&mut self, id: &ModuleId) -> bool {
        id != "src/skipped.ts"
    }
    fn module(&mut self, id: &ModuleId, hits: &[u32], shared: &[u32], loaded: &[u32]) {
        self.modules.push((id.clone(), hits.to_vec(), shared.to_vec(), loaded.to_vec()));
    }
}

/// A frame of one case, its rows `(tag, path, [hits, shared, loaded, lines?])`, every list as written.
fn frame(rows: &[(u8, &str, &[&[u32]])]) -> Vec<u8> {
    let mut out = MAGIC.to_vec();
    let text = |out: &mut Vec<u8>, value: &str| {
        out.push(value.len() as u8);
        out.extend_from_slice(value.as_bytes());
    };
    text(&mut out, "case");
    out.push(rows.len() as u8);
    for (tag, path, lists) in rows {
        out.push(*tag);
        text(&mut out, path);
        for list in *lists {
            out.push(list.len() as u8);
            out.extend(list.iter().map(|value| *value as u8));
        }
    }
    out
}

#[test]
fn reads_a_cut_case_row_as_the_row_it_was_before_cuts() {
    // Ordinals are written as gaps; the lines list after them is plain.
    let raw = frame(&[
        (NAMED_LINED, "src/skipped.ts", &[&[1], &[], &[], &[7]]),
        (NAMED_LINED, "src/m.ts", &[&[1, 2], &[], &[], &[9, 4]]),
        (NAMED, "src/n.ts", &[&[3], &[], &[]]),
    ]);
    let mut seen = Seen::default();
    scan_journal(&raw, &mut seen).unwrap();
    assert_eq!(
        seen.modules,
        vec![
            ("src/m.ts".to_owned(), vec![1, 3], vec![], vec![]),
            ("src/n.ts".to_owned(), vec![3], vec![], vec![]),
        ],
    );
}

#[test]
fn refuses_a_cut_row_whose_lines_do_not_match_its_hits() {
    let raw = frame(&[(NAMED_LINED, "src/m.ts", &[&[1, 2], &[], &[], &[9]])]);
    assert!(scan_journal(&raw, &mut Seen::default()).is_err());
}
