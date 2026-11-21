//! The checks a case declares, read from its test file before anything runs:
//! the `checked(id, fn)` calls its body holds, and those a function of the same
//! file holds that the body calls, declared at the line the body calls it.
//!
//! The declaration is what a passing attempt is judged against: a check it
//! declares and did not enter is missing. Only what the source spells is
//! declared — a literal id, a callback written in place, a helper the file
//! names — so a check built at run time is never named, rather than named by
//! a guess.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use napi_derive::napi;
use rayon::prelude::*;

use crate::journeys_parse::{self, Parsed};
use crate::journeys_roots::{body_hint, describe};

/// The entry `checked` ships from.
const ENTRY: &str = "@variance-authority/sense/checked";

/// A case, by the file it is declared in and the name its runner gave it.
#[napi(object)]
pub struct CheckedCaseAsk {
    /// The test file, from the checkout's root.
    pub file: String,
    pub name: String,
}

#[napi(object)]
pub struct DeclaredCheck {
    pub id: String,
    /// The line of its `checked` call, or of the body's call of the helper that holds it.
    pub line: u32,
}

/// A case's body and the checks it declares.
#[napi(object)]
pub struct DeclaredChecks {
    /// The line of the call that registers its body.
    pub line: u32,
    pub checks: Vec<DeclaredCheck>,
}

/// The checks each case declares, in the order asked; `None` for a case that
/// declares none the source spells: its file cannot be read or does not name
/// the entry, or its body is not found by its name or holds no check. Each
/// distinct file is read once, the files on every core, and parsed only when
/// its text names the entry.
#[napi(catch_unwind)]
pub fn declared_checks(root: String, cases: Vec<CheckedCaseAsk>) -> Vec<Option<DeclaredChecks>> {
    let files: HashSet<&str> = cases.iter().map(|case| case.file.as_str()).collect();
    let parsed: HashMap<&str, Parsed> = files
        .into_par_iter()
        .filter_map(|file| {
            let text = std::fs::read_to_string(Path::new(&root).join(file)).ok()?;
            // Most test files call no check: their text is not parsed for one.
            if !text.contains(ENTRY) {
                return None;
            }
            Some((file, journeys_parse::parse(file, &text)?))
        })
        .collect();
    cases
        .iter()
        .map(|case| {
            let (line, checks) = declared(parsed.get(case.file.as_str())?, &case.name)?;
            Some(DeclaredChecks { line, checks: checks.into_iter().map(|(id, line)| DeclaredCheck { id, line }).collect() })
        })
        .collect()
}

/// The line of `name`'s body and the checks it declares, each with its line;
/// `None` when no body is registered under `name` or it declares no check.
fn declared(parsed: &Parsed, name: &str) -> Option<(u32, Vec<(String, u32)>)> {
    let sites: HashMap<u32, u32> = parsed.calls.iter().filter_map(|call| call.callback.map(|at| (at, call.line))).collect();
    let site = |at: u32| sites.get(&at).copied().unwrap_or(parsed.fns[at as usize].line);
    let body = body_of(parsed, name)?;
    // What `checked` is called by in this file: its local name, or `checked` on a namespace.
    let callees: HashSet<&str> = parsed
        .imports
        .iter()
        .filter(|(_, import)| import.spec == ENTRY)
        .filter_map(|(local, import)| match import.name.as_str() {
            "checked" => Some(local.as_str()),
            "*" => Some("checked"),
            _ => None,
        })
        .collect();
    if callees.is_empty() {
        return None;
    }
    let mut checks: Vec<(String, u32)> = Vec::new();
    let is_check = |at: usize| {
        parsed.fns[at].hint.as_deref().and_then(|hint| hint.split_once(".arg")).is_some_and(|(callee, arg)| arg == "1" && callees.contains(callee))
    };
    let mut seen = HashSet::from([body]);
    // Each scope searched, with the line its checks are declared at: none for
    // the body, the line it calls the helper at for a helper.
    let mut scopes: Vec<(u32, Option<u32>)> = vec![(body, None)];
    while let Some((scope, at_line)) = scopes.pop() {
        for at in 0..parsed.fns.len() {
            if !is_check(at) || !within(parsed, at as u32, scope) {
                continue;
            }
            let Some(id) = parsed.fns[at].title.as_deref().filter(|id| !id.contains('*')) else { continue };
            if !checks.iter().any(|(known, _)| known == id) {
                checks.push((id.to_owned(), at_line.unwrap_or_else(|| site(at as u32))));
            }
        }
        for call in &parsed.calls {
            let (Some(from), None, Some(callee)) = (call.from, &call.callee.ns, &call.callee.id) else { continue };
            if call.by_ref || call.callback.is_some() || !within(parsed, from, scope) {
                continue;
            }
            for &helper in parsed.locals.get(callee).into_iter().flatten() {
                if seen.insert(helper) {
                    scopes.push((helper, Some(at_line.unwrap_or(call.line))));
                }
            }
        }
    }
    checks.sort_by_key(|(_, line)| *line);
    (!checks.is_empty()).then(|| (site(body), checks))
}

/// Whether function `at` is `scope` or written inside it.
fn within(parsed: &Parsed, at: u32, scope: u32) -> bool {
    let mut current = Some(at);
    while let Some(here) = current {
        if here == scope {
            return true;
        }
        current = parsed.fns[here as usize].parent;
    }
    false
}

/// The body registered under `name`: its describes' titles and its own,
/// joined as a runner joins them — ` > `, or Jest's space.
fn body_of(parsed: &Parsed, name: &str) -> Option<u32> {
    (0..parsed.fns.len() as u32).find(|&at| {
        let func = &parsed.fns[at as usize];
        let Some(own) = func.title.as_deref().filter(|_| body_hint(func.hint.as_deref())) else { return false };
        let mut path = vec![own];
        let mut scope = func.parent;
        while let Some(s) = scope {
            let outer = &parsed.fns[s as usize];
            if let Some(title) = outer.title.as_deref().filter(|_| describe(outer.hint.as_deref())) {
                path.push(title);
            }
            scope = outer.parent;
        }
        path.reverse();
        path.join(" > ") == name || path.join(" ") == name
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(source: &str, name: &str) -> Option<(u32, Vec<(String, u32)>)> {
        declared(&journeys_parse::parse("a.test.ts", source).unwrap(), name)
    }

    const SOURCE: &str = "import { checked } from '@variance-authority/sense/checked';
function verify(sent) {
  checked('helper', () => sent);
}
describe('form', () => {
  it('sends', () => {
    if (draft) return;
    checked('title', () => 1);
    checked(
      'body',
      () => 2,
    );
    checked(`built ${n}`, () => 3);
    verify(sent);
  });
  it('drafts', () => {});
});
it('retries', { retry: 1 }, () => {
  checked('again', () => 1);
});
";

    #[test]
    fn declares_the_checks_a_body_holds_and_a_helper_it_calls_at_their_lines() {
        let checks = |list: &[(&str, u32)]| list.iter().map(|(id, line)| ((*id).to_owned(), *line)).collect::<Vec<_>>();
        assert_eq!(read(SOURCE, "form > sends"), Some((6, checks(&[("title", 8), ("body", 9), ("helper", 14)]))));
        assert_eq!(read(SOURCE, "form sends"), read(SOURCE, "form > sends"));
        assert_eq!(read(SOURCE, "form > drafts"), None);
        assert_eq!(read(SOURCE, "retries"), Some((18, checks(&[("again", 19)]))));
    }

    #[test]
    fn declares_nothing_for_a_name_no_body_spells_nor_a_check_the_file_does_not_import() {
        assert_eq!(read(SOURCE, "sends"), None);
        assert_eq!(read(SOURCE, "other > sends"), None);
        let unimported = SOURCE.replacen("@variance-authority/sense/checked", "./checked", 1);
        assert_eq!(read(&unimported, "form > sends"), None);
        let renamed = SOURCE.replacen("{ checked }", "{ checked as check }", 1).replace("  checked(", "  check(");
        assert_eq!(read(&renamed, "retries").map(|(_, checks)| checks.len()), Some(1));
    }
}
