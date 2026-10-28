use super::*;

fn text(blob: &str, lengths: &[u32]) -> Vec<u32> {
    assert_eq!(lengths.iter().sum::<u32>() as usize, blob.len());
    std::iter::once(0).chain(lengths.iter().scan(0, |at, length| {
        *at += length;
        Some(*at)
    })).collect()
}

#[test]
fn two_dictionaries_rank_as_one_a_string_both_hold_taking_one_rank() {
    // Previous: "b", "d", "a". Current: "c", "b", "e", "c" (unsorted, and "c" twice).
    let previous_offsets = text("bda", &[1, 1, 1]);
    let current_offsets = text("cbec", &[1, 1, 1, 1]);
    let previous = Text::laid_out("bda", &previous_offsets);
    let current = Text::laid_out("cbec", &current_offsets);
    let merged = Merged::new(&[previous, current]);
    // a b c d e
    assert_eq!(merged.len(), 5);
    assert_eq!(merged.ranks, vec![vec![1, 3, 0], vec![2, 1, 4, 2]]);
    let spelled = merged.spelled(&[previous, current], &[false, true, true, false, true]);
    assert_eq!(spelled.blob, b"bce");
    assert_eq!(spelled.offsets, vec![0, 1, 2, 3]);
    assert_eq!(spelled.rank, vec![u32::MAX, 0, 1, u32::MAX, 2]);
}

#[test]
fn ranks_follow_code_units_not_code_points() {
    // U+FF5E sorts after U+1F600 in UTF-16 code units, before it in code points.
    let (wide, astral) = ("\u{ff5e}", "\u{1f600}");
    let blob = format!("{astral}{wide}");
    let offsets = text(&blob, &[astral.len() as u32, wide.len() as u32]);
    let empty = [0_u32];
    let merged = Merged::new(&[Text::laid_out(&blob, &offsets), Text::laid_out("", &empty)]);
    assert_eq!(merged.ranks[0], vec![0, 1]);
}

#[test]
fn three_dictionaries_rank_as_one() {
    // "b", "a"; "c", "a"; "b", "d".
    let (one, two, three) = (text("ba", &[1, 1]), text("ca", &[1, 1]), text("bd", &[1, 1]));
    let texts = [Text::laid_out("ba", &one), Text::laid_out("ca", &two), Text::laid_out("bd", &three)];
    let merged = Merged::new(&texts);
    assert_eq!(merged.len(), 4);
    assert_eq!(merged.ranks, vec![vec![1, 0], vec![2, 0], vec![1, 3]]);
    assert_eq!(merged.spelled(&texts, &[true; 4]).blob, b"abcd");
}
