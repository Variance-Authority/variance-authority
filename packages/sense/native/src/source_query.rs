//! The path questions, answered over the source tree where it lies.
//!
//! `source_tree.rs` writes the tree a path question opens; this is its one
//! reader. A question sends a start point and a direction, the whole walk runs
//! here over the paths and both arrow directions held as compressed rows, and
//! what crosses back is the answer: the files reached, their distance, the
//! chain of one file asked. A workspace below the graph's root sees the files
//! under it, said from it, and walks the whole graph, as it did when the tree
//! was decoded on the other side.

// compass: variance-authority.reach.source-index

use std::collections::HashMap;
use std::sync::Arc;

use napi::bindgen_prelude::{AsyncTask, Buffer};
use napi_derive::napi;

use crate::breadth_first::breadth_first;
use crate::help_publish::{open_index, opened_chain};
use crate::off_thread::{off_thread, OffThread};
use crate::order::code_unit;
use crate::segment::NONE;
use crate::source_tree::{tree, Mocking, EDGE_KINDS, FORMAT, VERSION};
use crate::stored::{partition, Stored};

/// One direction of the arrows: each file's row of neighbours, and the kind of each arrow.
#[derive(Default)]
struct Rows {
    offset: Vec<u32>,
    target: Vec<u32>,
    kind: Vec<u8>,
}

impl Rows {
    fn of(&self, node: u32) -> std::ops::Range<usize> {
        self.offset[node as usize] as usize..self.offset[node as usize + 1] as usize
    }

    /// The same arrows turned around, each row in the order of the file it comes from.
    fn transposed(&self, nodes: usize) -> Rows {
        let mut offset = vec![0u32; nodes + 1];
        for &to in &self.target {
            offset[to as usize + 1] += 1;
        }
        for node in 0..nodes {
            offset[node + 1] += offset[node];
        }
        let mut cursor = offset[..nodes].to_vec();
        let (mut target, mut kind) = (vec![0u32; self.target.len()], vec![0u8; self.kind.len()]);
        for from in 0..nodes as u32 {
            for edge in self.of(from) {
                let to = self.target[edge] as usize;
                let at = cursor[to] as usize;
                cursor[to] += 1;
                target[at] = from;
                kind[at] = self.kind[edge];
            }
        }
        Rows { offset, target, kind }
    }
}

/// The tree, read once: every path in code-unit order, both arrow directions,
/// and which files' imports could not all be read.
pub(crate) struct Graph {
    text: String,
    starts: Vec<u32>,
    unknown: Vec<bool>,
    forward: Rows,
    backward: Rows,
    /// The workspace's own path below the graph root, with its slash; empty at the root.
    prefix: String,
    /// The workspace's files, a run of ids because the paths are sorted.
    lo: u32,
    hi: u32,
}

impl Graph {
    pub(crate) fn read(bytes: &[u8], workspace: &str) -> Result<Graph, String> {
        let stored = Stored::open_as(bytes, FORMAT, VERSION)?;
        let paths = stored.u32s("files.path")?;
        let reasons = stored.u32s("files.unknown")?;
        let target = stored.u32s("edges.target")?;
        let nodes = paths.len();
        let offset = stored.offsets("edges.offset", nodes, target.len())?;
        let kind = stored.codes("edges.kind", (EDGE_KINDS.len() - 1) as u8)?;
        let whole = reasons.len() == nodes
            && kind.len() == target.len()
            && target.every(|to| (to as usize) < nodes)
            && paths.every(|id| stored.holds(id))
            && reasons.every(|id| id == NONE || stored.holds(id));
        if !whole {
            return Err("the source tree's columns do not agree".to_owned());
        }
        let (mut text, mut starts) = (String::new(), Vec::with_capacity(nodes + 1));
        starts.push(0);
        for row in 0..nodes {
            let path = stored.text(paths.at(row));
            if row > 0 && !code_unit(&text[starts[row - 1] as usize..], path).is_lt() {
                return Err(format!("the source tree's paths are out of order at {path}"));
            }
            text.push_str(path);
            starts.push(text.len() as u32);
        }
        let forward = Rows {
            offset: (0..=nodes).map(|row| offset.at(row)).collect(),
            target: (0..target.len()).map(|edge| target.at(edge)).collect(),
            kind: kind.to_vec(),
        };
        let backward = forward.transposed(nodes);
        let unknown = (0..nodes).map(|row| reasons.at(row) != NONE).collect();
        let prefix = if workspace.is_empty() { String::new() } else { format!("{}/", workspace.trim_end_matches('/')) };
        let mut graph = Graph { text, starts, unknown, forward, backward, prefix, lo: 0, hi: nodes as u32 };
        if !graph.prefix.is_empty() {
            let prefix = graph.prefix.clone();
            graph.lo = partition(nodes, |row| code_unit(graph.path(row as u32), &prefix).is_lt()) as u32;
            graph.hi = partition(nodes, |row| {
                let path = graph.path(row as u32);
                code_unit(path, &prefix).is_lt() || path.starts_with(&prefix)
            }) as u32;
        }
        Ok(graph)
    }

    fn nodes(&self) -> usize {
        self.unknown.len()
    }

    fn path(&self, id: u32) -> &str {
        &self.text[self.starts[id as usize] as usize..self.starts[id as usize + 1] as usize]
    }

    /// A workspace file's path as the workspace says it.
    fn said(&self, id: u32) -> &str {
        &self.path(id)[self.prefix.len()..]
    }

    /// The file at a path below the graph root.
    fn id(&self, path: &str) -> Option<u32> {
        let at = partition(self.nodes(), |row| code_unit(self.path(row as u32), path).is_lt());
        (at < self.nodes() && self.path(at as u32) == path).then_some(at as u32)
    }

    /// The workspace's file at a path said from it.
    fn own(&self, path: &str) -> Option<u32> {
        if self.prefix.is_empty() { self.id(path) } else { self.id(&format!("{}{path}", self.prefix)) }
    }

    /// A seed: the workspace's file when it holds one at that path, else the graph's.
    fn seed(&self, path: &str) -> Option<u32> {
        self.own(path).or_else(|| self.id(path))
    }

    /// The kind of the import `from` makes of `to`: of two, the one that is not a type's.
    fn import_kind(&self, from: u32, to: u32) -> &'static str {
        let mut found = None;
        for edge in self.forward.of(from) {
            if self.forward.target[edge] != to {
                continue;
            }
            let held = EDGE_KINDS[self.forward.kind[edge] as usize];
            if held != "type" {
                return held;
            }
            found = Some(held);
        }
        found.expect("a chain steps only along an import the tree holds")
    }

    /// One breadth-first search from every seed at once. Each file keeps the
    /// one it was entered from, so the way back is a shortest chain, and the
    /// first row wins a tie.
    pub(crate) fn walk(&self, seeds: &[u32], backward: bool) -> Walked {
        let rows = if backward { &self.backward } else { &self.forward };
        let (mut depth, mut via) = (vec![NONE; self.nodes()], vec![NONE; self.nodes()]);
        breadth_first(&rows.offset, &rows.target, seeds, |from, next| {
            if depth[next as usize] != NONE {
                return false;
            }
            depth[next as usize] = from.map_or(0, |(node, _)| depth[node as usize] + 1);
            via[next as usize] = from.map_or(NONE, |(node, _)| node);
            true
        });
        Walked { depth, via, backward }
    }
}

/// What one walk reached: each file's distance from the seeds and the file it was entered from.
pub(crate) struct Walked {
    depth: Vec<u32>,
    via: Vec<u32>,
    backward: bool,
}

/// The segments of a path, empty ones dropped, as the start point splits them.
fn segments(path: &str) -> impl Iterator<Item = &str> {
    path.split('/').filter(|segment| !segment.is_empty())
}

/// Whether `path` starts with the segments `named` and holds between `least`
/// and `most` segments.
fn starts_at(path: &str, named: &[&str], joined: &str, least: usize, most: usize) -> bool {
    let plain = !path.starts_with('/') && !path.contains("//");
    if plain && !(path.starts_with(joined) && path.as_bytes().get(joined.len()) == Some(&b'/')) && path != joined {
        return false;
    }
    let mut count = 0;
    for (at, segment) in segments(path).enumerate() {
        if at < named.len() && named[at] != segment {
            return false;
        }
        count += 1;
    }
    count >= least && count <= most
}

/// One import on a chain: the file, and the kind of import it takes towards the seed.
#[napi(object)]
pub struct SourceLink {
    pub file: String,
    pub kind: Option<String>,
}

/// The source tree a path question opened, read once.
#[napi]
pub struct SourceTree {
    graph: Arc<Graph>,
}

/// A walk over a [`SourceTree`], held so each file it reached can say how.
#[napi]
pub struct SourceWalk {
    graph: Arc<Graph>,
    walked: Walked,
}

/// The tree in `bytes` as a workspace at `workspace` below its root sees it; empty for the root itself.
#[napi(catch_unwind)]
pub fn open_source_tree(bytes: Buffer, workspace: String) -> napi::Result<SourceTree> {
    Graph::read(&bytes, &workspace).map(|graph| SourceTree { graph: Arc::new(graph) }).map_err(|error| napi::Error::from_reason(format!("the source tree did not read: {error}")))
}

/// The tree drawn from the source index at `index`, as `read_help` draws the
/// one it publishes: `null` when no index was published there.
#[napi(ts_return_type = "Promise<SourceTree | null>")]
pub fn source_tree_of(root: String, index: String, tsconfig: Option<napi::Either<String, bool>>, code: Vec<String>) -> AsyncTask<OffThread<Option<SourceTree>>> {
    let tsconfig = crate::resolve::Tsconfig::from_js(tsconfig);
    off_thread(move || {
        let mocking = Mocking::at(&root, tsconfig, code);
        let drawn = opened_chain(&open_index(index)?, |layers| tree(layers, &mocking))?;
        drawn.map(|bytes| open_source_tree(bytes.into(), String::new())).transpose()
    })
}

#[napi]
impl SourceTree {
    /// How many files the workspace holds.
    #[napi(getter)]
    pub fn size(&self) -> u32 {
        self.graph.hi - self.graph.lo
    }

    /// Whether the workspace holds a file at `path`, said from it.
    #[napi]
    pub fn has(&self, path: String) -> bool {
        self.graph.own(&path).is_some()
    }

    /// The workspace's files from the `from`th, at most `limit` of them, said from it.
    #[napi]
    pub fn paths(&self, from: u32, limit: u32) -> Vec<String> {
        let graph = &self.graph;
        let start = graph.lo.saturating_add(from).min(graph.hi);
        (start..start.saturating_add(limit).min(graph.hi)).map(|id| graph.said(id).to_owned()).collect()
    }

    /// The workspace's files a start point names, said from it: `said` split
    /// into segments and `width` one of `file`, `under` or `own`. A file-width
    /// path that is no file names the folder of that name.
    #[napi]
    pub fn entries(&self, said: String, width: String) -> Vec<String> {
        let mut named: Vec<&str> = segments(&said).collect();
        if width == "own" {
            named.pop();
        }
        if named.is_empty() {
            return Vec::new();
        }
        let (least, most) = match width.as_str() {
            "file" => (named.len(), usize::MAX),
            "own" => (named.len() + 1, named.len() + 1),
            _ => (named.len() + 1, usize::MAX),
        };
        let joined = named.join("/");
        let graph = &self.graph;
        (graph.lo..graph.hi).map(|id| graph.said(id)).filter(|path| starts_at(path, &named, &joined, least, most)).map(str::to_owned).collect()
    }

    /// Those of `paths`, below the graph root, whose imports could not all be read, sorted.
    #[napi]
    pub fn unknown_among(&self, paths: Vec<String>) -> Vec<String> {
        let mut found: Vec<String> = paths.into_iter().filter(|path| self.graph.id(path).is_some_and(|id| self.graph.unknown[id as usize])).collect();
        found.sort_unstable_by(|left, right| code_unit(left, right));
        found
    }

    /// Every workspace file whose imports could not all be read, below the graph root.
    #[napi]
    pub fn unknown_files(&self) -> Vec<String> {
        let graph = &self.graph;
        (graph.lo..graph.hi).filter(|&id| graph.unknown[id as usize]).map(|id| graph.path(id).to_owned()).collect()
    }

    /// Every file reachable from `seeds` along the imports, or against them
    /// when `against`. A seed the tree does not hold reaches nothing.
    #[napi]
    pub fn walk(&self, seeds: Vec<String>, against: bool) -> SourceWalk {
        let graph = &self.graph;
        let seeds: Vec<u32> = seeds.iter().filter_map(|seed| graph.seed(seed)).collect();
        SourceWalk { walked: graph.walk(&seeds, against), graph: Arc::clone(graph) }
    }
}

#[napi]
impl SourceWalk {
    /// Every file reached, below the graph root, in code-unit order.
    #[napi]
    pub fn files(&self) -> Vec<String> {
        self.reached().map(|id| self.graph.path(id).to_owned()).collect()
    }

    /// The distance of each of [`Self::files`], in its order: a seed at zero, every import one more.
    #[napi]
    pub fn depths(&self) -> Vec<u32> {
        self.reached().map(|id| self.walked.depth[id as usize]).collect()
    }

    /// One shortest chain from `path` back to a seed: `path` first, the seed
    /// last, each step but the last with the kind of import between it and
    /// the next. Empty for a file the walk did not reach.
    #[napi]
    pub fn chain(&self, path: String) -> Vec<SourceLink> {
        let trail = self.trail_of(&path);
        trail
            .iter()
            .enumerate()
            .map(|(step, &at)| {
                let kind = trail.get(step + 1).map(|&next| {
                    let (from, to) = if self.walked.backward { (at, next) } else { (next, at) };
                    self.graph.import_kind(from, to).to_owned()
                });
                SourceLink { file: self.graph.path(at).to_owned(), kind }
            })
            .collect()
    }
}

/// Each file `walks` reached together, below the graph root, with whether its
/// imports could not all be read: the union a start point said both ways scopes.
pub(crate) fn reached_by<'a>(walks: &[&'a SourceWalk]) -> HashMap<&'a str, bool> {
    let mut reached = HashMap::new();
    for walk in walks {
        for id in walk.reached() {
            reached.insert(walk.graph.path(id), walk.graph.unknown[id as usize]);
        }
    }
    reached
}

impl SourceWalk {
    fn reached(&self) -> impl Iterator<Item = u32> + '_ {
        (0..self.graph.nodes() as u32).filter(|&id| self.walked.depth[id as usize] != NONE)
    }

    fn trail_of(&self, path: &str) -> Vec<u32> {
        let Some(mut at) = self.graph.id(path).filter(|&id| self.walked.depth[id as usize] != NONE) else { return Vec::new() };
        let mut trail = vec![at];
        while self.walked.via[at as usize] != NONE {
            at = self.walked.via[at as usize];
            trail.push(at);
        }
        trail
    }
}

#[cfg(test)]
#[path = "source_query_tests.rs"]
mod tests;
