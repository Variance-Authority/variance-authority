//! Why a test file loaded a module no case of it entered, read as dominance
//! over the imports the test file actually followed.
//!
//! The rule is `causesOf` in `@variance-authority/distill` before it moved here,
//! kept exactly: the owner of a module is the topmost file on its dominator
//! chain that no case used, that dominates nothing a case used, and that has
//! exactly one way in — a predecessor it does not dominate; a measured module
//! holding only its top level that re-exports all it imports counts as unused.
//! What changes is the cost. Dominance is [`graph_dominators`](crate::graph_dominators)
//! over local ids, "dominates" is a pre/post interval test on the
//! dominator tree, the used marks walk up once with an early stop, and the
//! owner is carried down the tree in reverse postorder: linear in the edges the
//! test file followed, where the walk over strings was quadratic in a hub's
//! loaders and in the depth of the chain.
//!
//! The walk leaves out a file the record holds that this test file did not
//! load: a module mocked with a factory is never evaluated, so its edge is cut,
//! while an automocked one is evaluated and stays. A file the record does not
//! hold is kept, because the record cannot say it was not loaded; keeping it can
//! only turn an owned load into a shared one, never the reverse.

use napi_derive::napi;

use crate::distill_read::{Paths, Record};
use crate::graph_dominators::Dominators;
use crate::journey_graph::JourneyGraph;

const FILE: u8 = 0;
const NONE: u32 = u32::MAX;

/// The file graph, and which of its `EDGE_KINDS` a distillation reads.
#[napi(object, object_to_js = false)]
pub struct DistillGraph {
    pub graph: JourneyGraph,
    /// The edges a runtime evaluates a module through on load: imports, re-exports and assets.
    pub loading: Vec<u32>,
    /// The edge a literal `import()` leaves.
    pub lazy: Vec<u32>,
    /// The re-export edge, which decides a barrel.
    pub reexports: u32,
}

/// The file graph by path id: what each file imports on load and lazily, and whether it is a barrel.
pub(crate) struct FileGraph {
    imports: Vec<(u32, u32)>,
    lazy: Vec<(u32, u32)>,
    targets: Vec<u32>,
    republishes: Vec<bool>,
}

impl FileGraph {
    pub fn new(input: &DistillGraph, paths: &mut Paths) -> Result<FileGraph, String> {
        let graph = &input.graph;
        let (names, kinds) = (&graph.names, &*graph.kinds);
        let (offset, target, kind): (&[u32], &[u32], &[u8]) = (&graph.depends_offset, &graph.depends_target, &graph.depends_kind);
        let nodes = names.len();
        let valid = kinds.len() == nodes
            && offset.len() == nodes + 1
            && target.len() == kind.len()
            && offset.windows(2).all(|pair| pair[0] <= pair[1])
            && offset.last().is_some_and(|last| *last as usize == target.len())
            && target.iter().all(|next| (*next as usize) < nodes);
        if !valid {
            return Err("graph dependencies are invalid".to_owned());
        }
        let mut ids = vec![NONE; nodes];
        for node in 0..nodes {
            if kinds[node] == FILE {
                ids[node] = paths.intern(&names[node]);
            }
        }
        let size = paths.len();
        let mut imports = vec![(0, 0); size];
        let mut lazy = vec![(0, 0); size];
        let mut republishes = vec![false; size];
        let mut targets = Vec::new();
        let mut held = Vec::new();
        for node in 0..nodes {
            let id = ids[node];
            if id == NONE {
                continue;
            }
            let edges = offset[node] as usize..offset[node + 1] as usize;
            let files = || edges.clone().filter(|at| kinds[target[*at] as usize] == FILE);
            let start = targets.len() as u32;
            let mut barrel = None;
            for at in files().filter(|at| input.loading.contains(&(kind[*at] as u32))) {
                targets.push(ids[target[at] as usize]);
                barrel = Some(barrel.unwrap_or(true) && kind[at] as u32 == input.reexports);
            }
            imports[id as usize] = (start, targets.len() as u32);
            republishes[id as usize] = barrel == Some(true);
            held.clear();
            held.extend(files().filter(|at| input.lazy.contains(&(kind[*at] as u32))).map(|at| ids[target[at] as usize]));
            let start = targets.len() as u32;
            targets.extend_from_slice(&held);
            lazy[id as usize] = (start, targets.len() as u32);
        }
        Ok(FileGraph { imports, lazy, targets, republishes })
    }

    fn span(&self, spans: &[(u32, u32)], file: u32) -> &[u32] {
        spans.get(file as usize).map_or(&[], |(from, to)| &self.targets[*from as usize..*to as usize])
    }

    /// The files `file` imports on load, as the graph lists them.
    pub fn imports(&self, file: u32) -> &[u32] {
        self.span(&self.imports, file)
    }

    fn lazily(&self, file: u32) -> &[u32] {
        self.span(&self.lazy, file)
    }

    fn republishes(&self, file: u32) -> bool {
        self.republishes.get(file as usize).copied().unwrap_or(false)
    }
}

/// Why a test file loaded a module no case of it entered.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub(crate) enum Cause {
    Import { importer: u32, imported: u32, lazy: bool },
    Shared { parts: u32 },
    Unseen,
}

/// One thread's working arrays, sized to the path table and reused from one test file to the next.
pub(crate) struct Scratch {
    epoch: u32,
    stamp: Vec<u32>,
    local: Vec<u32>,
    tick: u32,
    seen: Vec<u32>,
    nodes: Vec<u32>,
    spans: Vec<(u32, u32)>,
    successors: Vec<u32>,
    order: Vec<u32>,
    number: Vec<u32>,
    stack: Vec<(u32, u32)>,
    into: Vec<u32>,
    predecessors: Vec<u32>,
    dominators: Dominators,
    entered: Vec<u32>,
    carries: Vec<bool>,
    owner: Vec<u32>,
    importer: Vec<u32>,
}

impl Scratch {
    pub fn new(paths: usize) -> Scratch {
        Scratch {
            epoch: 0,
            stamp: vec![0; paths],
            local: vec![0; paths],
            tick: 0,
            seen: vec![0; paths],
            nodes: Vec::new(),
            spans: Vec::new(),
            successors: Vec::new(),
            order: Vec::new(),
            number: Vec::new(),
            stack: Vec::new(),
            into: Vec::new(),
            predecessors: Vec::new(),
            dominators: Dominators::default(),
            entered: Vec::new(),
            carries: Vec::new(),
            owner: Vec::new(),
            importer: Vec::new(),
        }
    }

    fn local_of(&self, file: u32) -> Option<u32> {
        (self.stamp[file as usize] == self.epoch).then(|| self.local[file as usize])
    }

    fn discover(&mut self, file: u32, record: &Record, graph: &FileGraph, root: u32) -> u32 {
        let local = self.nodes.len() as u32;
        self.stamp[file as usize] = self.epoch;
        self.local[file as usize] = local;
        self.nodes.push(file);
        // An import and a re-export of one module are one way in.
        self.tick = self.tick.wrapping_add(1);
        if self.tick == 0 {
            self.seen.fill(0);
            self.tick = 1;
        }
        let start = self.successors.len() as u32;
        for next in graph.imports(file).iter().chain(graph.lazily(file)) {
            if self.seen[*next as usize] == self.tick {
                continue;
            }
            self.seen[*next as usize] = self.tick;
            let followed = record.row_of(*next).is_none_or(|row| record.loaded_by(row, root));
            if followed {
                self.successors.push(*next);
            }
        }
        self.spans.push((start, self.successors.len() as u32));
        local
    }

    fn reset(&mut self) {
        self.epoch = self.epoch.wrapping_add(1);
        if self.epoch == 0 {
            self.stamp.fill(0);
            self.epoch = 1;
        }
        self.nodes.clear();
        self.spans.clear();
        self.successors.clear();
        self.order.clear();
        self.stack.clear();
    }
}

/// The cause of each of `asked`, the modules no case of `root` entered.
/// `entered` holds every module `root` loaded that declares a function, with how many of its cases entered it.
pub(crate) fn causes_of(
    record: &Record,
    graph: &FileGraph,
    root: u32,
    entered: &[(u32, u32)],
    asked: &[u32],
    scratch: &mut Scratch,
) -> Vec<Cause> {
    let s = scratch;
    s.reset();
    // Postorder by an explicit stack: an import chain is deeper than a call stack likes.
    s.discover(root, record, graph, root);
    s.stack.push((0, 0));
    while let Some(&(node, cursor)) = s.stack.last() {
        let (from, to) = s.spans[node as usize];
        if from + cursor == to {
            s.stack.pop();
            s.order.push(node);
            continue;
        }
        s.stack.last_mut().unwrap().1 += 1;
        let next = s.successors[(from + cursor) as usize];
        if s.local_of(next).is_none() {
            let child = s.discover(next, record, graph, root);
            s.stack.push((child, 0));
        }
    }
    let count = s.nodes.len();
    for at in 0..s.successors.len() {
        s.successors[at] = s.local_of(s.successors[at]).expect("a walk reaches every successor");
    }
    s.number.clear();
    s.number.resize(count, 0);
    for (at, node) in s.order.iter().enumerate() {
        s.number[*node as usize] = at as u32;
    }

    // Each node's predecessors, as a compressed row per node.
    s.into.clear();
    s.into.resize(count + 1, 0);
    for next in &s.successors {
        s.into[*next as usize + 1] += 1;
    }
    for at in 0..count {
        s.into[at + 1] += s.into[at];
    }
    s.predecessors.clear();
    s.predecessors.resize(s.successors.len(), 0);
    {
        let mut fill = s.into.clone();
        for node in 0..count {
            let (from, to) = s.spans[node];
            for next in &s.successors[from as usize..to as usize] {
                s.predecessors[fill[*next as usize] as usize] = node as u32;
                fill[*next as usize] += 1;
            }
        }
    }

    s.dominators.build(&s.order, &s.number, &s.into, &s.predecessors);

    s.entered.clear();
    s.entered.resize(count, NONE);
    for (file, cases) in entered {
        if let Some(local) = s.local_of(*file) {
            s.entered[local as usize] = *cases;
        }
    }
    // A file that dominates a module some case entered carries used code: its import is not removable.
    s.carries.clear();
    s.carries.resize(count, false);
    for node in 1..count {
        if s.entered[node] == NONE || s.entered[node] == 0 {
            continue;
        }
        let mut at = node as u32;
        while at != 0 && !s.carries[at as usize] {
            s.carries[at as usize] = true;
            at = s.dominators.idom(at as usize);
        }
    }

    s.owner.clear();
    s.owner.resize(count, NONE);
    s.importer.clear();
    s.importer.resize(count, NONE);
    for at in (0..s.order.len()).rev() {
        let node = s.order[at] as usize;
        if node == 0 {
            continue;
        }
        let parent = s.dominators.idom(node) as usize;
        if parent != 0 && s.owner[parent] != NONE {
            s.owner[node] = s.owner[parent];
            s.importer[node] = s.importer[parent];
        } else if let Some(way) = qualifies(s, node, record, graph) {
            s.owner[node] = node as u32;
            s.importer[node] = way;
        }
    }

    asked
        .iter()
        .map(|module| {
            let Some(local) = s.local_of(*module).filter(|local| *local != 0) else { return Cause::Unseen };
            let local = local as usize;
            if s.owner[local] == NONE {
                return Cause::Shared { parts: s.nodes[s.dominators.idom(local) as usize] };
            }
            let (importer, imported) = (s.nodes[s.importer[local] as usize], s.nodes[s.owner[local] as usize]);
            // A static import of the same module evaluates it on load, whatever else imports it lazily;
            // removing it moves the load to when the lazy import runs, rather than freeing it.
            Cause::Import { importer, imported, lazy: !graph.imports(importer).contains(&imported) }
        })
        .collect()
}

/// The single way into `node` when it owns what it dominates: unused, carrying no used module, one predecessor it does not dominate.
fn qualifies(s: &Scratch, node: usize, record: &Record, graph: &FileGraph) -> Option<u32> {
    if s.carries[node] {
        return None;
    }
    let unused = match s.entered[node] {
        NONE => {
            // A barrel declares nothing a case could enter, so measured and holding only its top level it is unused
            // too. A file of constants looks the same in the record and a case may read it unrecorded: only a file
            // that re-exports all it imports reads as a barrel.
            let file = s.nodes[node];
            record.row_of(file).is_some_and(|row| row.instrumented && row.only_module) && graph.republishes(file)
        }
        cases => cases == 0,
    };
    if !unused {
        return None;
    }
    // A predecessor `node` dominates closes a cycle back into it; every other one is a way in.
    let mut ways = s.predecessors[s.into[node] as usize..s.into[node + 1] as usize]
        .iter()
        .filter(|from| !s.dominators.dominates(node, **from as usize));
    let way = *ways.next()?;
    ways.next().is_none().then_some(way)
}
