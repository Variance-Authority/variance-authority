//! A source-backed selection graph whose columns and provenance remain native.
// compass: variance-authority.reach.relations

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use napi_derive::napi;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use crate::help_publish::{Opened, OpenedIndex};

#[path = "selection_graph_build.rs"]
mod build;
#[path = "selection_graph_uses.rs"]
mod uses;
#[path = "selection_graph_walk.rs"]
mod walk;
#[path = "selection_graph_queries.rs"]
mod queries;

pub(crate) const KINDS: [&str; 8] = ["imports", "reexports", "dynamic", "type", "asset", "declared-in", "depends-on", "depends"];
pub(crate) const NODE_KINDS: [&str; 3] = ["file", "component", "package"];

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct Node { pub kind: String, pub name: String }

#[derive(Clone, Debug, Serialize)]
pub(crate) struct NodeInfo {
    pub id: u32,
    pub kind: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unknown: Option<String>,
}

#[derive(Default)]
pub(crate) struct Adjacency { pub offsets: Vec<usize>, pub targets: Vec<u32>, pub kinds: Vec<u8> }

impl Adjacency {
    pub(crate) fn row(&self, id: u32) -> impl Iterator<Item = (u32, u8)> + '_ {
        let range = self.offsets.get(id as usize).zip(self.offsets.get(id as usize + 1))
            .map_or(0..0, |(&start, &end)| start..end);
        range.map(|at| (self.targets[at], self.kinds[at]))
    }
}

pub(crate) struct State {
    pub source: Arc<Opened>,
    pub names: Vec<String>,
    pub kinds: Vec<u8>,
    pub ids: HashMap<(u8, String), u32>,
    pub depends: Adjacency,
    pub dependents: Adjacency,
    pub sources: HashSet<String>,
    pub unknown: HashMap<u32, String>,
    pub shadows: HashMap<u32, Vec<u32>>,
    pub additions: HashSet<(u32, u32)>,
    pub uses: Mutex<HashMap<u32, HashMap<String, uses::EdgeUse>>>,
}

impl State {
    pub(crate) fn id(&self, node: &Node) -> Option<u32> {
        let kind = NODE_KINDS.iter().position(|kind| *kind == node.kind)? as u8;
        self.ids.get(&(kind, node.name.clone())).copied()
    }
    pub(crate) fn file(&self, name: &str) -> Option<u32> { self.ids.get(&(0, name.to_owned())).copied() }
    pub(crate) fn info(&self, id: u32) -> Option<NodeInfo> {
        Some(NodeInfo { id, kind: NODE_KINDS[*self.kinds.get(id as usize)? as usize].to_owned(),
            name: self.names.get(id as usize)?.clone(), unknown: self.unknown.get(&id).cloned() })
    }
}

/// One native graph, shared by every query and any resumable walk over it.
#[napi]
pub struct SelectionGraph { pub(crate) state: Arc<State> }

/// Open the graph over the existing question snapshot; this performs no second chain read.
#[napi(catch_unwind)]
pub fn selection_graph_of(index: &OpenedIndex, options: String) -> napi::Result<Option<SelectionGraph>> {
    let options = serde_json::from_str(&options).map_err(|error| napi::Error::from_reason(format!("selection graph options: {error}")))?;
    index.snapshot()?.map(|source| build::graph(source, options).map(|state| SelectionGraph { state: Arc::new(state) }))
        .transpose().map_err(napi::Error::from_reason)
}

#[napi]
impl SelectionGraph {
    /// A batched question: only asked or reached rows cross the boundary, never graph columns.
    #[napi(catch_unwind)]
    pub fn query(&self, request: String) -> napi::Result<String> {
        let request: Value = serde_json::from_str(&request).map_err(|error| napi::Error::from_reason(error.to_string()))?;
        queries::query(&self.state, request).and_then(|answer| serde_json::to_string(&answer).map_err(|error| error.to_string()))
            .map_err(napi::Error::from_reason)
    }
}

pub(crate) fn parsed<T: serde::de::DeserializeOwned>(value: &Value, key: &str) -> Result<T, String> {
    serde_json::from_value(value.get(key).cloned().ok_or_else(|| format!("selection query lacks {key}"))?).map_err(|error| error.to_string())
}

pub(crate) fn within(file: &str, dirs: &[String]) -> bool {
    dirs.iter().any(|dir| { let dir = dir.trim_end_matches('/'); dir == "." || file == dir || file.strip_prefix(dir).is_some_and(|tail| tail.starts_with('/')) })
}
