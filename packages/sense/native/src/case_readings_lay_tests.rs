use super::*;
use crate::crossing_sets::SetPool;
use crate::journey_columns::Column;

/// A case index of one case and one module holding one region the case crossed,
/// its module bounds as `bounds` spells them.
fn index(bounds: Vec<u32>) -> Vec<u8> {
    let strings = ["a.test.ts > one", "a.test.ts", "src/a.ts", "run"];
    let (mut blob, mut offsets) = (Vec::new(), vec![0]);
    for text in strings {
        blob.extend_from_slice(text.as_bytes());
        offsets.push(blob.len() as u32);
    }
    let mut sets = SetPool::new(1);
    let crossed = sets.intern(&[0]);
    journey_columns::encode(
        vec![
            Column::Blob("strings.blob", blob, offsets.clone()),
            Column::Words("strings.off", offsets),
            Column::Words("tests.id", vec![0]),
            Column::Words("tests.file", vec![1]),
            Column::Words("modules.file", vec![2]),
            Column::Words("modules.blocks", bounds),
            Column::Words("blocks.calledSet", vec![crossed]),
            Column::Words("blocks.name", vec![3]),
            Column::Words("blocks.path", vec![3]),
            Column::Words("blocks.start", vec![1]),
            Column::Words("blocks.end", vec![2]),
            Column::Blob("sets.blob", sets.bytes().to_vec(), sets.offsets().to_vec()),
            Column::Words("sets.off", sets.offsets().to_vec()),
        ],
        LAYOUT.cases.format,
    )
    .unwrap()
}

#[test]
fn reads_the_region_a_module_holds() {
    let opened = open(&index(vec![0, 1])).unwrap().unwrap();
    let reads = opened.reads(&HashSet::from(["a.test.ts > one"])).unwrap();

    assert_eq!(reads["a.test.ts > one"].regions.len(), 1);
}

#[test]
fn refuses_an_index_whose_modules_leave_a_region_out() {
    assert_eq!(open(&index(vec![0, 0])).err(), Some("module columns disagree".to_owned()));
}
