//! Package surfaces read from Help's published columns.

// compass: variance-authority.report.agent-surface

use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::ops::Range;

use crate::help_name_scope::owner_of;
use crate::help_search_answer::plural;
use crate::help_surface::shell;
use crate::help_symbol_rows::Rows;
use crate::order::code_unit;

#[path = "help_entrypoint_answer.rs"]
mod entrypoint;

const UNFOLLOWED: &str =
    "this reading could not follow to a source file, such as a build output the checkout does not hold";
const REACHING: &str =
    "Either the manifest has stopped describing what the package is used for, or something is reaching into its internals";
const NOTHING: &str = "this workspace publishes no package: no manifest it declares is both named and public";

pub(crate) fn packages(file: &mut File) -> Option<String> {
    let rows = Rows::columns(
        file,
        [
            ("strings.blob", 1),
            ("strings.off", 4),
            ("pkg.name", 4),
            ("pkg.entry", 1),
            ("pkg.openOff", 4),
            ("open.subpath", 4),
            ("open.entryOff", 4),
            ("pub.usedByOff", 4),
            ("pub.doc", 4),
            ("deep.specifier", 4),
            ("deep.by", 4),
            ("deep.to", 4),
            ("deep.groups", 4),
            ("deep.namesOff", 4),
            ("use.name", 4),
            ("unreadable", 4),
        ],
    )?;
    let surface = Surface(&rows);
    let opened = surface.openings()?;
    let mut answer = Vec::new();
    if surface.packages().is_empty() {
        answer.push(format!("T{}.", &NOTHING[1..]));
    }
    answer.extend(opened.iter().map(Opening::line));
    let mut paths = HashMap::<&str, (HashSet<(&str, &str)>, HashSet<&str>)>::new();
    for row in surface.group(1)? {
        let spec = rows.string("deep.specifier", row)?;
        let owner = owner_of(spec);
        if rows.string("deep.by", row)? == owner {
            continue;
        }
        let file = rows.optional("deep.to", row)?.unwrap_or(spec);
        let (names, files) = paths.entry(owner).or_default();
        files.insert(file);
        surface.each_name(row, |name| {
            names.insert((file, name));
        })?;
    }
    let unentered =
        ordered(paths.into_iter().map(|(owner, (names, files))| (owner, (names.len(), files.len()))), |row| row.0);
    let deep = surface.import_counts(0)?;
    let unfollowed = surface.import_counts(2)?;
    if !unentered.is_empty() {
        block(
            &mut answer,
            format!(
                "{} imported by path, most names first:",
                plural(unentered.len(), "package that declares no entry is", "packages that declare no entry are")
            ),
            unentered.iter().map(|(owner, (names, files))| format!("  {owner} — {}", counted(*names, *files))),
        );
    }
    if !deep.is_empty() {
        let total = deep.iter().map(|(_, imports)| imports).sum();
        block(
            &mut answer,
            format!("{} past a published entrypoint. {REACHING}:", plural(total, "import reaches", "imports reach")),
            deep.iter().map(|(owner, imports)| format!("  {owner} — {}", count(*imports, "import"))),
        );
    }
    let mut unfollowed_packages = Vec::new();
    for pkg in surface.packages() {
        if surface.declares(pkg)? && rows.range("pkg.openOff", pkg)?.is_empty() {
            unfollowed_packages.push(rows.string("pkg.name", pkg)?);
        }
    }
    let naming: usize = unfollowed.iter().map(|(_, imports)| imports).sum();
    let missing = unfollowed_packages.len();
    if missing > 0 || naming > 0 {
        let mut heading = Vec::new();
        if missing > 0 {
            heading.push(format!(
                "{} an entry {UNFOLLOWED}, so none of {} names are listed.",
                plural(missing, "package declares", "packages declare"),
                if missing == 1 { "its" } else { "their" }
            ));
        }
        if naming > 0 {
            let entry = if missing == 0 { format!("an entry {UNFOLLOWED}") } else { "an entry like that".into() };
            heading.push(format!("{} {entry}, most first:", plural(naming, "import names", "imports name")));
        }
        block(
            &mut answer,
            heading.join(" "),
            unfollowed.iter().map(|(owner, imports)| format!("  {owner} — {}", count(*imports, "import"))),
        );
    }
    let unread = rows.column("unreadable");
    if unread.len() > 0 {
        let paths = (0..unread.len())
            .map(|row| Some(format!("  {}", rows.string("unreadable", row)?)))
            .collect::<Option<Vec<_>>>()?;
        block(
            &mut answer,
            format!("{} could not be read, so the usage counts above are floors:", count(unread.len(), "file")),
            paths,
        );
    }
    let asks = [
        most_used(&opened).map(|opening| opening.spec.as_str()),
        unentered.first().map(|(name, _)| *name),
        deep.first().map(|(name, _)| *name),
        deep.iter().find(|(name, _)| unfollowed_packages.contains(name)).map(|(name, _)| *name),
    ];
    let mut seen = HashSet::new();
    narrower(&mut answer, asks.into_iter().flatten().filter(|name| seen.insert(*name)).map(ask_entry));
    Some(answer.join("\n"))
}

pub(crate) fn names(file: &mut File, package: &str, subpath: Option<&str>) -> Option<Result<String, String>> {
    entrypoint::answer(file, package, subpath)
}

struct Surface<'a>(&'a Rows);

struct Opening {
    row: usize,
    spec: String,
    names: usize,
    used: usize,
    documented: usize,
}

impl Opening {
    fn line(&self) -> String {
        format!(
            "{} — {}, {} imported elsewhere, {} documented",
            self.spec,
            count(self.names, "name"),
            self.used,
            self.documented
        )
    }
}

impl<'a> Surface<'a> {
    fn packages(&self) -> Range<usize> {
        0..self.0.column("pkg.name").len()
    }

    fn declares(&self, package: usize) -> Option<bool> {
        Some(*self.0.bytes("pkg.entry").get(package)? != 0)
    }

    fn openings(&self) -> Option<Vec<Opening>> {
        let mut opened = Vec::new();
        for pkg in self.packages() {
            let owner = self.0.string("pkg.name", pkg)?;
            for row in self.0.range("pkg.openOff", pkg)? {
                let subpath = self.0.string("open.subpath", row)?;
                opened.push(self.opening(row, owner, subpath)?);
            }
        }
        Some(opened)
    }

    fn opening(&self, row: usize, owner: &str, subpath: &str) -> Option<Opening> {
        let entries = self.0.range("open.entryOff", row)?;
        let mut used = 0;
        let mut documented = 0;
        for entry in entries.clone() {
            used += usize::from(!self.0.range("pub.usedByOff", entry)?.is_empty());
            documented += usize::from(self.0.number("pub.doc", entry)? != crate::help_store::NONE);
        }
        Some(Opening {
            row,
            spec: format!("{owner}{}", subpath.strip_prefix('.').unwrap_or(subpath)),
            names: entries.len(),
            used,
            documented,
        })
    }

    fn group(&self, group: usize) -> Option<Range<usize>> {
        let start = if group == 0 { 0 } else { self.0.number("deep.groups", group - 1)? as usize };
        Some(start..self.0.number("deep.groups", group)? as usize)
    }

    fn each_name(&self, row: usize, mut visit: impl FnMut(&'a str)) -> Option<bool> {
        let mut named = false;
        for name in self.0.range("deep.namesOff", row)? {
            if let Some(name) = self.0.optional("use.name", name)? {
                if !name.is_empty() && name != "*" {
                    named = true;
                    visit(name);
                }
            }
        }
        Some(named)
    }

    fn import_counts(&self, group: usize) -> Option<Vec<(&'a str, usize)>> {
        let mut counts = HashMap::new();
        for row in self.group(group)? {
            let owner = owner_of(self.0.string("deep.specifier", row)?);
            if self.0.string("deep.by", row)? != owner {
                *counts.entry(owner).or_insert(0) += 1;
            }
        }
        Some(ordered(counts, |count| *count))
    }
}

fn ordered<'a, T>(rows: impl IntoIterator<Item = (&'a str, T)>, measure: impl Fn(&T) -> usize) -> Vec<(&'a str, T)> {
    let mut rows: Vec<_> = rows.into_iter().collect();
    rows.sort_unstable_by(|(a, left), (b, right)| measure(right).cmp(&measure(left)).then_with(|| code_unit(a, b)));
    rows
}

fn most_used(opened: &[Opening]) -> Option<&Opening> {
    opened
        .iter()
        .filter(|opening| opening.used > 0)
        .min_by(|a, b| b.used.cmp(&a.used).then_with(|| code_unit(&a.spec, &b.spec)))
}

fn count(n: usize, noun: &str) -> String {
    plural(n, noun, &format!("{noun}s"))
}

fn counted(names: usize, files: usize) -> String {
    format!("{} from {files} of its files", count(names, "name"))
}

fn block(answer: &mut Vec<String>, heading: String, rows: impl IntoIterator<Item = String>) {
    if !answer.is_empty() {
        answer.push(String::new());
    }
    answer.push(heading);
    answer.extend(rows);
}

fn narrower(answer: &mut Vec<String>, asks: impl IntoIterator<Item = String>) {
    let mut asks = asks.into_iter().peekable();
    if asks.peek().is_some() {
        answer.extend([String::new(), "Narrower questions:".into()]);
        answer.extend(asks.map(|ask| format!("  {ask}")));
    }
}

fn ask_entry(spec: &str) -> String {
    format!("variance ask entrypoint --package {}", shell(spec))
}
