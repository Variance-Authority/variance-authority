//! The published name, export and import rows an exact source question reads.

// compass: variance-authority.report.agent-surface

use std::cmp::Ordering;
use std::collections::{BTreeSet, HashMap};
use std::fs::File;
use std::ops::Range;

use crate::help_store::{FORMAT, NONE, VERSION};
use crate::order::code_unit;
use crate::stored::{partition, read_sections, U32s};

const NAME_COLUMNS: [(&str, u8); 15] = [
    ("strings.blob", 1), ("strings.off", 4), ("names.name", 4),
    ("names.pubOff", 4), ("names.pub", 4), ("names.expOff", 4), ("names.exp", 4),
    ("pub.name", 4), ("pub.declared", 4), ("exp.name", 4), ("exp.at", 4), ("exp.by", 4), ("exp.bound", 4),
    ("deep.namesOff", 4), ("use.name", 4),
];

const ENTRY_COLUMNS: [(&str, u8); 25] = [
    ("pub.spec", 4), ("pub.at", 4),
    ("pub.kind", 4), ("pub.line", 4), ("pub.signature", 4), ("pub.doc", 4),
    ("pub.mentionAt", 4), ("pub.mentionLine", 4), ("pub.mentionText", 4),
    ("pub.usedByOff", 4), ("pub.usedByList", 4), ("pub.uses", 4),
    ("pub.sitesOff", 4), ("pub.tdOff", 4), ("open.wholeOff", 4), ("open.entryOff", 4),
    ("use.at", 4), ("use.by", 4), ("use.line", 4), ("use.local", 4), ("use.flags", 1), ("use.throughLine", 4),
    ("pkg.name", 4), ("pkg.openOff", 4), ("open.subpath", 4),
];

const PATH_COLUMNS: [(&str, u8); 9] = [
    ("deep.specifier", 4), ("deep.groups", 4), ("deep.to", 4),
    ("use.at", 4), ("use.by", 4), ("use.line", 4), ("use.local", 4), ("use.flags", 1), ("use.throughLine", 4),
];

const SEARCH_COLUMNS: [(&str, u8); 22] = [
    ("names.lower", 1), ("names.lowerOff", 4),
    ("pub.docLower", 1), ("pub.docLowerOff", 4),
    ("exp.docLower", 1), ("exp.docLowerOff", 4), ("exp.doc", 4), ("exp.kind", 1), ("exp.line", 4),
    ("terms.blob", 1), ("terms.off", 4), ("terms.nameOff", 4), ("terms.name", 4),
    ("pub.doc", 4), ("terms.pubOff", 4), ("terms.pub", 4), ("terms.expOff", 4), ("terms.exp", 4),
    ("terms.pubSigOff", 4), ("terms.pubSig", 4), ("terms.expSigOff", 4), ("terms.expSig", 4),
];

pub(crate) struct Rows(HashMap<&'static str, Vec<u8>>);

#[derive(Clone, Copy)]
pub(crate) enum PathKind { Deep, ByPath, Unfollowed }

impl PathKind {
    pub(crate) fn how(self, specifier: &str) -> String {
        match self {
            Self::Deep => format!(", deep import of {specifier}"),
            Self::ByPath => format!(", by path from {specifier}"),
            Self::Unfollowed => format!(", through {specifier}, an entry this reading could not follow to a source file"),
        }
    }
}

pub(crate) struct PathSite<'a> {
    pub specifier: &'a str,
    pub to: Option<&'a str>,
    pub kind: PathKind,
    pub site: Site<'a>,
    pub local: Option<&'a str>,
}

#[derive(Clone)]
pub(crate) struct Export<'a> {
    pub name: &'a str,
    pub at: &'a str,
    pub by: &'a str,
    pub bound: Option<&'a str>,
    row: usize,
}

pub(crate) struct Entry<'a> {
    pub name: &'a str,
    pub declared: &'a str,
    pub specifier: &'a str,
    pub package: &'a str,
    pub subpath: &'a str,
    pub at: &'a str,
    pub kind: &'a str,
    pub line: u32,
    pub signature: Option<&'a str>,
    pub doc: Option<&'a str>,
    pub mention: Option<(&'a str, u32, &'a str)>,
    pub used_by: Vec<&'a str>,
    pub uses: u32,
    pub sites: Vec<Site<'a>>,
}

#[derive(Clone, Copy)]
pub(crate) struct Site<'a> {
    pub at: &'a str,
    pub by: &'a str,
    pub line: u32,
    pub local: Option<&'a str>,
    pub kind: &'a str,
    pub type_only: bool,
    pub through: Option<(&'a str, u32)>,
    pub off: bool,
    pub whole: bool,
    pub lines: Option<&'a [u32]>,
    pub path: Option<(PathKind, &'a str)>,
}

impl Rows {
    pub(crate) fn paths_written(&self, specifier: &str) -> Option<BTreeSet<&str>> {
        let mut paths = BTreeSet::new();
        let column = self.column("deep.specifier");
        for row in self.rows_saying(column, 0..column.len(), specifier, false)? {
            paths.extend(self.optional("deep.to", row)?);
        }
        Some(paths)
    }

    pub(crate) fn columns<const N: usize>(file: &mut File, wanted: [(&'static str, u8); N]) -> Option<Self> {
        let columns = read_sections(file, FORMAT, VERSION, wanted).ok()?;
        Some(Self(wanted.into_iter().map(|(name, _)| name).zip(columns).collect()))
    }

    pub(crate) fn read(file: &mut File) -> Option<Self> {
        Self::columns(file, NAME_COLUMNS)
    }

    pub(crate) fn read_entries(&mut self, file: &mut File) -> Option<()> {
        let columns = read_sections(file, FORMAT, VERSION, ENTRY_COLUMNS).ok()?;
        self.0.extend(ENTRY_COLUMNS.into_iter().map(|(name, _)| name).zip(columns));
        Some(())
    }

    pub(crate) fn read_paths(&mut self, file: &mut File) -> Option<()> {
        let columns = read_sections(file, FORMAT, VERSION, PATH_COLUMNS).ok()?;
        self.0.extend(PATH_COLUMNS.into_iter().map(|(name, _)| name).zip(columns));
        Some(())
    }

    pub(crate) fn read_path_targets(&mut self, file: &mut File) -> Option<()> {
        let [specifiers, targets] = read_sections(file, FORMAT, VERSION, [("deep.specifier", 4), ("deep.to", 4)]).ok()?;
        self.0.insert("deep.specifier", specifiers);
        self.0.insert("deep.to", targets);
        Some(())
    }

    pub(crate) fn read_export_lines(&mut self, file: &mut File) -> Option<()> {
        let [lines] = read_sections(file, FORMAT, VERSION, [("exp.line", 4)]).ok()?;
        self.0.insert("exp.line", lines);
        Some(())
    }

    pub(crate) fn read_search(&mut self, file: &mut File) -> Option<()> {
        let columns = read_sections(file, FORMAT, VERSION, SEARCH_COLUMNS).ok()?;
        self.0.extend(SEARCH_COLUMNS.into_iter().map(|(name, _)| name).zip(columns));
        Some(())
    }

    pub(crate) fn bytes(&self, key: &str) -> &[u8] {
        &self.0[key]
    }

    pub(crate) fn column(&self, key: &str) -> U32s<'_> {
        U32s::from_column(&self.0[key])
    }

    pub(crate) fn number(&self, key: &str, row: usize) -> Option<u32> {
        let column = self.column(key);
        (row < column.len()).then(|| column.at(row))
    }

    pub(crate) fn text(&self, id: u32) -> Option<&str> {
        let at = id as usize;
        let off = self.column("strings.off");
        if at >= off.len().saturating_sub(1) { return None }
        std::str::from_utf8(self.0["strings.blob"].get(off.range(at))?).ok()
    }

    pub(crate) fn string(&self, key: &str, row: usize) -> Option<&str> {
        self.text(self.number(key, row)?)
    }

    pub(crate) fn optional(&self, key: &str, row: usize) -> Option<Option<&str>> {
        let id = self.number(key, row)?;
        if id == NONE { Some(None) } else { Some(Some(self.text(id)?)) }
    }

    pub(crate) fn range(&self, key: &str, row: usize) -> Option<Range<usize>> {
        let column = self.column(key);
        if row >= column.len().saturating_sub(1) { return None }
        let range = column.range(row);
        (range.start <= range.end).then_some(range)
    }

    /// The rows in `rows` of `column` holding the id `text` has. A string
    /// lives once in the pool, so the first row that says it, compared as
    /// bytes, gives the id, and every other row is an integer compare. A row
    /// whose id is outside the pool refuses the whole answer, as reading its
    /// text would; an absent id is passed over where `optional` allows one.
    fn rows_saying(&self, column: U32s<'_>, rows: Range<usize>, text: &str, optional: bool) -> Option<Vec<usize>> {
        let (off, blob, wanted) = (self.column("strings.off"), self.bytes("strings.blob"), text.as_bytes());
        let pooled = off.len().saturating_sub(1);
        let (mut id, mut found) = (None, Vec::new());
        for row in rows {
            let held = column.at(row);
            if held == NONE && optional { continue }
            if held as usize >= pooled { return None }
            let says = match id {
                Some(id) => held == id,
                None => blob.get(off.range(held as usize))? == wanted,
            };
            if says {
                id = Some(held);
                found.push(row);
            }
        }
        Some(found)
    }

    fn name_row(&self, name: &str) -> Option<Option<usize>> {
        let (mut first, mut last) = (0, self.column("names.name").len());
        while first < last {
            let row = first + (last - first) / 2;
            match code_unit(self.string("names.name", row)?, name) {
                Ordering::Less => first = row + 1,
                Ordering::Greater => last = row,
                Ordering::Equal => return Some(Some(row)),
            }
        }
        Some(None)
    }

    fn candidates(&self, name: &str, offsets: &str, rows: &str, bindings: &str) -> Option<BTreeSet<usize>> {
        let mut found = BTreeSet::new();
        if let Some(id) = self.name_row(name)? {
            for row in self.range(offsets, id)? {
                found.insert(self.number(rows, row)? as usize);
            }
        }
        let column = self.column(bindings);
        found.extend(self.rows_saying(column, 0..column.len(), name, true)?);
        Some(found)
    }

    pub(crate) fn published(&self, name: &str) -> Option<BTreeSet<usize>> {
        self.candidates(name, "names.pubOff", "names.pub", "pub.declared")
    }

    pub(crate) fn published_names(&self) -> Option<Vec<&str>> {
        let column = self.column("pub.name");
        let mut seen = BTreeSet::new();
        (0..column.len()).map(|row| column.at(row)).filter(|id| seen.insert(*id))
            .map(|id| self.string("names.name", id as usize)).collect()
    }

    pub(crate) fn exports(&self, name: &str) -> Option<Vec<Export<'_>>> {
        self.candidates(name, "names.expOff", "names.exp", "exp.bound")?.into_iter().map(|row| {
            Some(Export {
                name: self.string("names.name", self.number("exp.name", row)? as usize)?,
                at: self.string("exp.at", row)?,
                by: self.string("exp.by", row)?,
                bound: self.optional("exp.bound", row)?,
                row,
            })
        }).collect()
    }

    pub(crate) fn path_uses(&self, name: &str) -> Option<Vec<usize>> {
        let off = self.column("deep.namesOff");
        let start = self.number("deep.namesOff", 0)? as usize;
        let end = self.number("deep.namesOff", off.len().checked_sub(1)?)? as usize;
        let names = self.column("use.name");
        if end > names.len() { return None }
        self.rows_saying(names, start..end, name, true)
    }

    pub(crate) fn path_site(&self, use_row: usize) -> Option<PathSite<'_>> {
        let off = self.column("deep.namesOff");
        let row = partition(off.len(), |at| off.at(at) as usize <= use_row).checked_sub(1)?;
        let groups = self.column("deep.groups");
        let kind = match partition(groups.len(), |at| groups.at(at) as usize <= row) {
            0 => PathKind::Deep,
            1 => PathKind::ByPath,
            _ => PathKind::Unfollowed,
        };
        let specifier = self.string("deep.specifier", row)?;
        let mut site = self.site(use_row)?;
        site.path = Some((kind, specifier));
        Some(PathSite {
            specifier,
            to: self.optional("deep.to", row)?,
            kind,
            site,
            local: self.optional("use.local", use_row)?,
        })
    }

    pub(crate) fn export_line(&self, export: &Export<'_>) -> Option<u32> {
        self.number("exp.line", export.row)
    }

    pub(crate) fn entry(&self, row: usize) -> Option<Entry<'_>> {
        let opening = self.column("open.entryOff");
        let parent = partition(opening.len(), |at| opening.at(at) as usize <= row).checked_sub(1)?;
        let packages = self.column("pkg.openOff");
        let package = partition(packages.len(), |at| packages.at(at) as usize <= parent).checked_sub(1)?;
        let sites = self.range("pub.sitesOff", row)?.chain(self.range("pub.tdOff", row)?)
            .chain(self.range("open.wholeOff", parent)?).map(|use_row| self.site(use_row)).collect::<Option<_>>()?;
        let mention = match self.optional("pub.mentionAt", row)? {
            Some(at) => Some((at, self.number("pub.mentionLine", row)?, self.string("pub.mentionText", row)?)),
            None => None,
        };
        Some(Entry {
            name: self.string("names.name", self.number("pub.name", row)? as usize)?,
            declared: self.string("pub.declared", row)?,
            specifier: self.string("pub.spec", row)?,
            package: self.string("pkg.name", package)?,
            subpath: self.string("open.subpath", parent)?,
            at: self.string("pub.at", row)?,
            kind: self.string("pub.kind", row)?,
            line: self.number("pub.line", row)?,
            signature: self.optional("pub.signature", row)?,
            doc: self.optional("pub.doc", row)?,
            mention,
            used_by: self.range("pub.usedByOff", row)?.map(|id| self.string("pub.usedByList", id)).collect::<Option<_>>()?,
            uses: self.number("pub.uses", row)?,
            sites,
        })
    }

    fn site(&self, row: usize) -> Option<Site<'_>> {
        let flags = *self.0["use.flags"].get(row)?;
        let through = match (flags >> 3) & 3 {
            1 => Some(("dynamic", self.number("use.throughLine", row)?)),
            2 => Some(("namespace", self.number("use.throughLine", row)?)),
            _ => None,
        };
        Some(Site {
            at: self.string("use.at", row)?,
            by: self.string("use.by", row)?,
            line: self.number("use.line", row)?,
            local: self.optional("use.local", row)?.or(self.optional("use.name", row)?),
            kind: crate::help_store::USE_KINDS.get(((flags >> 1) & 3) as usize).copied().unwrap_or("source"),
            type_only: flags & 1 != 0,
            through,
            off: through.is_some() && flags & 32 != 0,
            whole: through.is_some() && flags & 64 != 0,
            lines: None,
            path: None,
        })
    }
}

#[cfg(test)]
#[path = "help_symbol_rows_tests.rs"]
mod tests;
