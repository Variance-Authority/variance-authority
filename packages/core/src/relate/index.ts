/**
 * `core/relate` — what reaches what.
 *
 * A typed, interned, bidirectional graph and the two traversals over it, plus the
 * file-shaped record the scanner produces and the fold that turns a pile of them
 * into the structure. No I/O, no parser, no resolver: the expensive half belongs
 * to whoever owns the disk, and this is the half that has to be fast and has to
 * be provable without one.
 *
 * See [`docs/selecting.md`](../../../../docs/selecting.md) for what it is for.
 */

export {
  EDGE_KINDS,
  NODE_KINDS,
  RUNTIME_EDGES,
  idOf,
  keyOf,
  nodeAt,
  nodesOfKind,
  relationsOf,
  type Adjacency,
  type EdgeKind,
  type Node,
  type NodeId,
  type NodeKind,
  type Relation,
  type Relations,
} from './graph.js';

export {
  beforeReach,
  movedBefore,
  within,
  type BeforeReach,
  type BeforeReachOptions,
} from './before.js';

export {
  dependenciesOf,
  dependentsOf,
  trailOf,
  type Reach,
  type ReachOptions,
} from './reach.js';

export {
  CLOSURE_EDGES,
  closureOf,
  driftedBetween,
  type Closure,
  type ClosureInput,
  type Drift,
} from './merkle.js';

export {
  explain,
  movedBy,
  relationsOfFiles,
  type FileEdge,
  type FileRecord,
  type Hole,
  type MovedOptions,
  type PackageEdge,
  type RelationsOptions,
  type Reached,
} from './records.js';
