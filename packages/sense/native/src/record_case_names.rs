//! Read the test files and names from a case section without loading coverage.

// compass: variance-authority.reach

use std::path::Path;

use crate::journey_columns::FileFrame;
use crate::record_layout::LAYOUT;

pub(crate) fn case_names(path: &Path) -> Result<Option<Vec<(String, String)>>, String> {
    let Some(file) = FileFrame::open(path)? else { return Ok(None) };
    if !LAYOUT.coverage.readable(file.version) { return Err(format!("unsupported record version: {}", file.version)) }
    let Some(mut cases) = file.frame(LAYOUT.coverage.part("index"))? else { return Ok(None) };
    let version = cases.version;
    let versions = &LAYOUT.cases;
    if version != versions.format && version != versions.loaded_sets && ![5, 4, 1].contains(&version) {
        return Err(format!("unsupported execution index version: {version}"));
    }
    let mut columns = cases.selected(&["strings.blob", "strings.off", "tests.file", "tests.name"])?;
    let files = columns.take_words("tests.file")?;
    let names = columns.take_words("tests.name")?;
    let offsets = columns.take_words("strings.off")?;
    let text = std::str::from_utf8(columns.held("strings.blob")?).map_err(|error| error.to_string())?;
    if files.len() != names.len() { return Err("the case name and file counts differ".into()) }
    let get = |at: u32| {
        let at = at as usize;
        let from = *offsets.get(at)? as usize;
        let end = *offsets.get(at + 1)? as usize;
        text.get(from..end)
    };
    files.into_iter().zip(names).map(|(file, name)| {
        get(file).zip(get(name)).map(|(file, name)| (file.to_owned(), name.to_owned()))
            .ok_or_else(|| "the case names a string outside its dictionary".to_owned())
    }).collect::<Result<_, _>>().map(Some)
}
