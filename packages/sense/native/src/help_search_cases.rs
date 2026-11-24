//! Recorded case names searched by the words that their runner gave them.

// compass: variance-authority.report.agent-surface

use std::collections::{BTreeMap, HashSet};
use std::path::Path;

use crate::dependency_lexicon::purposes::{phrase_run, stem, writes_run};
use crate::help_search::name_terms;
use crate::order::code_unit;
use crate::record_case_names::case_names;

pub(crate) struct Cases {
    pub shown: Vec<(String, String)>,
    pub total: usize,
    unread: Vec<Option<String>>,
}

impl Cases {
    pub(crate) fn unread_lines(&self) -> impl Iterator<Item = String> + '_ {
        let names = self.unread.iter().filter_map(|name| name.as_ref()).map(|name| format!("`{name}`")).collect::<Vec<_>>();
        self.unread.iter().any(Option::is_none).then(|| "No recorded case was read: no run kept its cases there.".to_owned()).into_iter()
            .chain((!names.is_empty()).then(|| format!("No recorded case of {} was read: no run kept its cases there.", names.join(", "))))
    }
}

pub(crate) fn cases(root: &str, directory: &Path, query: &str, words: &BTreeMap<String, String>, scope: Option<&[String]>, cap: usize) -> Option<Cases> {
    if directory.parent()?.file_name().is_some_and(|name| name == ".work") { return None }
    let config = match std::fs::read(Path::new(root).join("variance.config.json")) {
        Ok(bytes) => Some(serde_json::from_slice::<serde_json::Value>(&bytes).ok()?),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(_) => return None,
    };
    let suites = config.as_ref().and_then(|config| config.get("suites"));
    let mut selected = Vec::new();
    if let Some(suites) = suites {
        let suites = suites.as_object()?;
        if suites.is_empty() { return None }
        for (name, suite) in suites {
            if !name.bytes().next()?.is_ascii_alphanumeric() || !name.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte)) {
                return None;
            }
            let record = directory.join("suites").join(name).join("coverage.bin");
            if suite.get("carry").and_then(serde_json::Value::as_str) == Some("share") && !record.exists() { return None }
            selected.push((Some(name.to_owned()), record));
        }
    } else {
        selected.push((None, directory.join("coverage.bin")));
    }
    let mut all = HashSet::new();
    let mut unread = Vec::new();
    let files = scope.map(|scope| scope.iter().map(String::as_str).collect::<HashSet<_>>());
    for (suite, path) in selected {
        match case_names(&path).ok()? {
            Some(names) => all.extend(names.into_iter().filter(|(file, _)| files.as_ref().is_none_or(|files| files.contains(file.as_str())))),
            None => unread.push(suite),
        }
    }
    if words.is_empty() { return Some(Cases { shown: Vec::new(), total: 0, unread }) }
    let wanted: Vec<_> = words.iter().collect();
    let phrase = phrase_run(query);
    let mut matched = Vec::new();
    for (file, name) in all {
        let terms = name_terms(&name);
        if !wanted.iter().all(|(root, word)| terms.iter().any(|term| {
            term.starts_with(word.as_str()) || (term.starts_with(root.as_str()) && stem(term) == **root)
        })) { continue }
        let apart = phrase.as_ref().is_none_or(|phrase| writes_run(phrase, &name).is_none());
        matched.push((apart, file, name));
    }
    let total = matched.len();
    matched.sort_unstable_by(|a, b| a.0.cmp(&b.0).then_with(|| code_unit(&a.1, &b.1)).then_with(|| code_unit(&a.2, &b.2)));
    let shown = matched.into_iter().take(cap).map(|(_, file, name)| (file, name)).collect();
    Some(Cases { shown, total, unread })
}
