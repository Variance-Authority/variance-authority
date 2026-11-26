//! Standalone entry into source queries over the last published generation.

// compass: variance-authority.report.agent-surface

use std::ffi::OsString;
use std::io;
use std::path::{Path, PathBuf};


use crate::help_grep_answer::{self, Roots, Said};
use crate::help_page::Page;
use crate::help_package_answer;
use crate::help_search_answer::search;
use crate::help_store::{graph_digest, read_head};
use crate::help_surface::{CLI, Surface};
use crate::help_unread::{node_said, symbol_not_answered, uses_not_answered, SymbolAsked};
use crate::help_symbol_answer::{self, exact_symbols};
use crate::help_symbol_line;
use crate::help_uses_answer::{self, uses};
use crate::index_chain::OpenedChain;
use crate::source_query::SourceTree;
use crate::text_cut::blank;

#[path = "cli_cache.rs"]
pub(crate) mod cache;
#[path = "cli_source.rs"]
mod source;
#[path = "cli_index.rs"]
pub(crate) mod index;
#[path = "cli_manifests.rs"]
mod manifests;
#[path = "cli_follow_ups.rs"]
mod follow_ups;
#[path = "help_discover.rs"]
mod discover;
#[path = "select_cli.rs"]
mod select;

/// Coordinate index publication before falling through to the other CLI commands.
pub fn index_answer(args: &[OsString], waiting: impl FnMut(&str), out: impl FnOnce(&str)) -> Option<(i32, String)> {
    let (command, args) = args.split_first()?;
    if command != "index" {
        return None;
    }
    let args = args.iter().map(|arg| arg.to_str()).collect::<Option<Vec<_>>>()?;
    index::answer(&args, &physical(&std::env::current_dir().ok()?), waiting, out)
}

/// Answer a published query in the standalone process. Other calls belong to
/// the Node dispatcher, which also owns recovery when the publication is absent.
pub fn answer(args: &[OsString], mut waiting: impl FnMut(&str)) -> Option<(i32, String)> {
    let args = args.iter().map(|arg| arg.to_str()).collect::<Option<Vec<_>>>()?;
    let root = physical(&std::env::current_dir().ok()?);
    if let ["covering", rest @ ..] = args.as_slice() {
        return crate::covering_answer::answer(crate::covering_answer::Request::parse(rest, &root)?);
    }
    if let ["select", rest @ ..] = args.as_slice() {
        let (out, err) = select::answer(rest, &root, &mut waiting)?;
        waiting(&err);
        return Some((0, out));
    }
    let question = match args.as_slice() {
        ["ask", "packages", rest @ ..] => Question::Packages(page_args(rest)?),
        ["ask", "entrypoint", rest @ ..] => {
            let (package, subpath) = entrypoint_args(rest)?;
            Question::Entrypoint(package, subpath)
        }
        ["ask", "discover", rest @ ..] => Question::Discover(discover::Request::parse(rest)?),
        ["ask", "grep", rest @ ..] => Question::Grep(QueryRequest::from_args(rest)?),
        ["ask", "symbol", rest @ ..] => Question::Symbol(SymbolRequest::from_args(rest)?),
        ["ask", "uses", rest @ ..] => Question::Uses(UsesRequest::from_args(rest)?),
        ["ask", "search", rest @ ..] => Question::Search(QueryRequest::from_args(rest)?),
        _ => return None,
    };
    // A name question says why it is not answered here and is never handed on: the Node entry answers it with this same reading.
    let name = matches!(question, Question::Symbol(_) | Question::Uses(_));
    let layers = match cache::Layers::found(&root) {
        Ok(layers) => layers,
        Err(why) => return name.then(|| (2, format!("variance: the source index of this checkout cannot be found: {why}.\n"))),
    };
    let index = layers.top.join("source-index.bin");
    follow_ups::settled(&index, waiting)?;
    let Some(root_text) = root.to_str() else {
        return name.then(|| (2, format!("variance: the checkout path {} is not UTF-8\n", root.display())));
    };
    let (mut file, published) = match publication(root_text, &index) {
        Ok(publication) => publication,
        Err(why) => return name.then_some((2, why)),
    };
    let text = match question {
        Question::Packages(page) => Ok(help_package_answer::packages(&mut file, &page)?),
        Question::Entrypoint(package, subpath) => help_package_answer::names(&mut file, package, subpath)?,
        Question::Discover(request) => {
            if root != published.graph_root { return None }
            let tree = published_tree(&root, &index, &published)?;
            discover::answer(root.to_str()?, &index, &tree, request)?
        }
        Question::Grep(request) => {
            let tree = published_tree(&root, &index, &published)?;
            let said = Said { offset: request.offset, limit: request.limit };
            let roots = Roots { workspace: &root, graph: &published.graph_root };
            let asked = help_grep_answer::Asked { query: request.query, from: request.from, to: request.to, said };
            help_grep_answer::answered(&tree, &roots, asked, Surface(Some(CLI)))
        }
        Question::Symbol(request) => 'symbol: {
            let chain = match name_chain(&index) { Ok(chain) => chain, Err(why) => return Some((2, why)) };
            let asking = help_symbol_answer::Asking {
                root: root_text, lexicon: &layers.top, layers: chain.layers(), wanted: request.package, from: &request.from, limit: request.limit, surface: Surface(Some(CLI)),
            };
            let asked = SymbolAsked { names: &request.names, package: request.package, from: &request.from, line: request.line, limit: request.limit };
            let refused = |why: String| symbol_not_answered(Surface(Some(CLI)), &asked, &why);
            let answers = match exact_symbols(&asking, &mut file, &request.names) { Ok(answers) => answers, Err(why) => break 'symbol Err(refused(why)) };
            match request.line {
                Some(line) => {
                    let recorded = match crate::recordings::recorded(&root) { Ok(recorded) => recorded, Err(why) => break 'symbol Err(refused(why)) };
                    help_symbol_line::at_line(root_text, &request.names, line, &answers, &recorded)
                }
                None => Ok(answers.into_iter().map(|answer| answer.text).collect::<Vec<_>>().join("\n\n")),
            }
        }
        Question::Uses(request) => {
            let chain = match name_chain(&index) { Ok(chain) => chain, Err(why) => return Some((2, why)) };
            let asking = help_uses_answer::Asking {
                root: root_text, layers: chain.layers(), name: request.name, wanted: request.package,
                from: request.from, file: request.file, limit: request.limit, surface: Surface(Some(CLI)), listed: Default::default(),
            };
            uses(&asking, &mut file).map(|answer| answer.unwrap_or_else(|nothing| nothing)).map_err(|why| uses_not_answered(&asking, &why))
        }
        Question::Search(request) => {
            if request.offset.is_some() { return None }
            let scope = if request.from.is_empty() && request.to.is_empty() { None } else {
                let tree = published_tree(&root, &index, &published)?;
                Some(help_grep_answer::resolve(&tree, root.to_str()?, request.from, request.to))
            };
            Ok(match scope {
                Some(Err(why)) => format!("No search was run: {why}. Say a real path from the root — `src/dispatch/read.ts` is that file, `src/dispatch/*` its folder's own files, `src/dispatch/` everything under it. A name on its own is not a path. To search the whole workspace, leave the start point out."),
                scope => search(root.to_str()?, &index, &mut file, request.query.trim_matches(blank), request.limit, scope.and_then(Result::ok).as_ref())?,
            })
        }
    };
    let footer = format!("Snapshot {} may miss later changes: run `variance index`.", published.generated_at);
    Some(match text {
        Ok(text) => (0, format!("{text}\n{footer}\n")),
        Err(error) => (2, format!("{error}\n\n{footer}\n")),
    })
}

enum Question<'a> {
    Packages(Page),
    Entrypoint(&'a str, Option<&'a str>),
    Discover(discover::Request<'a>),
    Grep(QueryRequest<'a>),
    Symbol(SymbolRequest<'a>),
    Uses(UsesRequest<'a>),
    Search(QueryRequest<'a>),
}

/// The page `ask packages` said: `--limit` and `--offset`, each once; any other flag is the Node dispatcher's to refuse.
fn page_args(args: &[&str]) -> Option<Page> {
    let (mut offset, mut limit) = (None, None);
    let mut args = args.iter().copied();
    while let Some(flag) = args.next() {
        let (flag, value) = match flag.split_once('=') {
            Some(pair) => pair,
            None => (flag, args.next().filter(|value| !value.starts_with("--"))?),
        };
        match flag {
            "--offset" if offset.is_none() => offset = Some(value.parse().ok()?),
            "--limit" if limit.is_none() => limit = Some(value.parse().ok().filter(|value| *value > 0)?),
            _ => return None,
        }
    }
    Some(Page { offset: offset.unwrap_or(0), limit: limit.unwrap_or(help_package_answer::SHOWN) })
}

fn entrypoint_args<'a>(args: &[&'a str]) -> Option<(&'a str, Option<&'a str>)> {
    let (mut package, mut subpath) = (None, None);
    let mut args = args.iter().copied();
    while let Some(flag) = args.next() {
        let (flag, value) = match flag.split_once('=') {
            Some(pair) => pair,
            None => (flag, args.next().filter(|value| !value.starts_with("--"))?),
        };
        match flag {
            "--package" if package.is_none() && !value.trim_matches(blank).is_empty() => package = Some(value),
            "--subpath" if subpath.is_none() => subpath = Some(value),
            _ => return None,
        }
    }
    Some((package?, subpath))
}

struct UsesRequest<'a> {
    name: &'a str,
    package: Option<&'a str>,
    from: Option<&'a str>,
    file: Option<&'a str>,
    limit: Option<usize>,
}

impl<'a> UsesRequest<'a> {
    fn from_args(args: &[&'a str]) -> Option<Self> {
        let (mut name, mut package, mut from, mut file, mut limit) = (None, None, None, None, None);
        let mut args = args.iter().copied();
        while let Some(flag) = args.next() {
            let (flag, value) = match flag.split_once('=') {
                Some(values) => values,
                None => (flag, args.next().filter(|value| !value.starts_with("--"))?),
            };
            match flag {
                "--name" if name.is_none() => name = Some(value.trim_matches(blank)),
                "--package" if package.is_none() => package = Some(value),
                "--from" if from.is_none() => from = Some(value),
                "--file" if file.is_none() => file = Some(value),
                "--limit" if limit.is_none() => limit = Some(value.parse().ok().filter(|value| *value > 0)?),
                _ => return None,
            }
        }
        let name = name?;
        (!name.is_empty()).then_some(Self { name, package: package.filter(|value| !value.is_empty()), from: from.filter(|value| !value.is_empty()), file: file.filter(|value| !value.is_empty()), limit })
    }
}

struct SymbolRequest<'a> {
    names: Vec<&'a str>,
    package: Option<&'a str>,
    from: Vec<String>,
    limit: Option<usize>,
    line: Option<&'a str>,
}

impl<'a> SymbolRequest<'a> {
    fn from_args(args: &[&'a str]) -> Option<Self> {
        let mut name = None;
        let mut package = None;
        let mut from = Vec::new();
        let mut limit = None;
        let mut line = None;
        let mut args = args.iter().copied();
        while let Some(flag) = args.next() {
            let (flag, value) = match flag.split_once('=') {
                Some(values) => values,
                None => (flag, args.next().filter(|value| !value.starts_with("--"))?),
            };
            match flag {
                "--name" if name.is_none() => name = Some(value),
                "--package" if package.is_none() => package = Some(value),
                "--from" => push_point(&mut from, value),
                "--limit" if limit.is_none() => limit = Some(value.parse().ok().filter(|value| *value > 0)?),
                "--line" if line.is_none() => line = Some(value),
                _ => return None,
            }
        }
        let mut seen = std::collections::HashSet::new();
        let names: Vec<_> = name?.split(',')
            .map(|name| name.trim_matches(blank))
            .filter(|name| !name.is_empty() && seen.insert(*name))
            .collect();
        (!names.is_empty() && names.iter().all(|name| !name.starts_with("--")))
            .then_some(Self { names, package: package.filter(|value| !value.is_empty()), from, limit, line })
    }
}

struct QueryRequest<'a> {
    query: &'a str,
    from: Vec<String>,
    to: Vec<String>,
    offset: Option<usize>,
    limit: Option<usize>,
}

impl<'a> QueryRequest<'a> {
    fn from_args(args: &[&'a str]) -> Option<Self> {
        let mut query = None;
        let mut from = Vec::new();
        let mut to = Vec::new();
        let mut offset = None;
        let mut limit = None;
        let mut args = args.iter().copied();
        while let Some(flag) = args.next() {
            let (flag, value) = match flag.split_once('=') {
                Some(values) => values,
                None => (flag, args.next().filter(|value| !value.starts_with("--"))?),
            };
            match flag {
                "--query" if query.is_none() && !value.trim_matches(blank).is_empty() => query = Some(value),
                "--from" => push_point(&mut from, value),
                "--to" => push_point(&mut to, value),
                "--offset" if offset.is_none() => offset = Some(value.parse().ok()?),
                "--limit" if limit.is_none() => limit = Some(value.parse().ok().filter(|value| *value > 0)?),
                _ => return None,
            }
        }
        Some(Self { query: query?, from, to, offset, limit })
    }
}

fn push_point(points: &mut Vec<String>, said: &str) {
    let said = said.trim_matches(blank);
    if !said.is_empty() && !points.iter().any(|point| point == said) {
        points.push(said.to_owned());
    }
}

struct Publication {
    graph_root: PathBuf,
    graph_digest: String,
    generated_at: String,
}

/// The published head of the help store beside `index`, or why it is not this
/// checkout's readable publication, said as a name question prints it.
fn publication(root: &str, index: &Path) -> Result<(std::fs::File, Publication), String> {
    let index = index.to_str().ok_or_else(|| format!("variance: the source index path {} is not UTF-8\n", index.display()))?;
    let at = format!("{index}.help.bin");
    let mut file = std::fs::File::open(&at).map_err(|error| unopened(&at, &error))?;
    let unread = |why: &str| format!("The workspace snapshot at {at} does not read: {why}. Run `variance index` to publish it again.\n");
    let head = read_head(&mut file).map_err(|why| unread(&why))?;
    let [Some(owner), Some(graph_root), Some(digest), Some(generated_at), Some(_), Some(_), ..] = head else { return Err(unread("its head is cut short")) };
    if owner != root {
        return Err(format!("The workspace snapshot at {at} was published for another checkout, {owner}. Run `variance index` here to publish this one's.\n"));
    }
    if digest.len() != 64 || !digest.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(unread("its source tree digest is not one"));
    }
    Ok((file, Publication { graph_root: PathBuf::from(graph_root), graph_digest: digest, generated_at }))
}

/// Why the help store at `at` did not open.
fn unopened(at: &str, error: &io::Error) -> String {
    format!("no readable workspace snapshot at {at}: {}. Run `variance index` to publish one.\n", node_said(at, error))
}

fn published_tree(root: &Path, index: &Path, head: &Publication) -> Option<SourceTree> {
    let workspace = root.strip_prefix(&head.graph_root).ok()?.to_str()?.replace(std::path::MAIN_SEPARATOR, "/");
    let graph = std::fs::read(format!("{}.help-tree.{}.bin", index.to_str()?, head.graph_digest)).ok()?;
    if graph_digest(&graph) != head.graph_digest {
        return None;
    }
    SourceTree::read(&graph, &workspace).ok()
}

pub(crate) fn source_index(root: &Path) -> Option<PathBuf> {
    Some(cache::Layers::at(root)?.top.join("source-index.bin"))
}

/// The chain a name question reads, or what it prints when there is none: no
/// index published, said apart from an index that does not read.
fn name_chain(index: &Path) -> Result<OpenedChain, String> {
    let at = index.to_str().ok_or_else(|| format!("variance: the source index path {} is not UTF-8\n", index.display()))?;
    match OpenedChain::read(at) {
        Ok(Some(chain)) => Ok(chain),
        Ok(None) => Err("No source index is published for this checkout; run `variance index`.\n".to_owned()),
        Err(why) => Err(format!("The source index at {at} does not read: {why}\n")),
    }
}

pub(crate) fn runtime_tree(root: &Path) -> Option<crate::source_query::RuntimeTree> {
    use crate::index_chain::OpenedChain;

    let root = physical(root);
    let index = source_index(&root)?;
    let (_, published) = publication(root.to_str()?, &index).ok()?;
    if root != published.graph_root { return None }
    let chain = OpenedChain::read(index.to_str()?).ok()??;
    let tree = published_tree(&root, &index, &published)?;
    let config = root_config(&root)?;
    let tsconfig = source::tsconfig(&root, config.as_ref())?;
    let cuts = crate::source_tree::mock_cuts(chain.layers(), root.to_str()?, tsconfig);
    Some(crate::source_query::RuntimeTree::new(tree, &cuts))
}

pub(crate) use crate::checkout_layers::{physical, root_config, seen_from};
