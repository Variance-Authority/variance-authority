//! One page of an ordered list, and the lines a listing writes around it.

// compass: variance-authority.report.agent-surface

use std::ops::Range;

use crate::help_grep_collapse::plural;

/// One page of an ordered list: `limit` rows after the first `offset`.
pub(crate) struct Page {
    pub offset: usize,
    pub limit: usize,
}

impl Page {
    /// The rows of a list of `total` this page shows.
    pub(crate) fn rows(&self, total: usize) -> Range<usize> {
        let start = self.offset.min(total);
        start..start.saturating_add(self.limit).min(total)
    }

    /// What the page says above its rows when it does not start at the first: which rows it shows, or that `flag` is past the last.
    pub(crate) fn above(&self, total: usize, flag: &str) -> Option<String> {
        if self.offset == 0 {
            None
        } else if self.offset >= total {
            Some(format!("`{flag}` {} is past the last of {total} {}.", self.offset, plural(total, "row", "rows")))
        } else {
            Some(format!("Rows {}–{} of {total}.", self.offset + 1, self.rows(total).end))
        }
    }

    /// What the page says below its rows when rows remain: how many, and the `flag` that shows the next page.
    pub(crate) fn below(&self, total: usize, flag: &str) -> Option<String> {
        let end = self.rows(total).end;
        let rest = total - end;
        (rest > 0).then(|| format!("{rest} more not shown; `{flag}` {end} shows the next {}.", rest.min(self.limit)))
    }
}
