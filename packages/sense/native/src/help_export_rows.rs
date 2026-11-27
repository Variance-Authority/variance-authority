//! Export row numbers grouped once per opened reader, as the TypeScript
//! store reader's `exportedIn` groups them: pooled file ids, no hydrated exports.

// compass: variance-authority.report.agent-surface

use std::cell::OnceCell;

use super::Rows;

#[derive(Default)]
pub(super) struct ByFile(OnceCell<Option<Grouped>>);

struct Grouped {
    off: Vec<u32>,
    rows: Vec<u32>,
}

impl ByFile {
    pub(super) fn get(&self, store: &Rows, at: &str) -> Option<&[u32]> {
        let grouped = self.0.get_or_init(|| group(store)).as_ref()?;
        let Some(id) = file_id(store, at)? else { return Some(&[]) };
        grouped.rows.get(*grouped.off.get(id)? as usize..*grouped.off.get(id + 1)? as usize)
    }
}

/// `files` holds pooled ids in the byte order of the paths, not in id order.
fn file_id(store: &Rows, at: &str) -> Option<Option<usize>> {
    let files = store.column("files");
    let (mut first, mut last) = (0, files.len());
    while first < last {
        let middle = first + (last - first) / 2;
        let id = files.at(middle);
        match store.text(id)?.as_bytes().cmp(at.as_bytes()) {
            std::cmp::Ordering::Less => first = middle + 1,
            std::cmp::Ordering::Greater => last = middle,
            std::cmp::Ordering::Equal => return Some(Some(id as usize)),
        }
    }
    Some(None)
}

fn group(store: &Rows) -> Option<Grouped> {
    let pooled = store.column("strings.off").len().checked_sub(1)?;
    let files = store.column("exp.at");
    let mut off = vec![0u32; pooled + 1];
    for row in 0..files.len() {
        #[cfg(test)]
        store.file_rows_read.set(store.file_rows_read.get() + 1);
        let id = files.at(row);
        let count = off.get_mut(id as usize + 1)?;
        // The old whole-column lookup refused any invalid path, even when unasked.
        if *count == 0 { store.text(id)?; }
        *count = count.checked_add(1)?;
    }
    for id in 1..off.len() { off[id] = off[id].checked_add(off[id - 1])?; }
    let mut next = off[..pooled].to_vec();
    let mut rows = vec![0; files.len()];
    for row in 0..files.len() {
        #[cfg(test)]
        store.file_rows_read.set(store.file_rows_read.get() + 1);
        let at = &mut next[files.at(row) as usize];
        rows[*at as usize] = u32::try_from(row).ok()?;
        *at += 1;
    }
    Some(Grouped { off, rows })
}
