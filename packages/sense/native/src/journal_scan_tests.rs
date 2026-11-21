use super::*;

type Row = (ModuleId, bool, Vec<u32>, Vec<u32>, Vec<u32>, Option<Vec<u32>>);

#[derive(Default)]
struct Seen {
    cut: Vec<bool>,
    modules: Vec<Row>,
    eyes: usize,
}

impl Visitor for Seen {
    fn test(&mut self, _: &str) -> Result<(), String> {
        Ok(())
    }
    fn eyes(&mut self, frame: &[u8]) -> Result<(), String> {
        assert!(frame.starts_with(&EYES_MAGIC));
        self.eyes += 1;
        Ok(())
    }
    fn wants(&mut self, id: &ModuleId, cut: bool) -> bool {
        self.cut.push(cut);
        id != "src/skipped.ts"
    }
    fn module(&mut self, id: &ModuleId, hits: &[u32], shared: &[u32], loaded: &[u32], reached: Option<&[u32]>) {
        let cut = reached.is_some();
        self.modules.push((id.clone(), cut, hits.to_vec(), shared.to_vec(), loaded.to_vec(), reached.map(<[u32]>::to_vec)));
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
    // A case frame marks no moment its collection ended.
    out.extend_from_slice(&[0; TIME_BYTES]);
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
fn reads_each_hit_of_a_cut_row_with_the_line_that_first_reached_it() {
    // Ordinals are written as gaps; the lines list after them is plain.
    let raw = frame(&[
        (NAMED_LINED, "src/skipped.ts", &[&[1], &[], &[], &[7]]),
        (NAMED_LINED, "src/m.ts", &[&[1, 2], &[], &[], &[9, 4]]),
        (NAMED, "src/n.ts", &[&[3], &[], &[]]),
    ]);
    let mut seen = Seen::default();
    scan_journal(&raw, &mut seen).unwrap();
    assert_eq!(seen.cut, vec![true, true, false]);
    assert_eq!(
        seen.modules,
        vec![
            ("src/m.ts".to_owned(), true, vec![1, 3], vec![], vec![], Some(vec![9, 4])),
            ("src/n.ts".to_owned(), false, vec![3], vec![], vec![], None),
        ],
    );
}

#[test]
fn refuses_a_cut_row_whose_lines_do_not_match_its_hits() {
    let raw = frame(&[(NAMED_LINED, "src/m.ts", &[&[1, 2], &[], &[], &[9]])]);
    assert!(scan_journal(&raw, &mut Seen::default()).is_err());
}

#[test]
fn hands_an_eyes_frame_over_whole() {
    let mut raw = EYES_MAGIC.to_vec();
    raw.extend_from_slice(b"{}");
    let mut seen = Seen::default();
    scan_journal(&raw, &mut seen).unwrap();
    assert_eq!(seen.eyes, 1);
}

#[test]
fn reads_what_an_eyes_frame_says_of_its_attempt() {
    let read = |json: &str| {
        let mut raw = EYES_MAGIC.to_vec();
        raw.extend_from_slice(json.as_bytes());
        eyes_of(&raw)
    };
    assert_eq!(read(r#"{"case":"c","attempt":2}"#), Ok(("c".to_owned(), 2.0, Said::Watched)));
    assert_eq!(read(r#"{"case":"c","attempt":1,"journal":{"b":1,"a":2}}"#), Ok(("c".to_owned(), 1.0, Said::Journal(r#"{"b":1,"a":2}"#.to_owned()))));
    assert_eq!(read(r#"{"case":"c","attempt":1,"check":"form/title"}"#), Ok(("c".to_owned(), 1.0, Said::Check("form/title".to_owned()))));
    for refused in [r#"{"case":"c","attempt":1,"check":1}"#, r#"{"case":"c","attempt":1,"check":"x","journal":{}}"#, r#"{"case":"c","attempt":1,"journal":[]}"#] {
        assert!(read(refused).is_err(), "{refused}");
    }
}
