//! Where a case starts: the functions of its test file (or of a shared suite
//! it imports) that the runner calls for it.
//!
//! `body`: its `it` in the test file. `helper`: a shared suite registered it
//! from another file, found through the test file's imports. `file`: a
//! data-driven suite has no body per case, so the test file's own top level and
//! the describes on the case's path are the start.

// compass: variance-authority.reach.relations

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use crate::journeys_graph::Graph;
use crate::journeys_parse::{Export, Parsed};

/// The top level of a file, as a function index.
pub(crate) const TOP: u32 = u32::MAX - 1;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Start {
    Body,
    Helper,
    File,
}

impl Start {
    pub(crate) fn name(self) -> &'static str {
        match self {
            Start::Body => "body",
            Start::Helper => "helper",
            Start::File => "file",
        }
    }
}

pub(crate) struct Roots {
    pub start: Start,
    /// Describe bodies, outermost first, then hooks, then the body: the order
    /// they are explored in.
    pub scopes: Vec<(u32, u32)>,
    pub hooks: Vec<(u32, u32)>,
    pub body: Option<(u32, u32)>,
}

fn hint_is(hint: Option<&str>, callees: &[&str], args: &[u8]) -> bool {
    let Some((callee, arg)) = hint.and_then(|hint| hint.split_once(".arg")) else { return false };
    callees.contains(&callee) && arg.len() == 1 && args.contains(&arg.as_bytes()[0])
}

pub(crate) fn body_hint(hint: Option<&str>) -> bool {
    hint_is(hint, &["it", "test", "each", "only", "skip", "concurrent"], b"12")
}

/// A function the runner registers rather than calls in place.
pub(crate) fn registered(hint: Option<&str>) -> bool {
    hint_is(
        hint,
        &["it", "test", "describe", "each", "only", "skip", "concurrent", "todo", "beforeEach", "beforeAll", "afterEach", "afterAll"],
        b"0123456789",
    )
}

fn describe(hint: Option<&str>) -> bool {
    hint == Some("describe.arg1")
}

fn hook(hint: Option<&str>) -> bool {
    matches!(hint, Some("beforeEach.arg0" | "beforeAll.arg0"))
}

/// A `%s`-style placeholder.
fn placeholder(title: &str) -> bool {
    title.as_bytes().windows(2).any(|pair| pair[0] == b'%' && b"sdiojp#".contains(&pair[1]))
}

/// A `%s`-style placeholder, or a `$` one.
fn formatted(title: &str) -> bool {
    title.contains('$') || placeholder(title)
}

/// A title whose template holes are `*` matches a case name.
fn glob(pattern: &str, text: &str) -> bool {
    let mut parts = pattern.split('*');
    let first = parts.next().unwrap_or("");
    let Some(mut rest) = text.strip_prefix(first) else { return false };
    let parts: Vec<&str> = parts.collect();
    let Some((last, middle)) = parts.split_last() else { return rest.is_empty() };
    for part in middle {
        match rest.find(part) {
            Some(at) => rest = &rest[at + part.len()..],
            None => return false,
        }
    }
    rest.len() >= last.len() && rest.ends_with(last)
}

struct Found {
    body: u32,
    hooks: Vec<u32>,
    scopes: Vec<u32>,
}

fn test_roots(parsed: &Parsed, name: &str, path: Option<&[&str]>) -> Option<Found> {
    let title = name.rsplit(" > ").next().unwrap_or(name);
    let matches = |own: &str| own == title || (own.contains('*') && glob(own, title)) || formatted(own);
    let on_path = |at: u32, path: &[&str]| {
        let mut scope = parsed.fns[at as usize].parent;
        while let Some(s) = scope {
            let func = &parsed.fns[s as usize];
            if let Some(own) = func.title.as_deref().filter(|own| describe(func.hint.as_deref()) && !own.contains('*')) {
                if !path.contains(&own) {
                    return false;
                }
            }
            scope = func.parent;
        }
        true
    };
    let bodies: Vec<u32> = (0..parsed.fns.len() as u32)
        .filter(|&at| {
            let func = &parsed.fns[at as usize];
            let Some(own) = func.title.as_deref() else { return false };
            body_hint(func.hint.as_deref())
                && matches(own)
                && path.is_none_or(|path| !placeholder(own) && on_path(at, path))
        })
        .collect();
    let body = bodies.iter().copied().find(|&at| parsed.fns[at as usize].title.as_deref() == Some(title)).or(bodies.first().copied())?;
    let mut chain = Vec::new();
    let mut scope = parsed.fns[body as usize].parent;
    while let Some(s) = scope {
        chain.push(s);
        scope = parsed.fns[s as usize].parent;
    }
    let hooks = (0..parsed.fns.len() as u32)
        .filter(|&at| {
            let func = &parsed.fns[at as usize];
            hook(func.hint.as_deref()) && func.parent.is_none_or(|parent| chain.contains(&parent))
        })
        .collect();
    let scopes = chain.iter().rev().copied().filter(|&s| describe(parsed.fns[s as usize].hint.as_deref())).collect();
    Some(Found { body, hooks, scopes })
}

/// Files up to three imports or re-exports out of a test file that register
/// test bodies of their own: shared suites.
fn helper_files(graph: &Graph, file: u32) -> Vec<u32> {
    let mut out = Vec::new();
    let mut seen = HashSet::from([file]);
    let mut frontier = vec![file];
    for _ in 0..3 {
        let mut next = Vec::new();
        for &at in &frontier {
            let Some(parsed) = graph.parsed(at) else { continue };
            let mut specs: Vec<&str> = parsed.imports.values().map(|import| import.spec.as_str()).collect();
            specs.extend(parsed.star.iter().map(String::as_str));
            specs.extend(parsed.exports.values().filter_map(|export| match export {
                Export::From { spec, .. } => Some(spec.as_str()),
                Export::Local(_) => None,
            }));
            // The parse holds imports by name, so their order is the specifiers'.
            specs.sort_unstable();
            specs.dedup();
            for spec in specs {
                let Some(to) = graph.resolve(at, spec) else { continue };
                if !seen.insert(to) {
                    continue;
                }
                next.push(to);
                if graph.parsed(to).is_some_and(|parsed| parsed.fns.iter().any(|func| body_hint(func.hint.as_deref()))) {
                    out.push(to);
                }
            }
        }
        frontier = next;
    }
    out
}

/// Each test file's shared suites, found once.
#[derive(Default)]
pub(crate) struct Helpers(Mutex<HashMap<u32, std::sync::Arc<Vec<u32>>>>);

impl Helpers {
    fn of(&self, graph: &Graph, file: u32) -> std::sync::Arc<Vec<u32>> {
        if let Some(found) = self.0.lock().ok().and_then(|held| held.get(&file).cloned()) {
            return found;
        }
        let found = std::sync::Arc::new(helper_files(graph, file));
        if let Ok(mut held) = self.0.lock() {
            held.insert(file, found.clone());
        }
        found
    }
}

pub(crate) fn find_roots(graph: &Graph, helpers: &Helpers, file: u32, name: &str) -> Option<Roots> {
    let parsed = graph.parsed(file)?;
    let path: Vec<&str> = name.split(" > ").collect();
    let on_path = || -> Vec<(u32, u32)> {
        (0..parsed.fns.len() as u32)
            .filter(|&at| {
                let func = &parsed.fns[at as usize];
                describe(func.hint.as_deref()) && func.title.as_deref().is_some_and(|title| path.contains(&title))
            })
            .map(|at| (file, at))
            .collect()
    };
    let at = |in_file: u32, found: Found, start: Start, mut scopes: Vec<(u32, u32)>| {
        scopes.extend(found.scopes.iter().map(|&s| (in_file, s)));
        Roots { start, scopes, hooks: found.hooks.iter().map(|&h| (in_file, h)).collect(), body: Some((in_file, found.body)) }
    };
    if let Some(found) = test_roots(parsed, name, None) {
        return Some(at(file, found, Start::Body, Vec::new()));
    }
    for &helper in helpers.of(graph, file).iter() {
        let Some(shared) = graph.parsed(helper) else { continue };
        if let Some(found) = test_roots(shared, name, Some(&path)) {
            return Some(at(helper, found, Start::Helper, on_path()));
        }
    }
    let hooks =
        (0..parsed.fns.len() as u32).filter(|&at| hook(parsed.fns[at as usize].hint.as_deref()) && parsed.fns[at as usize].parent.is_none()).map(|at| (file, at)).collect();
    let mut scopes = vec![(file, TOP)];
    scopes.extend(on_path());
    Some(Roots { start: Start::File, scopes, hooks, body: None })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_template_title_matches_the_name_it_expands_to() {
        assert!(glob("adds * and *", "adds 1 and 2"));
        assert!(glob("*", "anything"));
        assert!(!glob("adds * and", "adds 1 or"));
        assert!(glob("a*a", "aa") && !glob("a*a", "a"));
        assert!(formatted("returns %s") && formatted("$a is $b") && !formatted("100% sure"));
    }

    #[test]
    fn a_case_starts_at_its_body_under_the_describes_and_hooks_around_it() {
        let parsed = crate::journeys_parse::parse(
            "a.test.ts",
            "beforeEach(() => {});\ndescribe('suite', () => {\n  beforeEach(() => {});\n  it('works', () => {});\n});\ndescribe('other', () => {\n  beforeEach(() => {});\n});\n",
        )
        .unwrap();
        let found = test_roots(&parsed, "suite > works", None).unwrap();
        assert_eq!(parsed.fns[found.body as usize].title.as_deref(), Some("works"));
        assert_eq!(found.scopes, [1]);
        assert_eq!(found.hooks, [0, 2]);
        assert!(test_roots(&parsed, "suite > missing", None).is_none());
    }
}
