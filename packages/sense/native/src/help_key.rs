//! Which declaration an export is, and the name it is keyed by.
//!
//! A declaration is the file that declares it and the name that file exports
//! it under. `export default greet` beside `export { greet }` is one
//! declaration, `greet`, and `default` is a slot every module has, not a name:
//! it keys a declaration only when nothing names it. A named default is keyed
//! by the name it binds; an anonymous one by the local name of the import
//! nearest its file, else by the nearest export that passes it on under a name.

// compass: variance-authority.report.agent-surface

use std::cell::RefCell;
use std::collections::{BTreeSet, HashMap};

use crate::compact::Layer;
use crate::help_aliases::aliases;
use crate::help_declared::DeclaredName;
use crate::help_origin::{declaration_exported, ExportedDeclaration};
use crate::help_symbol_rows::{Export, Rows};
use crate::help_usage::{importers, Asked};
use crate::order::code_unit;

/// The name a default export is published under, which names nothing.
pub(crate) const SLOT: &str = "default";

/// Whether `spelling`, a name something is exported or imported under, says `name`: the slot says no name, not even its own.
pub(crate) fn says(spelling: &str, name: &str) -> bool {
    spelling == name && spelling != SLOT
}

/// Whether a declaration the index read is one a file can keep: `default` is
/// no binding, the index reads a default export's declaration by it and that is
/// exported, but a member may be called it.
pub(crate) fn can_keep(held: &DeclaredName) -> bool {
    held.name != SLOT || held.on.is_some()
}

/// Places nearest `from` first: the most shared leading segments, then by file in code units, then by line.
pub(crate) fn nearest(from: Option<&str>, at: &str, line: u32, other_at: &str, other_line: u32) -> std::cmp::Ordering {
    let shared = |at: &str| from.map_or(0, |from| from.split('/').zip(at.split('/')).take_while(|(a, b)| a == b).count());
    shared(other_at).cmp(&shared(at)).then_with(|| code_unit(at, other_at)).then(line.cmp(&other_line))
}

/// One declaration: where it is declared, the name it is keyed by, and every name its file exports it under, in code units.
#[derive(Clone)]
pub(crate) struct Key {
    pub at: String,
    pub named: String,
    pub spellings: Vec<String>,
}

/// What one file's exports bind: the name each export of a binding of its own binds, and, by binding, every name the file exports it under.
#[derive(Default)]
struct FileKeys {
    binds: HashMap<String, String>,
    names: HashMap<String, Vec<String>>,
}

/// The keys of one question's declarations, each file's read once.
pub(crate) struct Keys<'k> {
    root: &'k str,
    layers: &'k [Layer<'k>],
    rows: &'k Rows,
    files: RefCell<HashMap<String, std::rc::Rc<FileKeys>>>,
    origins: RefCell<HashMap<(String, String), Option<ExportedDeclaration>>>,
    anonymous: RefCell<HashMap<String, Option<String>>>,
    aliased: RefCell<HashMap<String, std::rc::Rc<BTreeSet<String>>>>,
}

impl<'k> Keys<'k> {
    pub(crate) fn new(root: &'k str, layers: &'k [Layer<'k>], rows: &'k Rows) -> Self {
        Self { root, layers, rows, files: RefCell::default(), origins: RefCell::default(), anonymous: RefCell::default(), aliased: RefCell::default() }
    }

    pub(crate) fn rows(&self) -> &'k Rows {
        self.rows
    }

    fn file(&self, at: &str) -> Option<std::rc::Rc<FileKeys>> {
        if let Some(held) = self.files.borrow().get(at) { return Some(held.clone()) }
        let mut keys = FileKeys::default();
        for one in self.rows.exports_in(at)? {
            let Some(bound) = one.bound else { continue };
            keys.binds.insert(one.name.to_owned(), bound.to_owned());
            let spelled = keys.names.entry(bound.to_owned()).or_default();
            if !spelled.iter().any(|held| held == one.name) { spelled.push(one.name.to_owned()) }
        }
        for spelled in keys.names.values_mut() { spelled.sort_by(|a, b| code_unit(a, b)) }
        let keys = std::rc::Rc::new(keys);
        self.files.borrow_mut().insert(at.to_owned(), keys.clone());
        Some(keys)
    }

    /// The declaration `name` of `at` exports: its own file's, or the one it passes on.
    pub(crate) fn key_of(&self, at: &str, name: &str) -> Option<Key> {
        if let Some(bound) = self.file(at)?.binds.get(name) { return self.own_key(at, bound) }
        Some(match self.origin_of(at, name)? {
            None => Key { at: at.to_owned(), named: name.to_owned(), spellings: vec![name.to_owned()] },
            Some(origin) => Key { at: origin.at.clone(), named: self.origin_key(&origin)?.named, spellings: vec![name.to_owned()] },
        })
    }

    /// The key of `origin`, a declaration the source index walked to: its declaring file's export of the same binding.
    pub(crate) fn origin_key(&self, origin: &ExportedDeclaration) -> Option<Key> {
        let own = self.file(&origin.at)?.binds.values().any(|binds| *binds == origin.name);
        if own { return self.own_key(&origin.at, &origin.name) }
        Some(Key { at: origin.at.clone(), named: origin.name.clone(), spellings: vec![origin.name.clone()] })
    }

    fn own_key(&self, at: &str, bound: &str) -> Option<Key> {
        let spellings = self.file(at)?.names.get(bound).cloned().unwrap_or_else(|| vec![bound.to_owned()]);
        let named = if spellings.iter().any(|one| one == bound) { bound } else { spellings.iter().find(|one| *one != SLOT).map_or(bound, String::as_str) };
        let named = if named == SLOT { self.anonymous_name(at)?.unwrap_or_else(|| SLOT.to_owned()) } else { named.to_owned() };
        Some(Key { at: at.to_owned(), named, spellings })
    }

    /// Whether `name` of `at` answers to `asked`: exported under it, keyed by it, or an anonymous default an import binds to it.
    pub(crate) fn answers(&self, at: &str, name: &str, asked: &str) -> Option<bool> {
        if says(name, asked) { return Some(true) }
        let file = self.file(at)?;
        let Some(bound) = file.binds.get(name) else {
            return Some(asked == SLOT && name == SLOT && self.key_of(at, name)?.named == SLOT);
        };
        if bound == SLOT && asked != SLOT { return Some(self.aliased_to(asked)?.contains(at)) }
        let key = self.key_of(at, name)?;
        Some(key.named == asked || key.spellings.iter().any(|one| says(one, asked)))
    }

    /// Every export that answers to `name`, in export-list order.
    pub(crate) fn answering(&self, name: &str) -> Option<Vec<Export<'k>>> {
        let rows = self.rows;
        let spelled = rows.exports_spelled(name)?;
        let mut can = spelled.clone();
        if name != SLOT {
            let mut files = BTreeSet::new();
            for &row in &spelled { files.insert(rows.export(row)?.at.to_owned()); }
            files.extend(self.aliased_to(name)?.iter().cloned());
            for at in &files { can.extend(rows.exports_in(at)?.iter().map(Export::row)); }
        }
        can.extend(rows.exports(name)?.iter().filter(|held| held.bound == Some(name)).map(Export::row));
        let mut found = Vec::new();
        for row in can {
            let held = rows.export(row)?;
            if self.answers(held.at, held.name, name)? { found.push(held) }
        }
        Some(found)
    }

    /// The declaration `name` of `at` passes on from another file; none when its own file binds it.
    pub(crate) fn origin_of(&self, at: &str, name: &str) -> Option<Option<ExportedDeclaration>> {
        if self.file(at)?.binds.contains_key(name) { return Some(None) }
        let key = (at.to_owned(), name.to_owned());
        if let Some(held) = self.origins.borrow().get(&key) { return Some(held.clone()) }
        let origin = declaration_exported(self.layers, at, name).filter(|bound| bound.at != at);
        self.origins.borrow_mut().insert(key, origin.clone());
        Some(origin)
    }

    /// The files an import of `default` bound to `name` reaches, and the declaring file of a default each passes on.
    fn aliased_to(&self, name: &str) -> Option<std::rc::Rc<BTreeSet<String>>> {
        if let Some(held) = self.aliased.borrow().get(name) { return Some(held.clone()) }
        let mut files = BTreeSet::new();
        for alias in aliases(self.root, self.layers, name) {
            let Some(to) = alias.to.filter(|_| alias.imported == SLOT) else { continue };
            if let Some(origin) = self.origin_of(&to, SLOT)? { files.insert(origin.at); }
            files.insert(to);
        }
        let files = std::rc::Rc::new(files);
        self.aliased.borrow_mut().insert(name.to_owned(), files.clone());
        Some(files)
    }

    /// The name the anonymous default of `at` is known by: the local name of the import nearest it, else the name the nearest export passing it on gives it.
    fn anonymous_name(&self, at: &str) -> Option<Option<String>> {
        if let Some(held) = self.anonymous.borrow().get(at) { return Some(held.clone()) }
        let read = importers(self.root, self.layers, &[vec![Asked { file: at.to_owned(), name: SLOT.to_owned() }]]);
        let group = read.groups.into_iter().next();
        let mut locals: Vec<_> = group.iter().flat_map(|group| &group.uses)
            .filter_map(|use_| use_.local.as_deref().filter(|local| !local.is_empty()).map(|local| (use_.at.as_str(), use_.line, local))).collect();
        locals.sort_by(|a, b| nearest(Some(at), a.0, a.1, b.0, b.1));
        let named = match locals.first() {
            Some((_, _, local)) => Some((*local).to_owned()),
            None => self.door_name(at, group.as_ref().map_or(&[][..], |group| &group.through))?,
        };
        self.anonymous.borrow_mut().insert(at.to_owned(), named.clone());
        Some(named)
    }

    /// The name the export nearest `at` among `through`, the files that pass its default on, gives it.
    fn door_name(&self, at: &str, through: &[String]) -> Option<Option<String>> {
        let mut naming = Vec::new();
        let mut rows = Vec::new();
        for file in through.iter().collect::<BTreeSet<_>>() { rows.extend(self.rows.exports_in(file)?) }
        rows.sort_by_key(Export::row);
        for door in rows {
            if door.bound.is_some() || door.name == SLOT || self.rows.export_kind(&door)? != "source" { continue }
            let origin = self.origin_of(door.at, door.name)?;
            if origin.is_some_and(|origin| origin.at == at && origin.name == SLOT) {
                naming.push((door.at, self.rows.export_line(&door)?, door.name));
            }
        }
        naming.sort_by(|a, b| nearest(Some(at), a.0, a.1, b.0, b.1));
        Some(naming.first().map(|(_, _, name)| (*name).to_owned()))
    }
}
