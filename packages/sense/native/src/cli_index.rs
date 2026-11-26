//! Publish the source index and its derived artifacts in the standalone CLI.

// compass: variance-authority.reach.source-index

use std::fs::{self, File};
use std::io::{ErrorKind, Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Duration;

use crate::change_tree::{change_tree, disk_tree};
use crate::help_publish::{self, HelpPublish};
use crate::help_store::{graph_digest, read_head};
use crate::index_turn::{take_index_turn, IndexTurn};
use crate::journey_output::replace;
use crate::orient_map::{self, OrientMapPrepared};
use crate::resolve::Tsconfig;
use crate::source_query::SourceTree;
use crate::source_tree::Mocking;
use crate::source_update::Updated;

use super::cache::Layers;
use super::follow_ups::Reservation;
use super::manifests::{self, Manifests};
use super::source;

#[path = "cli_index_journeys.rs"]
pub(crate) mod journeys;

enum Mode {
    Wait,
    Detach,
    Worker,
}

fn ci() -> bool {
    std::env::var_os("CI").is_none_or(|value| value != "false")
        && [
            "CI",
            "BUILD_ID",
            "BUILD_NUMBER",
            "CI_APP_ID",
            "CI_BUILD_ID",
            "CI_BUILD_NUMBER",
            "CI_NAME",
            "CONTINUOUS_INTEGRATION",
            "RUN_ID",
            "GITHUB_ACTIONS",
            "TF_BUILD",
            "BITBUCKET_BUILD_NUMBER",
            "BUILDKITE",
        ]
        .into_iter()
        .any(|key| std::env::var_os(key).is_some_and(|value| !value.is_empty()))
}

pub(super) fn answer(
    args: &[&str],
    root: &Path,
    mut waiting: impl FnMut(&str),
    out: impl FnOnce(&str),
) -> Option<(i32, String)> {
    let is_worker = args.first() == Some(&"--native-follow-ups");
    let input = || -> Option<(Mode, bool)> {
        let (mut wait, mut no_git) = (false, false);
        let default = if is_worker {
            Mode::Worker
        } else if ci() {
            Mode::Wait
        } else {
            Mode::Detach
        };
        for &arg in &args[usize::from(is_worker)..] {
            match arg {
                "--wait" if !is_worker && !wait => wait = true,
                "--no-git" if !no_git => no_git = true,
                _ => return None,
            }
        }
        Some((if wait { Mode::Wait } else { default }, no_git))
    };
    let (mode, no_git) = input()?;
    if is_worker {
        // A launcher opens this pipe before spawning and closes it if it
        // cannot transfer ownership. The worker does nothing before the hand-off.
        let mut accepted = [0];
        if std::io::stdin().read_exact(&mut accepted).is_err() || accepted != [1] {
            return Some((2, "the follow-ups were not handed to this process\n".to_owned()));
        }
    }
    let result = entry(root, mode, no_git, &mut waiting);
    match result {
        Some(Ok((report, failed))) => {
            out(&report);
            Some((if failed { 2 } else { 0 }, String::new()))
        }
        Some(Err(why)) => Some((2, format!("{why}\n"))),
        None if is_worker => Some((2, "the checkout changed before its follow-ups could be prepared\n".to_owned())),
        None => None,
    }
}

fn entry(
    root: &Path,
    mode: Mode,
    no_git: bool,
    waiting: &mut impl FnMut(&str),
) -> Option<Result<(String, bool), String>> {
    if !root.join(".git").exists() && root.ancestors().skip(1).any(|dir| dir.join(".git").exists()) {
        return None;
    }
    let layers = Layers::at(root)?;
    let index = layers.top.join("source-index.bin");
    let config = super::root_config(root)?;
    let tsconfig = source::tsconfig(root, config.as_ref())?;
    if config.as_ref().and_then(|config| config.pointer("/share/sourceIndex")).and_then(serde_json::Value::as_bool)
        == Some(true)
    {
        return None;
    }
    let recordings = journeys::recordings(&layers, config.as_ref())?;
    let turn_path = layers.base.join(".work/index-turn");
    let root_text = root.to_str()?;
    let index = index.to_str()?;
    let turn_path = turn_path.to_str()?;
    let manifests = manifests::read(root)?;
    Some(run(root_text, index, turn_path, recordings, tsconfig, no_git, manifests, mode, waiting, layers))
}

#[allow(clippy::too_many_arguments)]
fn run(
    root: &str,
    index: &str,
    turn_path: &str,
    recordings: Vec<journeys::Record>,
    tsconfig: Tsconfig,
    no_git: bool,
    manifests: Manifests,
    mode: Mode,
    waiting: &mut impl FnMut(&str),
    layers: Layers,
) -> Result<(String, bool), String> {
    let reservation =
        if matches!(mode, Mode::Worker) { Reservation::received(index)? } else { Reservation::take(index, waiting)? };
    let mut alone = Vec::new();
    let (tree, listed, started, describe) = {
        let _turn = turn(turn_path, root, &mut alone, waiting);
        let started = timestamp();
        let ordinary = change_tree(root.to_owned(), index.to_owned(), vec![".".to_owned()]);
        let listed = ordinary.is_some();
        let tree = ordinary.unwrap_or_else(|| disk_tree(root.to_owned(), vec![".".to_owned()]));
        let existed = Path::new(index).try_exists().map_err(|error| format!("{index}: {error}"))?;
        let reuse = source::Reuse {
            stores: listed.then(|| layers.parse_stores(root)).flatten(),
            others: layers.indexes_beside(Path::new(root)),
        };
        let update = source::refresh(&tree, root, index, &tsconfig, no_git, reuse)
            .ok_or("source index could not read its TypeScript configuration")?
            .map_err(|error| error.reason)?;
        if let Some(why) = &update.refused {
            let reason = why.strip_prefix(index).and_then(|s| s.strip_prefix(": ")).unwrap_or(why);
            return Err(format!("source index not written: {reason}, at {index}"));
        }
        layers.mark(Path::new(root));
        let describe = source_line(&update, existed, index);
        (tree, listed, started, describe)
    };
    if !matches!(mode, Mode::Worker) {
        let detached = matches!(mode, Mode::Detach);
        if let Some(child) = launch(root, &reservation, no_git, detached)? {
            let pid = child.id();
            let log = reservation.log();
            if detached {
                let line = format!("follow-ups: nothing has failed; process {pid} is still making the code map, the journeys, the dependency lexicon and the questions. The next variance command that reads them waits for it, and exits 2 with the reason if git could not read a walk. Its lines are written to {log}");
                return Ok((report(describe, alone, [line]), false));
            }
            drop(tree);
            drop(manifests);
            drop(recordings);
            let ended = child
                .wait_with_output()
                .map_err(|error| format!("could not wait for process {pid}, making the follow-ups: {error}"))?;
            let output = std::str::from_utf8(&ended.stdout).ok();
            let follow_ups = output.and_then(|out| out.split_once('\n')).map(|(_, lines)| lines.trim_end_matches('\n'));
            let failed = match (ended.status.code(), follow_ups) {
                (Some(0), Some(_)) => false,
                (Some(2), Some(_)) => true,
                _ => return Err(format!("process {pid}, making the follow-ups `variance index` waited on, ended with {} before it finished; what it wrote is in {log}", ended.status)),
            };
            let lines = follow_ups.expect("a completed worker sends its report").lines().map(str::to_owned);
            // A refused index turn may be the same on both sides of the hand-off.
            let duplicate = |line: &str| line.starts_with("no index turn at ") && alone.iter().any(|one| one == line);
            let lines: Vec<_> = lines.filter(|line| !duplicate(line)).collect();
            return Ok((report(describe, alone, lines), failed));
        }
    }
    let _turn = turn(turn_path, root, &mut alone, waiting);
    crate::ready_index::readied(index).map_err(|why| format!("the source index at {index} was not readied: {why}"))?;
    reservation.readied()?;
    let ((map, (walks, failed)), (names, questions)) = rayon::join(
        || {
            let result = if listed {
                orient_map::prepare_listed(&tree, root, index, manifests.workspaces, tsconfig.clone())
            } else {
                orient_map::uncarried(root, index, Some(true), manifests.workspaces, tsconfig.clone())
            };
            let map = match result {
                Ok(prepared) => map_line(prepared),
                Err(error) => format!("code map: not prepared: {}", error.reason),
            };
            let walks = journeys::prepare(root, index, listed.then_some(&tree), recordings, &tsconfig);
            (map, walks)
        },
        || {
            rayon::join(
                || lexicon(root, index, tsconfig.clone()),
                || match publish(root, index, started, &manifests, tsconfig.clone()) {
                    Ok(line) => line,
                    Err(why) => format!("questions: not published: {why}"),
                },
            )
        },
    );
    let complete = report(describe, alone, [map].into_iter().chain(walks).chain([names, questions]));
    reservation.finish(&complete, &failed)?;
    Ok((complete, !failed.is_empty()))
}

fn report(describe: String, alone: Vec<String>, follow_ups: impl IntoIterator<Item = String>) -> String {
    [describe].into_iter().chain(alone).chain(follow_ups).collect::<Vec<_>>().join("\n") + "\n"
}

fn launch(
    root: &str,
    reservation: &Reservation,
    no_git: bool,
    detached: bool,
) -> Result<Option<std::process::Child>, String> {
    let Ok(executable) = std::env::current_exe() else { return Ok(None) };
    let Ok(log) = File::create(reservation.log()) else { return Ok(None) };
    let Ok(errors) = log.try_clone() else { return Ok(None) };
    let mut command = Command::new(executable);
    command
        .current_dir(root)
        .args(["index", "--native-follow-ups"])
        .env_remove("npm_config_user_agent")
        .stdin(Stdio::piped())
        .stderr(errors);
    if detached {
        command.stdout(log);
        detach(&mut command);
    } else {
        command.stdout(Stdio::piped());
    }
    if no_git {
        command.arg("--no-git");
    }
    let Ok(mut child) = command.spawn() else { return Ok(None) };
    let pid = child.id();
    let mut pipe = child.stdin.take().expect("the worker's stdin is piped");
    if let Err(error) = reservation.hand_to(pid).and_then(|()| pipe.write_all(&[1]).map_err(|error| error.to_string()))
    {
        drop(pipe);
        let _ = child.wait();
        return Err(error);
    }
    Ok(Some(child))
}

fn detach(command: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // setsid only changes the child's process group and controlling terminal.
        unsafe {
            command.pre_exec(|| if libc::setsid() == -1 { Err(std::io::Error::last_os_error()) } else { Ok(()) });
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x00000008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
        command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
}

fn timestamp() -> String {
    format!("{:.3}", jiff::Timestamp::now())
}

fn turn(path: &str, root: &str, alone: &mut Vec<String>, waiting: &mut impl FnMut(&str)) -> Option<IndexTurn> {
    let asked = serde_json::json!({ "pid": std::process::id(), "root": root }).to_string();
    let mut told = false;
    loop {
        match take_index_turn(path.to_owned(), asked.clone()) {
            Ok(Some(turn)) => return Some(turn),
            Err(error) => {
                let why =
                    error.reason.strip_prefix(path).and_then(|rest| rest.strip_prefix(": ")).unwrap_or(&error.reason);
                let note =
                    format!("no index turn at {path}: {why}, so this index may run beside another of this repository");
                if !alone.contains(&note) {
                    alone.push(note);
                }
                return None;
            }
            Ok(None) => {}
        }
        if !told {
            let holder = fs::read(format!("{path}.holder"))
                .ok()
                .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok());
            if let Some((pid, checkout)) =
                holder.as_ref().and_then(|held| Some((held.get("pid")?.as_u64()?, held.get("root")?.as_str()?)))
            {
                waiting(&format!("waiting for process {pid}, which is indexing {checkout}: an index uses every core, so checkouts of one repository take turns\n"));
                told = true;
            }
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

fn source_line(update: &Updated, existed: bool, index: &str) -> String {
    let Updated { files, reread, rebuilt, written, .. } = update;
    let count = format!("{files} {}", if *files == 1 { "file" } else { "files" });
    let from = update.from.as_ref().map_or_else(String::new, |path| format!(" from the one at {path}"));
    match rebuilt.as_deref() {
        Some("damaged") => format!("source index repaired{from}: {count}, {reread} read again, at {index}"),
        Some("other-version") => format!(
            "source index rebuilt{from} over one written in format version {}: {count}, {reread} read again, at {index}",
            written.map_or_else(|| "undefined".to_owned(), |version| version.to_string())
        ),
        _ if existed => format!("source index updated: {count}, {reread} read again, at {index}"),
        _ if update.from.is_some() => format!("source index built{from}: {count}, {reread} read again, at {index}"),
        _ => format!("source index built: {count}, at {index}"),
    }
}

fn map_line(prepared: Option<OrientMapPrepared>) -> String {
    let Some(prepared) = prepared else { return "code map: not prepared: there is no source index".to_owned() };
    let (first, unread) = match prepared.map {
        Some(map) => (
            format!(
                "code map: {} packages in {} areas, {} deep, over {} dependency layers",
                map.packages, map.areas, map.levels, map.layers
            ),
            (map.unread != 0).then(|| {
                format!(
                    "{} files could not be read against their parse, so the names they take are not on it",
                    map.unread
                )
            }),
        ),
        None => (
            format!("code map: none, because {}", prepared.unmade.as_deref().unwrap_or("there is no package to fold")),
            None,
        ),
    };
    let notes = [
        (prepared.walked, "git could not list the checkout, so its files are the ones the index holds and its manifests the ones found beside them"),
        (prepared.unmarked, "git could not say which files are generated or vendored, so none were set aside"),
        (prepared.relisted, "no scan's listing of the checkout was carried, so git listed it again for the map"),
        (prepared.kept, "kept, because the index and the manifests are the ones it was folded from"),
    ];
    [first]
        .into_iter()
        .chain(unread)
        .chain(notes.into_iter().filter_map(|(show, text)| show.then(|| text.to_owned())))
        .collect::<Vec<_>>()
        .join("; ")
}

fn lexicon(root: &str, index: &str, tsconfig: Tsconfig) -> String {
    let layer = Path::new(index).parent().expect("source index has a layer");
    let catalogue = layer.join("dependency-lexicon.bin").to_string_lossy().into_owned();
    let sites = layer.join("dependency-lexicon.sites.bin").to_string_lossy().into_owned();
    match crate::dependency_lexicon::refresh(root.to_owned(), index.to_owned(), catalogue, sites, tsconfig) {
        Ok(one) if one.unchanged => format!("dependency lexicon: unchanged, nothing read: {} workspace-dependency pairs, {} public entrypoints, {} unavailable, at {}", one.packages, one.entrypoints, one.unavailable, one.path),
        Ok(one) => {
            let read = if !one.rebuilt && one.appended > 0 {
                format!("{} changed source {} read: ", one.appended, if one.appended == 1 { "file" } else { "files" })
            } else {
                String::new()
            };
            format!("dependency lexicon: {read}{} workspace-dependency pairs, {} public entrypoints, {} reused, {} unavailable, at {}", one.packages, one.entrypoints, one.reused, one.unavailable, one.path)
        }
        Err(error) => format!("dependency lexicon: not prepared: {}", error.reason),
    }
}

fn publish(
    root: &str,
    index: &str,
    started: String,
    manifests: &Manifests,
    tsconfig: Tsconfig,
) -> Result<String, String> {
    let at = format!("{index}.help.bin");
    let missing = || format!("the value read back from {at} is not the one this run wrote");
    let manifest = match fs::read(index) {
        Ok(bytes) => graph_digest(&bytes),
        Err(error) if error.kind() == ErrorKind::NotFound => return Err(missing()),
        Err(error) => return Err(format!("{index}: {error}")),
    };
    if let Some(generation) = kept(root, index, &at, &manifest, &manifests.digest) {
        return Ok(format!(
            "questions: kept at {generation}, because the index and the manifests are the ones it was published from"
        ));
    }
    let generation = timestamp();
    let options = HelpPublish {
        root: root.to_owned(),
        graph_root: root.to_owned(),
        generated_at: generation.clone(),
        read_started_at: started,
        index_digest: Some(manifest),
        packages_digest: manifests.digest.clone(),
        readme_root: root.to_owned(),
        unreadable: manifests.unreadable.clone(),
        packages: manifests.packages.clone(),
        graph_digest: None,
    };
    let mocking = Mocking::at(root, tsconfig, source::code_extensions());
    let encoded = help_publish::publish_index(
        index,
        options,
        &manifests.entries,
        manifests.targets.each_ref().map(Vec::as_slice),
        &mocking,
    )
    .map_err(|error| error.reason)?
    .ok_or_else(missing)?;
    let tree = encoded.tree.ok_or("the reading drew no tree, and none was handed to it")?;
    let path = format!("{index}.help-tree.{}.bin", encoded.graph_digest);
    replace(&path, &tree)?;
    replace(&at, &encoded.store)?;
    let head = read_head(&mut File::open(&at).map_err(|error| format!("{at}: {error}"))?)?;
    if head[3].as_deref() != Some(&generation) {
        return Err(missing());
    }
    Ok(format!("questions: published at {at}"))
}

fn kept(root: &str, index: &str, at: &str, manifest: &str, packages: &str) -> Option<String> {
    let [Some(owner), Some(graph_root), Some(graph), Some(generation), Some(_), _, _, Some(index_digest), Some(packages_digest)] =
        read_head(&mut File::open(at).ok()?).ok()?
    else {
        return None;
    };
    if owner != root
        || graph_root != root
        || index_digest != manifest
        || packages_digest != packages
        || graph.len() != 64
        || !graph.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return None;
    }
    let bytes = fs::read(format!("{index}.help-tree.{graph}.bin")).ok()?;
    (graph_digest(&bytes) == graph && SourceTree::read(&bytes, "").is_ok()).then_some(generation)
}
