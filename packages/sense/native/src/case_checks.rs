//! The checks a case declares, read from its test file and not from the run:
//! the `checked(id, fn)` calls its body holds, and those a function of the same
//! file holds that the body calls, declared at the line the body calls it.
//!
//! The declaration is what a passing attempt is judged against: a check it
//! declares and did not enter is missing. Only what the source spells is
//! declared — a literal id, a callback written in place, a helper the file
//! names — so a check built at run time is never named, rather than named by
//! a guess. A case's body is the one the journeys walk finds in the test file
//! (`journeys_roots::test_roots`), and a helper is the function the journeys
//! resolve the body's call to (`journeys_graph::local_target`).
// TODO: a case registered by a shared suite in another file declares nothing,
// where the journeys walk falls back to the suite's file for its body.

// compass: variance-authority.reach.relations

use std::collections::{HashMap, HashSet};
use std::path::Path;

use napi_derive::napi;
use rayon::prelude::*;

use crate::journeys_graph::local_target;
use crate::journeys_parse::{self, Callee, Parsed};
use crate::journeys_roots::test_roots;

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
    let body = test_roots(parsed, name, None)?.body;
    // What `checked` is called by in this file: its local name, or a namespace of the entry.
    let (mut named, mut spaces) = (HashSet::new(), HashSet::new());
    for (local, import) in parsed.imports.iter().filter(|(_, import)| import.spec == ENTRY) {
        match import.name.as_str() {
            "checked" => named.insert(local.as_str()),
            "*" => spaces.insert(local.as_str()),
            _ => false,
        };
    }
    if named.is_empty() && spaces.is_empty() {
        return None;
    }
    let calls_checked = |callee: &Callee| match (&callee.id, &callee.ns, &callee.prop) {
        (Some(id), None, _) => named.contains(id.as_str()),
        (None, Some(ns), Some(prop)) => prop == "checked" && spaces.contains(ns.as_str()),
        _ => false,
    };
    // A check is the function handed to `checked` as its second argument: its
    // site sorts two places before the call it is handed to.
    let callees: HashMap<u64, &Callee> =
        parsed.calls.iter().filter(|call| call.callback.is_none() && !call.by_ref).map(|call| (call.col, &call.callee)).collect();
    let handed: HashMap<u32, &Callee> = parsed
        .calls
        .iter()
        .filter_map(|call| Some((call.callback?, *callees.get(&(call.col + 2))?)))
        .collect();
    let is_check = |at: usize| {
        parsed.fns[at].hint.as_deref().is_some_and(|hint| hint.ends_with(".arg1"))
            && handed.get(&(at as u32)).is_some_and(|callee| calls_checked(callee))
    };
    let mut checks: Vec<(String, u32)> = Vec::new();
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
            if let Some(helper) = local_target(parsed, Some(from), callee).filter(|&helper| seen.insert(helper)) {
                scopes.push((helper, Some(at_line.unwrap_or(call.line))));
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
        assert_eq!(read(SOURCE, "form > publishes"), None);
        let unimported = SOURCE.replacen("@variance-authority/sense/checked", "./checked", 1);
        assert_eq!(read(&unimported, "form > sends"), None);
        let renamed = SOURCE.replacen("{ checked }", "{ checked as check }", 1).replace("  checked(", "  check(");
        assert_eq!(read(&renamed, "retries").map(|(_, checks)| checks.len()), Some(1));
    }

    #[test]
    fn finds_the_body_as_the_journeys_walk_does_by_its_path_then_its_title_and_reads_no_each_case() {
        let source = "import { checked } from '@variance-authority/sense/checked';
describe('draft', () => {
  it('sends', () => {
    checked('draft', () => 1);
  });
});
describe('final', () => {
  it('sends', () => {
    checked('final', () => 1);
  });
});
it.each([1, 2])('adds %s', (n) => {
  checked('sum', () => n);
});
it(name(), () => {});
";
        let ids = |name: &str| read(source, name).map(|(_, checks)| checks.into_iter().map(|(id, _)| id).collect::<Vec<_>>());
        assert_eq!(ids("final > sends"), Some(vec!["final".to_owned()]));
        assert_eq!(ids("final sends"), Some(vec!["final".to_owned()]));
        assert_eq!(ids("draft > sends"), Some(vec!["draft".to_owned()]));
        assert_eq!(ids("adds 2"), None);
        assert_eq!(ids("other"), None);
    }

    #[test]
    fn follows_a_helper_the_call_reaches_and_a_namespace_only_when_it_is_the_entry() {
        let source = "import * as v from '@variance-authority/sense/checked';
import * as other from './other';
describe('draft', () => {
  function verify() {
    v.checked('draft', () => 1);
  }
  it('sends', () => {
    verify();
    other.checked('not a check', () => 2);
  });
});
describe('final', () => {
  function verify() {
    v.checked('final', () => 1);
  }
  it('sends', () => {
    verify();
  });
});
";
        let ids = |name: &str| read(source, name).map(|(_, checks)| checks.into_iter().map(|(id, _)| id).collect::<Vec<_>>());
        assert_eq!(ids("draft > sends"), Some(vec!["draft".to_owned()]));
        assert_eq!(ids("final > sends"), Some(vec!["final".to_owned()]));
    }
}
