//! Bounded reads of a record's framed sections from one open file.

// compass: variance-authority.reach

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::ops::Range;
use std::path::Path;

use super::{decode, framed_within, Decoded, Placed};

pub(crate) struct FileFrame {
    file: File,
    pub version: u8,
    pub columns: Vec<Placed>,
    bounds: Range<usize>,
}

impl FileFrame {
    pub(crate) fn open(path: &Path) -> Result<Option<Self>, String> {
        let file = match File::open(path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.to_string()),
        };
        let len = usize::try_from(file.metadata().map_err(|error| error.to_string())?.len())
            .map_err(|_| "the record is too large")?;
        Self::within(file, 0..len).map(Some)
    }

    fn within(mut file: File, bounds: Range<usize>) -> Result<Self, String> {
        if bounds.len() < 4 { return Err("the record has a truncated header".into()) }
        file.seek(SeekFrom::Start(bounds.start as u64)).map_err(|error| error.to_string())?;
        let mut size = [0; 4];
        file.read_exact(&mut size).map_err(|error| error.to_string())?;
        let length = u32::from_le_bytes(size) as usize;
        if length > bounds.len() - 4 { return Err("the record has a truncated header".into()) }
        let mut header = Vec::from(size);
        header.try_reserve_exact(length).map_err(|error| error.to_string())?;
        header.resize(4 + length, 0);
        file.read_exact(&mut header[4..]).map_err(|error| error.to_string())?;
        let (version, mut columns) = framed_within(&header, bounds.len())?;
        for column in &mut columns {
            column.stored.start += bounds.start;
            column.stored.end += bounds.start;
        }
        Ok(Self { file, version, columns, bounds })
    }

    /// Open a framed part on the same file handle without reading its payload.
    pub(crate) fn frame(&self, name: &str) -> Result<Option<Self>, String> {
        let Some(column) = self.columns.iter().find(|column| column.name == name) else { return Ok(None) };
        if column.width != 1 || column.rows.is_some() { return Err(format!("the {name} section has the wrong encoding")) }
        let file = self.file.try_clone().map_err(|error| error.to_string())?;
        Self::within(file, column.stored.clone()).map(Some)
    }

    pub(crate) fn selected(&mut self, names: &[&str]) -> Result<Decoded, String> {
        let mut placed = Vec::new();
        let mut bytes = Vec::new();
        for column in self.columns.iter().filter(|column| names.contains(&column.name.as_str())) {
            let start = bytes.len();
            read_into(&mut self.file, &mut bytes, column.stored.clone())?;
            placed.push(Placed { name: column.name.clone(), width: column.width, rows: column.rows, stored: start..bytes.len() });
        }
        decode::decode_placed(&bytes, placed)
    }

    pub(crate) fn whole(&mut self) -> Result<Vec<u8>, String> {
        let mut bytes = Vec::new();
        read_into(&mut self.file, &mut bytes, self.bounds.clone())?;
        Ok(bytes)
    }
}

fn read_into(file: &mut File, bytes: &mut Vec<u8>, range: std::ops::Range<usize>) -> Result<(), String> {
    let start = bytes.len();
    let length = range.len();
    bytes.try_reserve_exact(length).map_err(|error| error.to_string())?;
    bytes.resize(start.checked_add(length).ok_or("the record is too large")?, 0);
    file.seek(SeekFrom::Start(range.start as u64)).and_then(|_| file.read_exact(&mut bytes[start..]))
        .map_err(|error| error.to_string())
}
