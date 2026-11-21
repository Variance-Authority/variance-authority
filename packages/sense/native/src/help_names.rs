//! The names each published entry hands out, and the declaration each kind of
//! each name is read from: what the Help value documents for an opening.
//!
//! An entry's names are its file's exports, and what an export binds is
//! answered in the file that declares it: a local declaration by its own row,
//! `export { x } from './y'` and an imported name exported again by the names
//! the file they lead to hands out, `export *` by every name that file hands
//! out, `default` among them. The parse says which name each export passes on
//! and which name each import binds, and the file's record says which file each
//! request resolved to; a bare specifier goes to the entry the workspace opens
//! under it, and a `.js` to the declaration file written beside it, since a
//! published name is what a type checker reads.
//!
//! This is not ECMAScript's resolution ([`crate::help_origin`] walks that): a
//! star passes `default` on, two stars that reach one name keep the first, and
//! a name the walk cannot read stays a row, `foreign` or `namespace-object`,
//! rather than none. The reading under both walks is one: [`Parsed`].

// compass: variance-authority.report.agent-surface

use std::collections::{HashMap, HashSet};
use std::rc::Rc;

use napi_derive::napi;

use crate::compact::Layer;
use crate::help_origin::{Parsed, RequestRow};

/// One opening the workspace publishes: its `<package> .<subpath>` key, and
/// the repo-relative file its entry is read from.
#[napi(object)]
#[derive(Clone, Debug)]
pub struct HelpEntry {
    pub key: String,
    pub file: String,
}

/// One kind of one published name: where it is declared, its line, head and
/// doc comment as [`crate::text_cut`] cuts them, and the name it is declared
/// under there.
#[napi(object)]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReachedDeclaration {
    /// As the parser harvested it, or `foreign` for a name read from no
    /// declaration of the checkout, `namespace-object` for a module held whole.
    pub kind: String,
    pub at: String,
    pub line: u32,
    pub signature: Option<String>,
    pub doc: Option<String>,
    pub declared: String,
}

/// One name an entry hands out, and its kinds, the first declaration read of
/// each kind kept, in the order they were read.
#[napi(object)]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PublishedName {
    pub name: String,
    pub kinds: Vec<ReachedDeclaration>,
}

/// The names of one file, in the order they were first read.
#[derive(Default)]
struct Names {
    order: Vec<PublishedName>,
    at: HashMap<String, usize>,
}

impl Names {
    /// A kind already held keeps its first declaration.
    fn add(&mut self, name: &str, declaration: ReachedDeclaration) {
        match self.at.get(name) {
            None => {
                self.at.insert(name.to_owned(), self.order.len());
                self.order.push(PublishedName { name: name.to_owned(), kinds: vec![declaration] });
            }
            Some(&at) => {
                let kinds = &mut self.order[at].kinds;
                if !kinds.iter().any(|held| held.kind == declaration.kind) {
                    kinds.push(declaration);
                }
            }
        }
    }

    fn get(&self, name: &str) -> Option<&[ReachedDeclaration]> {
        self.at.get(name).map(|&at| self.order[at].kinds.as_slice())
    }
}

/// The names each of `entries` hands out, in their order, read off the
/// chain's newest parses. A file reached twice is read once, and a file met
/// again on the way to itself hands out nothing there. `Err` names the first
/// export whose declaration the reading cannot say: a name nothing in its file
/// binds, or one the file it leads to does not hand out.
pub(crate) fn published_names<'a>(layers: &'a [Layer<'a>], entries: &[HelpEntry]) -> Result<Vec<Vec<PublishedName>>, String> {
    let mut walk = Walk {
        layers,
        // A key opened twice is the last manifest's, as a map keeps it.
        entrypoints: entries.iter().map(|entry| (entry.key.as_str(), entry.file.as_str())).collect(),
        parsed: HashMap::new(),
        reached: HashMap::new(),
    };
    let reached = entries.iter().map(|entry| walk.names_at(&entry.file, &mut HashSet::new())).collect::<Result<Vec<_>, _>>()?;
    // Once the walk lets go of what it read, each entry's names are taken, not copied; only a
    // file two entries open is copied, for the first, and the last to open it takes it.
    drop(walk);
    Ok(reached.into_iter().map(|names| Rc::try_unwrap(names).map_or_else(|shared| shared.order.clone(), |names| names.order)).collect())
}

struct Walk<'a, 'e> {
    layers: &'a [Layer<'a>],
    entrypoints: HashMap<&'e str, &'e str>,
    parsed: HashMap<String, Option<Rc<Parsed<'a>>>>,
    reached: HashMap<String, Rc<Names>>,
}

impl<'a> Walk<'a, '_> {
    /// The file's reading, when the chain holds its parse and the targets of its requests.
    fn source(&mut self, file: &str) -> Option<Rc<Parsed<'a>>> {
        if let Some(held) = self.parsed.get(file) {
            return held.clone();
        }
        let read = Parsed::of(self.layers, file).map(Rc::new);
        self.parsed.insert(file.to_owned(), read.clone());
        read
    }

    fn holds(&mut self, file: &str) -> bool {
        self.source(file).is_some()
    }

    /// The graph's edge to `./theme` lands on `theme.js` on purpose: a change
    /// to the file a runtime loads has to reach its importers. A published name
    /// is what a type checker reads, and TypeScript reads the declaration
    /// written beside that file first, so a name followed here does the same.
    fn typed(&mut self, target: Option<&str>) -> Option<String> {
        let target = target?;
        let typed = [(".mjs", "mts"), (".cjs", "cts"), (".js", "ts")]
            .into_iter()
            .find_map(|(script, types)| target.strip_suffix(script).map(|stem| format!("{stem}.d.{types}")));
        Some(match typed {
            Some(declaration) if self.holds(&declaration) => declaration,
            _ => target.to_owned(),
        })
    }

    /// The file `specifier`, written in `source`, leads to: a bare one to the
    /// entry opened under it, a relative one to the first request that writes it.
    fn target_of(&mut self, source: &Parsed<'a>, specifier: &str) -> Option<String> {
        if !specifier.starts_with('.') {
            let (_, key) = crate::help_usage::requested(specifier);
            return self.entrypoints.get(key.as_str()).map(|&file| file.to_owned());
        }
        let target = source.requests().find(|request| request.value == specifier)?.target;
        self.typed(target)
    }

    fn names_at(&mut self, file: &str, stack: &mut HashSet<String>) -> Result<Rc<Names>, String> {
        if let Some(held) = self.reached.get(file) {
            return Ok(Rc::clone(held));
        }
        // Back at a file on the way to itself: what it hands out is still being read.
        if stack.contains(file) {
            return Ok(Rc::new(Names::default()));
        }
        stack.insert(file.to_owned());
        let mut found = Names::default();
        let Some(source) = self.source(file) else {
            stack.remove(file);
            let found = Rc::new(found);
            self.reached.insert(file.to_owned(), Rc::clone(&found));
            return Ok(found);
        };
        let requests: Vec<RequestRow<'a>> = source.requests().collect();

        for export in source.exports() {
            let specifier = export.from;
            let resolved = match specifier {
                Some(specifier) => self.target_of(&source, specifier),
                None => None,
            };
            let target = resolved.filter(|resolved| self.holds(resolved));
            let written = |kind: &str, declared: &str| ReachedDeclaration {
                kind: kind.to_owned(),
                at: file.to_owned(),
                line: export.line,
                signature: export.signature.and_then(crate::text_cut::head),
                doc: export.doc.and_then(crate::text_cut::doc),
                declared: declared.to_owned(),
            };
            let held_whole = export.imported == Some("*");
            let written_kind = if held_whole { "namespace-object" } else { "foreign" };

            let Some(name) = export.exported else {
                match target {
                    None => {
                        let star = format!("* from '{}'", specifier.unwrap_or("undefined"));
                        found.add(&star, written(written_kind, &star));
                    }
                    Some(target) => {
                        let names = self.names_at(&target, stack)?;
                        for published in &names.order {
                            for kind in &published.kinds {
                                found.add(&published.name, kind.clone());
                            }
                        }
                    }
                }
                continue;
            };

            if held_whole {
                found.add(name, written(written_kind, name));
            } else if specifier.is_none() {
                // A name this file declares is answered by that declaration and
                // is not followed further: `export const logger = OriginalLogger`
                // is a `const` here even when `OriginalLogger` is imported, as
                // TypeScript's declaration emit publishes it. Only a name bound
                // here and declared nowhere here goes to its import.
                let bound = export.local.unwrap_or(name);
                if let Some(symbol) = source.declares(bound, Some(export.line)) {
                    let declaration = source.declaration(file, symbol);
                    found.add(name, ReachedDeclaration {
                        kind: declaration.kind,
                        at: declaration.at,
                        line: declaration.line,
                        signature: declaration.signature,
                        doc: declaration.doc,
                        declared: name.to_owned(),
                    });
                    continue;
                }
                let Some((imported, target)) = requests
                    .iter()
                    .find_map(|request| request.bindings.iter().find(|(_, local)| *local == bound).map(|&(imported, _)| (imported, request.target)))
                else {
                    return Err(format!("{file} exports `{name}`, and no declaration there says what it is"));
                };
                let Some(target) = self.typed(target) else {
                    found.add(name, written(written_kind, name));
                    continue;
                };
                if imported == "*" {
                    found.add(name, written("namespace-object", name));
                } else if !self.holds(&target) {
                    found.add(name, written(written_kind, name));
                } else {
                    let names = self.names_at(&target, stack)?;
                    let Some(kinds) = names.get(imported) else {
                        return Err(format!("{file} exports imported `{name}`, and its source does not publish it"));
                    };
                    for kind in kinds {
                        found.add(name, kind.clone());
                    }
                }
            } else if let Some(target) = target {
                let specifier = specifier.unwrap_or_default();
                let linked = requests
                    .iter()
                    .find(|request| request.value == specifier && request.kind == "imports")
                    .and_then(|request| request.bindings.iter().find(|(_, local)| Some(*local) == export.imported))
                    .map(|&(imported, _)| imported);
                let names = self.names_at(&target, stack)?;
                let Some(kinds) = names.get(linked.or(export.imported).unwrap_or("default")) else {
                    return Err(format!("{file} re-exports `{name}` from `{specifier}`, which does not publish it"));
                };
                for kind in kinds {
                    found.add(name, kind.clone());
                }
            } else {
                found.add(name, written(written_kind, name));
            }
        }

        stack.remove(file);
        let found = Rc::new(found);
        self.reached.insert(file.to_owned(), Rc::clone(&found));
        Ok(found)
    }
}

#[cfg(test)]
#[path = "help_names_tests.rs"]
mod tests;
