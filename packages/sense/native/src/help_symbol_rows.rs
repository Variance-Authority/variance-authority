//! The published name, export and import rows an exact source question reads.

// compass: variance-authority.report.agent-surface

use std::cmp::Ordering;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::io::{Read, Seek};
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

#[cfg(feature = "standalone-cli")]
const SEARCH_COLUMNS: [(&str, u8); 22] = [
    ("names.lower", 1), ("names.lowerOff", 4),
    ("pub.docLower", 1), ("pub.docLowerOff", 4),
    ("exp.docLower", 1), ("exp.docLowerOff", 4), ("exp.doc", 4), ("exp.kind", 1), ("exp.line", 4),
    ("terms.blob", 1), ("terms.off", 4), ("terms.nameOff", 4), ("terms.name", 4),
    ("pub.doc", 4), ("terms.pubOff", 4), ("terms.pub", 4), ("terms.expOff", 4), ("terms.exp", 4),
    ("terms.pubSigOff", 4), ("terms.pubSig", 4), ("terms.expSigOff", 4), ("terms.expSig", 4),
];

const EXPORTED_COLUMNS: [(&str, u8); 9] = [
    ("exp.line", 4), ("exp.type", 1), ("exp.kind", 1), ("exp.declaration", 4),
    ("pkg.name", 4), ("pkg.entry", 1), ("pkg.openOff", 4), ("open.source", 4), ("open.subpath", 4),
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

impl Export<'_> {
    /// The row of the export list this export is on.
    pub(crate) fn row(&self) -> usize {
        self.row
    }
}

impl Rows {
    pub(crate) fn paths_written(&self, specifier: &str) -> Option<BTreeSet<&str>> {
        let mut paths = BTreeSet::new();
        for row in 0..self.column("deep.specifier").len() {
            if self.string("deep.specifier", row)? == specifier {
                paths.extend(self.optional("deep.to", row)?);
            }
        }
        Some(paths)
    }

    pub(crate) fn columns<const N: usize>(file: &mut (impl Read + Seek), wanted: [(&'static str, u8); N]) -> Option<Self> {
        let columns = read_sections(file, FORMAT, VERSION, wanted).ok()?;
        Some(Self(wanted.into_iter().map(|(name, _)| name).zip(columns).collect()))
    }

    pub(crate) fn read(file: &mut (impl Read + Seek)) -> Option<Self> {
        Self::columns(file, NAME_COLUMNS)
    }

    pub(crate) fn read_entries(&mut self, file: &mut (impl Read + Seek)) -> Option<()> {
        let columns = read_sections(file, FORMAT, VERSION, ENTRY_COLUMNS).ok()?;
        self.0.extend(ENTRY_COLUMNS.into_iter().map(|(name, _)| name).zip(columns));
        Some(())
    }

    pub(crate) fn read_paths(&mut self, file: &mut (impl Read + Seek)) -> Option<()> {
        let columns = read_sections(file, FORMAT, VERSION, PATH_COLUMNS).ok()?;
        self.0.extend(PATH_COLUMNS.into_iter().map(|(name, _)| name).zip(columns));
        Some(())
    }

    pub(crate) fn read_path_targets(&mut self, file: &mut (impl Read + Seek)) -> Option<()> {
        let [specifiers, targets] = read_sections(file, FORMAT, VERSION, [("deep.specifier", 4), ("deep.to", 4)]).ok()?;
        self.0.insert("deep.specifier", specifiers);
        self.0.insert("deep.to", targets);
        Some(())
    }

    /// What an answer about an unpublished export says of it: its line, kind and type-only flag, its declaration's kind, whether its package's entry was followed, and the doors of the entries that publish it inside a namespace.
    pub(crate) fn read_exported(&mut self, file: &mut (impl Read + Seek)) -> Option<()> {
        let columns = read_sections(file, FORMAT, VERSION, EXPORTED_COLUMNS).ok()?;
        self.0.extend(EXPORTED_COLUMNS.into_iter().map(|(name, _)| name).zip(columns));
        Some(())
    }

    /// The doors of the entry openings whose source is one of `files`, in row order: the source and the door's specifier.
    pub(crate) fn openings_in(&self, files: &HashSet<&str>) -> Option<Vec<(&str, String)>> {
        let packages = self.column("pkg.openOff");
        let mut doors = Vec::new();
        let mut package = 0;
        for row in 0..self.column("open.source").len() {
            while packages.at(package + 1) as usize <= row { package += 1 }
            let Some(source) = self.optional("open.source", row)? else { continue };
            if !files.contains(source) { continue }
            let subpath = self.string("open.subpath", row)?;
            let name = self.string("pkg.name", package)?;
            doors.push((source, if subpath == "." { name.to_owned() } else { format!("{name}{}", &subpath[1..]) }));
        }
        Some(doors)
    }

    #[cfg(feature = "standalone-cli")]
    pub(crate) fn read_search(&mut self, file: &mut (impl Read + Seek)) -> Option<()> {
        let columns = read_sections(file, FORMAT, VERSION, SEARCH_COLUMNS).ok()?;
        self.0.extend(SEARCH_COLUMNS.into_iter().map(|(name, _)| name).zip(columns));
        Some(())
    }

    /// Whether the column `key` was read.
    pub(crate) fn holds(&self, key: &str) -> bool {
        self.0.contains_key(key)
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
        for row in 0..self.column(bindings).len() {
            if self.optional(bindings, row)? == Some(name) {
                found.insert(row);
            }
        }
        Some(found)
    }

    pub(crate) fn published(&self, name: &str) -> Option<BTreeSet<usize>> {
        self.candidates(name, "names.pubOff", "names.pub", "pub.declared")
    }

    /// The rows publishing a declaration of `declaring`, each a file and the name it exports it under.
    pub(crate) fn published_declaring(&self, declaring: &HashSet<(&str, &str)>) -> Option<BTreeSet<usize>> {
        let mut found = BTreeSet::new();
        for row in 0..self.column("pub.declared").len() {
            if declaring.contains(&(self.string("pub.at", row)?, self.string("pub.declared", row)?)) { found.insert(row); }
        }
        Some(found)
    }

    /// Whether an entry publishes a declaration its file exports under one of `names`.
    pub(crate) fn publishes_declared(&self, names: &HashSet<&str>) -> Option<bool> {
        for row in 0..self.column("pub.declared").len() {
            if names.contains(self.string("pub.declared", row)?) { return Some(true) }
        }
        Some(false)
    }

    /// Every name a file exporting `name` exports the same binding under.
    pub(crate) fn exported_beside(&self, name: &str) -> Option<HashSet<&str>> {
        let mut beside = HashSet::new();
        for held in self.exports(name)? {
            let Some(bound) = held.bound else { continue };
            for other in self.exports_in(held.at)? {
                if other.bound == Some(bound) { beside.insert(other.name); }
            }
        }
        Some(beside)
    }

    pub(crate) fn published_names(&self) -> Option<Vec<&str>> {
        let column = self.column("pub.name");
        let mut seen = BTreeSet::new();
        (0..column.len()).map(|row| column.at(row)).filter(|id| seen.insert(*id))
            .map(|id| self.string("names.name", id as usize)).collect()
    }

    pub(crate) fn exports(&self, name: &str) -> Option<Vec<Export<'_>>> {
        self.candidates(name, "names.expOff", "names.exp", "exp.bound")?.into_iter().map(|row| self.export(row)).collect()
    }

    /// The export on row `row` of the export list.
    pub(crate) fn export(&self, row: usize) -> Option<Export<'_>> {
        Some(Export {
            name: self.string("names.name", self.number("exp.name", row)? as usize)?,
            at: self.string("exp.at", row)?,
            by: self.string("exp.by", row)?,
            bound: self.optional("exp.bound", row)?,
            row,
        })
    }

    /// The rows exporting `name` under that name, in row order.
    pub(crate) fn exports_spelled(&self, name: &str) -> Option<BTreeSet<usize>> {
        self.spelled(name, "names.expOff", "names.exp")
    }

    /// The rows publishing `name` under that name, in row order.
    pub(crate) fn published_spelled(&self, name: &str) -> Option<BTreeSet<usize>> {
        self.spelled(name, "names.pubOff", "names.pub")
    }

    fn spelled(&self, name: &str, offsets: &str, rows: &str) -> Option<BTreeSet<usize>> {
        let mut found = BTreeSet::new();
        if let Some(id) = self.name_row(name)? {
            for row in self.range(offsets, id)? { found.insert(self.number(rows, row)? as usize); }
        }
        Some(found)
    }

    /// The rows of every export `at` writes, in row order.
    pub(crate) fn exports_in(&self, at: &str) -> Option<Vec<Export<'_>>> {
        let mut found = Vec::new();
        for row in 0..self.column("exp.at").len() {
            if self.string("exp.at", row)? == at { found.push(self.export(row)?) }
        }
        Some(found)
    }

    pub(crate) fn path_uses(&self, name: &str) -> Option<Vec<usize>> {
        let off = self.column("deep.namesOff");
        let start = self.number("deep.namesOff", 0)? as usize;
        let end = self.number("deep.namesOff", off.len().checked_sub(1)?)? as usize;
        let mut matching = Vec::new();
        for row in start..end {
            if self.optional("use.name", row)? == Some(name) { matching.push(row); }
        }
        Some(matching)
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

    /// Whether `export` is written `export type`, as `read_exported` reads it.
    pub(crate) fn export_type(&self, export: &Export<'_>) -> Option<bool> {
        Some(*self.bytes("exp.type").get(export.row)? != 0)
    }

    /// Whether the file `export` is in is a story, a test, or ordinary source.
    pub(crate) fn export_kind(&self, export: &Export<'_>) -> Option<&'static str> {
        crate::help_store::USE_KINDS.get(*self.bytes("exp.kind").get(export.row)? as usize).copied()
    }

    /// The kind of the declaration `export` binds in its own file; `None` for `export … from`.
    pub(crate) fn export_declaration(&self, export: &Export<'_>) -> Option<Option<&str>> {
        self.optional("exp.declaration", export.row)
    }

    /// The packages that declare an entry this reading followed to no source file.
    pub(crate) fn unfollowed(&self) -> Option<HashSet<&str>> {
        let entry = self.bytes("pkg.entry");
        let mut unfollowed = HashSet::new();
        for row in 0..self.column("pkg.name").len() {
            if *entry.get(row)? != 0 && self.range("pkg.openOff", row)?.is_empty() { unfollowed.insert(self.string("pkg.name", row)?); }
        }
        Some(unfollowed)
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
