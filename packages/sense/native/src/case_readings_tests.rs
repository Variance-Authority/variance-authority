use super::*;

fn region(name: &str, start: u64) -> Region {
    Region { module: "src/a.ts".to_owned(), name: name.to_owned(), path: name.to_owned(), start, end: start, value: Some(start * 2) }
}

#[test]
fn reads_back_the_bytes_it_writes() {
    let readings = vec![
        Stored { count: 3, stopped: Some(true), gone: Some(vec![0, 2]), values: Some(vec![(1, None)]), added: Some(vec![(0, region("x", 9))]), ..Stored::default() },
        Stored { count: 1, regions: Some(vec![region("x", 9), region("y", 4)]), ..Stored::default() },
    ];
    let bytes = case_bytes(&readings);

    assert_eq!(decode_case(&bytes).unwrap(), readings);
    assert_eq!(case_bytes(&decode_case(&bytes).unwrap()), bytes);
}

#[test]
fn lays_the_newest_again_as_its_difference_from_the_new_regions_and_keeps_the_earlier_ones() {
    let (a, b, c, d) = (region("a", 1), region("b", 2), region("c", 3), region("d", 4));
    let earlier = Stored { count: 2, added: Some(vec![(0, d.clone())]), ..Stored::default() };
    let bytes = case_bytes(&[Stored { count: 1, gone: Some(vec![1]), ..Stored::default() }, earlier.clone()]);

    let again = rebased(&bytes, &[a.clone(), b.clone(), c.clone()], &[a.clone(), c.clone(), b.clone(), d.clone()]).unwrap().unwrap();

    let read = decode_case(&again).unwrap();
    assert_eq!(read[0], Stored { count: 1, gone: Some(vec![2, 3]), ..Stored::default() });
    assert_eq!(applied(&read[0], &[a.clone(), c.clone(), b, d]), vec![a, c]);
    assert_eq!(read[1], earlier);
}

#[test]
fn keeps_a_newest_stored_whole() {
    let bytes = case_bytes(&[Stored { count: 1, regions: Some(vec![region("a", 1)]), ..Stored::default() }]);

    assert_eq!(rebased(&bytes, &[], &[region("b", 2)]).unwrap(), None);
}
