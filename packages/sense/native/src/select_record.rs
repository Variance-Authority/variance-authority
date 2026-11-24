//! Selection from the coverage snapshot written by a suite.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::cli::{cache::Layers, follow_ups, root_config};
use crate::emitted::{Emitted, Origin};
use crate::journey_columns::FileFrame;
use crate::read_any::{language_of, Language};
use crate::record_coverage::{self, Coverage, Text};
use crate::source_query::RuntimeTree;

use super::{patch, source, Read, Reading, Unread};

#[path = "select_record_regions.rs"]
mod regions;
#[path = "select_record_render.rs"]
mod render;

pub(super) struct Request<'a> {
    pub(super) suite: Option<&'a str>,
    pub(super) diff: Option<&'a str>,
    pub(super) execution: Option<&'a str>,
    pub(super) format: Option<&'a str>,
    pub(super) no_git: bool,
}

struct Snapshot {
    layers: Layers,
    file: PathBuf,
    suite: Option<String>,
    tsconfig: crate::resolve::Tsconfig,
    before: Vec<String>,
    file_use: bool,
}

fn snapshot(root: &Path, requested: Option<&str>) -> Option<Snapshot> {
    let layers = Layers::at(root)?;
    let config = root_config(root)?;
    let tsconfig = crate::cli::source::tsconfig(root, config.as_ref())?;
    let config = config.as_ref();
    if config.is_some_and(|value| value.pointer("/share/sourceIndex") == Some(&Value::Bool(true))) {
        return None;
    }
    let mut before = listed(config.and_then(|config| config.get("before")))?;
    let mut file_use = false;
    let (suite, inside) = match config.and_then(|value| value.get("suites")) {
        None if requested.is_none() => (None, PathBuf::from("coverage.bin")),
        None => return None,
        Some(suites) => {
            let suites = suites.as_object()?;
            if !suites.iter().all(|(name, value)| valid_suite(name, value).is_some()) {
                return None;
            }
            let name = requested
                .or_else(|| (suites.len() == 1).then(|| suites.keys().next().map(String::as_str)).flatten())?;
            let suite = suites.get(name)?;
            if suite.get("ignore").is_some()
                || suite.get("carry").is_some_and(|carry| carry.as_str() != Some("actions-cache"))
            {
                return None;
            }
            match suite.get("precision").and_then(Value::as_str) {
                None | Some("region-use") => {}
                Some("file-use") => file_use = true,
                _ => return None,
            }
            before.extend(listed(suite.get("before"))?);
            (Some(name.to_owned()), Path::new("suites").join(name).join("coverage.bin"))
        }
    };
    let own = layers.top.join(&inside);
    let base = layers.base.join(inside);
    let file = if own.try_exists().ok()? || own == base || !base.try_exists().ok()? { own } else { base };
    if before.iter().any(|file| Path::new(file).is_absolute()) {
        return None;
    }
    Some(Snapshot { layers, file, suite, tsconfig, before, file_use })
}

fn listed(value: Option<&Value>) -> Option<Vec<String>> {
    let Some(value) = value else { return Some(Vec::new()) };
    let entries = value.as_array()?;
    (!entries.is_empty()).then_some(())?;
    entries.iter().map(|entry| entry.as_str().filter(|path| !path.is_empty()).map(str::to_owned)).collect()
}

fn valid_suite(name: &str, suite: &Value) -> Option<()> {
    let suite = suite.as_object()?;
    if !name.bytes().next()?.is_ascii_alphanumeric()
        || !name.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
        || !matches!(suite.get("kind")?.as_str()?, "unit" | "integration" | "e2e" | "visual" | "job")
        || suite
            .keys()
            .any(|key| !matches!(key.as_str(), "kind" | "carry" | "relations" | "precision" | "before" | "ignore"))
        || suite.get("carry").is_some_and(|carry| !matches!(carry.as_str(), Some("actions-cache" | "share")))
        || suite.get("relations").is_some_and(|relations| !relations.is_boolean())
    {
        return None;
    }
    if let Some(precision) = suite.get("precision") {
        match precision.as_str()? {
            "file" | "symbol" if suite.get("relations") != Some(&Value::Bool(false)) => {}
            "file-use" | "function-use" | "region-use" => {}
            _ => return None,
        }
    }
    listed(suite.get("before"))?;
    listed(suite.get("ignore"))?;
    Some(())
}

pub(super) fn answer(root: &Path, request: Request<'_>, waiting: &mut impl FnMut(&str)) -> Option<(String, String)> {
    if !root.join(".git").exists() && root.ancestors().skip(1).any(|dir| dir.join(".git").exists()) {
        return None;
    }
    let Snapshot { layers, file, suite, tsconfig, before, file_use } = snapshot(root, request.suite)?;
    let file = match request.execution {
        Some(path) => crate::conditions::normalize(&root.join(path)),
        None => file,
    };
    follow_ups::source_readied(&layers.top.join("source-index.bin"), waiting)?;
    let root_text = root.to_str()?;
    let at = file.to_str()?;
    let Some(mut opened) = FileFrame::open(&file).ok()? else {
        return request.execution.is_none().then(|| render::unmeasured(at, request.format, false)).flatten();
    };
    let Some(coverage) = record_coverage::from_file(&mut opened).ok()? else {
        return (!opened.columns.is_empty()).then(|| render::unmeasured(at, request.format, true)).flatten();
    };
    let dictionary = coverage.text().ok()?;
    let recipe = dictionary.at(coverage.instrumentation);
    use variance_sense_instrument::Mode;
    if recipe != Mode::Presence.instrumentation() && recipe != Mode::Entries.instrumentation() {
        return None;
    }
    let commit = coverage.commit.map(|id| dictionary.at(id))?;
    if !matches!(commit.len(), 40 | 64)
        || !commit.bytes().all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return None;
    }
    if !root.join(".git").exists() {
        return None;
    }
    let handed = request.diff.is_some();
    let mut notes = standing(&file, commit, &coverage, &dictionary, handed)?;
    let patch = match request.diff {
        Some(path) => fs::read_to_string(root.join(path)).ok()?,
        None => source::recorded_diff(root, commit)?,
    };
    let files = patch::changes(&patch)?;
    // Git's checkout diff is already in code-unit order for ASCII paths. Do
    // not reorder a handed patch, whose order is part of its reading.
    let paths: HashSet<_> = files.iter().map(|file| file.change.file.as_str()).collect();
    if paths.iter().any(|file| {
        matches!(
            file.rsplit('/').next(),
            Some("package.json" | "pnpm-lock.yaml" | "yarn.lock" | "package-lock.json" | "npm-shrinkwrap.json")
        )
    }) {
        return None;
    }
    let tree = if !files.is_empty() || !before.is_empty() {
        Some(source::refresh(root, request.no_git, tsconfig)?)
    } else {
        None
    };
    if let Some((reason, rests)) = resting(root, tree.as_ref(), &before, suite.as_deref(), &paths, &mut notes) {
        return render::before(at, commit, request.format, &reason, &rests, &notes);
    }
    if paths.iter().any(|file| language_of(file) != Some(Language::Module)) {
        return None;
    }
    let mut rows = HashMap::<&str, Vec<usize>>::new();
    let emitted = Emitted::default();
    let kept = Kept::read(&layers)?;
    for (row, &id) in coverage.module_path.iter().enumerate() {
        if coverage.module_instrumented[row] != 1 {
            continue;
        }
        let name = dictionary.at(id);
        if paths.contains(name) {
            rows.entry(name).or_default().push(row);
        }
        if !paths.is_empty()
            && matches!(emitted.origin(&root.join(name)), Origin::Source(source) if source.strip_prefix(root).ok().and_then(|path| path.to_str()).is_some_and(|file| paths.contains(file)))
        {
            return None;
        }
        let digest = dictionary.at(coverage.module_source[row]);
        if kept.has(digest) && (!handed || paths.contains(name)) {
            return None;
        }
    }
    if rows.len() != paths.len() {
        return None;
    }

    let mut state = regions::Selection::new(&coverage, &dictionary);
    let mut readings = Vec::new();
    let mut stale = Vec::new();
    if let Some(tree) = &tree {
        if !tree.declared_readers(paths.iter().copied()).is_empty() {
            return None;
        }
        if file_use {
            for file in &files {
                let name = &file.change.file;
                state.charge_whole(tree, name, &rows[name.as_str()])?;
                readings.push(Reading { file: name.clone(), reading: Read::Unread { unread: Unread::Answered } });
            }
            readings.sort_by(|a, b| crate::order::code_unit(&a.file, &b.file));
            state.preconditions(&paths);
            return render::answer(at, commit, request.format, notes, state, readings, stale);
        }
        let asked: Vec<_> = files.iter().map(|file| file.change.file.clone()).collect();
        let recorded = crate::commit_text::read(root_text, &[commit.to_owned()], &[asked]).ok()?;
        if !recorded.refused.is_empty() {
            return None;
        }
        let texts: HashMap<_, _> = recorded.file.into_iter().zip(recorded.text).collect();
        for file in &files {
            let name = file.change.file.as_str();
            let proof = texts.get(name).filter(|before| {
                let digest = crate::digest::of_string(before);
                rows[name].iter().all(|&row| dictionary.at(coverage.module_source[row]) == digest)
            });
            if let Some(before) = proof {
                let read = read(file, before)?;
                state.charge(tree, file, &rows[name], &read)?;
                readings.push(Reading { file: file.change.file.clone(), reading: read });
            } else {
                state.charge_whole(tree, name, &rows[name])?;
                stale.push(file.change.file.clone());
            }
        }
        state.preconditions(&paths);
    }
    stale.sort_unstable_by(|left, right| crate::order::code_unit(left, right));
    render::answer(at, commit, request.format, notes, state, readings, stale)
}

fn resting(
    root: &Path,
    tree: Option<&RuntimeTree>,
    before: &[String],
    suite: Option<&str>,
    paths: &HashSet<&str>,
    notes: &mut Vec<String>,
) -> Option<(String, Vec<String>)> {
    if before.is_empty() {
        let whose = suite.map_or_else(|| "this repository".to_owned(), |suite| format!("the suite {suite}"));
        notes.push(format!(concat!(
            "{} declares nothing before reach, so a change to its runner config or the setup it loads ",
            "is read like any other file; name them in `before` in variance.config.json to run the whole suite when they change"
        ), whose));
        return None;
    }
    let tree = tree.expect("declared entries use the runtime graph");
    let mut moved = HashSet::new();
    let mut entries = Vec::new();
    let mut missing = Vec::new();
    for entry in before {
        let (known, reached) = tree.before_reaches(entry, paths);
        if !known && !root.join(entry).exists() {
            missing.push(entry.as_str());
        }
        if !reached.is_empty() {
            entries.push(format!("`{entry}`"));
            moved.extend(reached.into_iter().map(str::to_owned));
        }
    }
    if !missing.is_empty() {
        let (noun, each) = if missing.len() == 1 { ("path", "it covers") } else { ("paths", "each covers") };
        notes.push(format!(
            "`before` names {} {noun} not in this checkout ({}), so {each} only a change that adds it back",
            missing.len(),
            prose_list(&missing)
        ));
    }
    if moved.is_empty() {
        return None;
    }
    let mut moved: Vec<_> = moved.into_iter().collect();
    moved.sort_unstable_by(|left, right| crate::order::code_unit(left, right));
    let rests: Vec<_> = moved.iter().map(String::as_str).collect();
    let entries: Vec<_> = entries.iter().map(String::as_str).collect();
    let whose = suite.map_or_else(|| "every suite here".to_owned(), |suite| format!("the suite {suite}"));
    let owner = if suite.is_none() { "the" } else { "its" };
    let noun = if entries.len() == 1 { "entry" } else { "entries" };
    let it = if moved.len() == 1 { "it" } else { "them" };
    let why = format!("{whose} rests on {} before any test imports {it}, through {owner} `before` {noun} {}, and this diff moves {it}", prose_list(&rests), prose_list(&entries));
    Some((why, moved))
}

fn prose_list(held: &[&str]) -> String {
    match held {
        [] => String::new(),
        [one] => (*one).to_owned(),
        [first, rest @ .., last] if held.len() <= 3 => {
            let before = std::iter::once(*first).chain(rest.iter().copied()).collect::<Vec<_>>().join(", ");
            format!("{before} and {last}")
        }
        _ => format!("{} and {} more", held[..3].join(", "), held.len() - 3),
    }
}

fn read(file: &patch::File<'_>, before: &str) -> Option<Read> {
    let Some(after) = file.applied(before) else { return Some(Read::Unread { unread: Unread::Hunk }) };
    let Some(verdict) = crate::module_verdict::classified(&file.change.file, before, &after) else {
        return Some(Read::Unread { unread: Unread::Parse });
    };
    if verdict.kind == "values" || !verdict.imported.is_empty() {
        return None;
    }
    Some(Read::Compared { verdict: verdict.kind, names: verdict.names })
}

fn standing(file: &Path, commit: &str, coverage: &Coverage, text: &Text<'_>, handed: bool) -> Option<Vec<String>> {
    let bytes = match fs::read(file.with_extension("runs.json")) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Some(if handed || coverage.tests() == 0 {
                Vec::new()
            } else {
                vec![format!(
                    "no runs record lies beside the snapshot, so every test is read as though it last ran at {}",
                    &commit[..12]
                )]
            });
        }
        Err(_) => return None,
        Ok(bytes) => bytes,
    };
    let runs: Value = serde_json::from_slice(&bytes).ok()?;
    if runs.get("commit")?.as_str()? != commit {
        return None;
    }
    let no_retained_text = no_retained;
    if !no_retained_text(&runs, "installed") {
        return None;
    }
    let mut files = HashSet::new();
    if let Some(standing) = runs.get("standing") {
        for entry in standing.as_array()? {
            if entry.get("commit")?.as_str()? != commit
                || entry.get("assumed").is_some_and(|value| value != false)
                || !no_retained_text(entry, "installed")
                || !no_retained_text(entry, "texts")
                || entry.get("partly").is_some()
            {
                return None;
            }
            for file in entry.get("files")?.as_array()? {
                files.insert(file.as_str()?);
            }
        }
    }
    if let Some(landings) = runs.get("landings") {
        let mut landed_files = HashSet::new();
        for landed in landings.as_array()? {
            if !no_retained_text(landed, "installed")
                || !no_retained_text(landed, "texts")
                || landed.get("partly").is_some()
            {
                return None;
            }
            for file in landed.get("files")?.as_array()? {
                landed_files.insert(file.as_str()?);
            }
        }
        // An older writer can leave the list of landings beside a different
        // flat list. That list then owns the runs and their install.
        if let Some(legacy) = runs.get("files") {
            if parse_files(legacy)? != landed_files {
                return None;
            }
        }
        files.extend(landed_files);
    } else {
        files.extend(parse_files(runs.get("files")?)?);
    }
    coverage.test_path.iter().all(|id| files.contains(text.at(*id))).then(Vec::new)
}

/// Whether `value` names no install or texts under `field`: a run that kept
/// either ran against something other than its commit's own, so the record
/// cannot be read as a clean stand and the Node selector reads it instead.
fn no_retained(value: &Value, field: &str) -> bool {
    value.get(field).is_none_or(|named| named.as_object().is_some_and(|object| object.is_empty()))
}

fn parse_files(value: &Value) -> Option<HashSet<&str>> {
    value.as_array()?.iter().map(Value::as_str).collect()
}

struct Kept(HashSet<String>);

impl Kept {
    fn read(layers: &Layers) -> Option<Self> {
        let mut found = HashSet::new();
        for layer in std::iter::once(&layers.top).chain((layers.base != layers.top).then_some(&layers.base)) {
            let names = match fs::read_dir(layer.join(".texts")) {
                Ok(names) => names,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(_) => return None,
            };
            for entry in names {
                found.insert(entry.ok()?.file_name().into_string().ok()?);
            }
        }
        Some(Self(found))
    }

    fn has(&self, digest: &str) -> bool {
        digest.strip_prefix("v1:").is_some_and(|hex| self.0.contains(hex))
    }
}

#[cfg(test)]
mod tests {
    use super::no_retained;
    use serde_json::json;

    #[test]
    fn a_standing_entry_that_kept_texts_or_an_install_is_not_clean() {
        assert!(no_retained(&json!({"files": []}), "texts"));
        assert!(no_retained(&json!({"texts": {}}), "texts"));
        assert!(!no_retained(&json!({"texts": {"a.ts": "abc"}}), "texts"));
        assert!(!no_retained(&json!({"installed": {"lock": "x"}}), "installed"));
    }
}
