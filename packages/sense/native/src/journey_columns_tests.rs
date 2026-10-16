use super::*;

/// A framed file laid by hand, so a test can state what no writer would.
fn frame(version: u8, sections: &[(&str, u8, Option<usize>, Vec<u8>)]) -> Vec<u8> {
    let mut offset = 0;
    let mut placed = Vec::new();
    let mut body = Vec::new();
    for (name, width, rows, bytes) in sections {
        placed.push(Section { name: (*name).to_owned(), offset, length: bytes.len(), width: *width, rows: *rows });
        body.extend_from_slice(bytes);
        body.resize(aligned(body.len()), 0);
        offset = body.len();
    }
    let header = serde_json::to_vec(&Header { version, sections: placed }).unwrap();
    let length = aligned(4 + header.len()) - 4;
    let mut out = (length as u32).to_le_bytes().to_vec();
    out.extend_from_slice(&header);
    out.resize(4 + length, 0);
    out.extend_from_slice(&body);
    out
}

fn one_run(run: Vec<u8>) -> Vec<u8> {
    lay(vec![run])
}

fn zstd_run(bytes: &[u8]) -> Vec<u8> {
    let mut run = vec![LAYOUT.codecs.zstd];
    run.extend_from_slice(&zstd::stream::encode_all(Cursor::new(bytes), 19).unwrap());
    run
}

#[test]
fn round_trips_every_column_kind_packed_and_plain() {
    let words: Vec<u32> = (0..70_000).map(|at| at * 7 % 1000).collect();
    let bytes: Vec<u8> = (0..70_000).map(|at| (at % 3) as u8).collect();
    let mut blob = Vec::new();
    let mut offsets = vec![0];
    for at in 0..20_000 {
        blob.extend_from_slice(format!("name-{at}").as_bytes());
        offsets.push(blob.len() as u32);
    }
    let file = encode(
        vec![
            Column::Words("w", words.clone()),
            Column::Bytes("b", bytes.clone()),
            Column::Blob("s.blob", blob.clone(), offsets.clone()),
            Column::Words("s.off", offsets.clone()),
            Column::Plain("p", b"{\"held\":true}\n".to_vec()),
        ],
        7,
    )
    .unwrap();
    let (version, decoded) = decode_any(&file).unwrap();
    assert_eq!(version, 7);
    assert_eq!(decoded.words("w").unwrap(), words);
    assert_eq!(decoded.bytes("b").unwrap(), bytes);
    assert_eq!(decoded.held("s.blob").unwrap(), blob.as_slice());
    assert_eq!(decoded.bytes("p").unwrap(), b"{\"held\":true}\n");
    assert!(decode(&file, 8).is_err());
}

#[test]
fn a_plain_part_is_stored_as_it_is_whatever_its_size() {
    let part = vec![b'x'; 200_000];
    let file = encode(vec![Column::Plain("cases", part.clone())], 10).unwrap();
    let (_, placed) = framed(&file).unwrap();
    assert_eq!(placed[0].rows, None);
    assert_eq!(&file[placed[0].stored.clone()], part.as_slice());
}

#[test]
fn a_blob_stating_more_rows_than_memory_holds_is_refused_without_reserving_them() {
    let file = frame(1, &[("s.blob", 1, Some(1 << 62), one_run(vec![LAYOUT.codecs.raw, b'a']))]);
    let refused = decode_any(&file).err().unwrap();
    assert!(refused.contains("wrong length"), "{refused}");
}

#[test]
fn a_word_column_stating_more_rows_than_its_runs_hold_is_refused() {
    let file = frame(1, &[("w", 4, Some(LAYOUT.run), one_run(vec![LAYOUT.codecs.raw, 2]))]);
    assert!(decode_any(&file).is_err());
}

#[test]
fn a_run_that_decodes_past_its_column_is_stopped_at_the_limit() {
    let bomb = zstd_run(&vec![0_u8; 64 << 20]);
    assert!(bomb.len() < 1 << 16);
    let refused = decompress(&bomb, LAYOUT.run).err().unwrap();
    assert!(refused.contains("past its length"), "{refused}");
    let file = frame(1, &[("b", 1, Some(LAYOUT.run), one_run(bomb))]);
    assert!(decode_any(&file).err().unwrap().contains("past its length"));
}

#[test]
fn a_raw_run_longer_than_its_column_is_refused() {
    let refused = decompress(&[LAYOUT.codecs.raw, 1, 2, 3], 2).err().unwrap();
    assert!(refused.contains("past its length"), "{refused}");
}

#[test]
fn a_run_index_stating_more_runs_than_bytes_is_refused() {
    let mut stored = u32::MAX.to_le_bytes().to_vec();
    stored.extend_from_slice(&[0; 8]);
    assert!(runs_any(&stored).is_err());
}

#[test]
fn varints_stating_more_rows_than_bytes_reserve_only_the_bytes() {
    assert!(unvarints(&[1, 2], usize::MAX).is_err());
}

#[test]
fn a_section_past_the_end_of_the_file_is_refused() {
    let mut file = frame(1, &[("b", 1, None, vec![1, 2, 3])]);
    file.truncate(file.len() - 8);
    assert!(framed(&file).is_err());
}

#[test]
fn a_header_longer_than_the_file_is_refused() {
    let mut file = u32::MAX.to_le_bytes().to_vec();
    file.extend_from_slice(b"{}");
    assert!(framed(&file).is_err());
    assert!(framed(&[1, 0]).is_err());
}

#[test]
fn an_unknown_codec_is_refused() {
    assert!(decompress(&[9, 1], 10).is_err());
    assert!(decompress(&[], 10).is_err());
}
