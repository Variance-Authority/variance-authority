import {
  EDGE_KINDS,
  NODE_KINDS,
  keyOf,
  type Adjacency,
  type FileRecord,
  type NodeId,
  type Relations,
} from '@variance-authority/core/relate';
import {
  NONE,
  encodeSegment,
  openSegment,
  stringColumns,
  stringReader,
  validateOffsets,
} from '@variance-authority/core/segment';
import { treeAtWorkspace, treeFromRelations, type Tree } from './tree.js';

const FORMAT = 'variance-authority-source-tree';
const VERSION = 1;
const WHAT = 'source tree';

/** Encode the path graph a source question needs, without parse-cache columns. */
export function encodeSourceTree(records: readonly FileRecord[]): Uint8Array {
  const files = new Set<string>();
  for (const record of records) {
    files.add(record.file);
    for (const edge of record.edges ?? []) files.add(edge.to);
  }
  const paths = [...files].sort(codeUnit);
  const at = new Map(paths.map((path, index) => [path, index]));
  const byFile = new Map(records.map((record) => [record.file, record]));
  const strings = [...new Set([
    ...paths,
    ...records.flatMap((record) => record.unknown === undefined ? [] : [record.unknown]),
  ])].sort(codeUnit);
  const ids = new Map(strings.map((value, index) => [value, index]));
  const { blob, off } = stringColumns(strings);
  const offsets = new Uint32Array(paths.length + 1);
  const targets: number[] = [];
  const kinds: number[] = [];
  const unknown = new Uint32Array(paths.length).fill(NONE);

  for (const [row, path] of paths.entries()) {
    offsets[row] = targets.length;
    const record = byFile.get(path);
    const edges = [...record?.edges ?? []]
      .map((edge) => ({ target: at.get(edge.to), kind: EDGE_KINDS.indexOf(edge.kind) }))
      .filter((edge): edge is { readonly target: number; readonly kind: number } =>
        edge.target !== undefined && edge.kind !== -1)
      .sort((left, right) => left.target - right.target || left.kind - right.kind);
    let previous = '';
    for (const edge of edges) {
      const key = `${edge.target}:${edge.kind}`;
      if (key === previous) continue;
      previous = key;
      targets.push(edge.target);
      kinds.push(edge.kind);
    }
    if (record?.unknown !== undefined) unknown[row] = ids.get(record.unknown)!;
  }
  offsets[paths.length] = targets.length;

  return encodeSegment(FORMAT, VERSION, {
    'strings.blob': blob,
    'strings.off': off,
    'files.path': Uint32Array.from(paths, (path) => ids.get(path)!),
    'files.unknown': unknown,
    'edges.offset': offsets,
    'edges.target': Uint32Array.from(targets),
    'edges.kind': Uint8Array.from(kinds),
  });
}

/** Open a published path graph without materializing source-index records. */
export function decodeSourceTree(input: Uint8Array, root: string, workspace = root): Tree {
  const opened = openSegment(FORMAT, VERSION, input, WHAT);
  const strings = stringReader(opened.u8('strings.blob'), opened.u32('strings.off'), opened.reject).text;
  const pathIds = opened.u32('files.path');
  const unknownIds = opened.u32('files.unknown');
  const offset = opened.u32('edges.offset');
  const target = opened.u32('edges.target');
  const kind = opened.u8('edges.kind');
  validateOffsets(offset, target.length, pathIds.length, opened.reject);
  if (unknownIds.length !== pathIds.length || kind.length !== target.length) throw opened.reject();

  const names = [...pathIds].map(strings);
  const fileKind = NODE_KINDS.indexOf('file');
  const kinds = new Uint8Array(names.length).fill(fileKind);
  const unknown = new Uint8Array(names.length);
  const reasons = new Map<NodeId, string>();
  const index = new Map<string, NodeId>();
  for (let id = 0; id < names.length; id += 1) {
    index.set(keyOf('file', names[id]!), id);
    const reason = unknownIds[id];
    if (reason !== NONE) {
      unknown[id] = 1;
      reasons.set(id, strings(reason!));
    }
  }
  for (const id of target) if (id >= names.length) throw opened.reject();
  for (const edge of kind) if (EDGE_KINDS[edge] === undefined) throw opened.reject();

  const depends: Adjacency = { offset, target, kind };
  const dependents = transpose(depends, names.length);
  const relations: Relations = {
    names,
    kinds,
    depends,
    dependents,
    unknown,
    reasons,
    index,
    shadows: new Map(),
  };
  return treeAtWorkspace(treeFromRelations(relations, root), workspace);
}

function transpose(source: Adjacency, nodes: number): Adjacency {
  const counts = new Uint32Array(nodes);
  for (const target of source.target) counts[target]! += 1;
  const offset = new Uint32Array(nodes + 1);
  for (let id = 0; id < nodes; id += 1) offset[id + 1] = offset[id]! + counts[id]!;
  const cursor = offset.slice(0, nodes);
  const target = new Uint32Array(source.target.length);
  const kind = new Uint8Array(source.kind.length);
  for (let from = 0; from < nodes; from += 1) {
    for (let edge = source.offset[from]!; edge < source.offset[from + 1]!; edge += 1) {
      const to = source.target[edge]!;
      const at = cursor[to]!++;
      target[at] = from;
      kind[at] = source.kind[edge]!;
    }
  }
  return { offset, target, kind };
}

function codeUnit(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
