import { EDGE_KINDS, type FileRecord } from '@variance-authority/core/relate';
import { NONE, encodeSegment, intern, stringColumns } from '@variance-authority/core/segment';
import { openSourceTree } from '@variance-authority/sense';
import { treeFromNative } from './native-tree.js';
import { treeAtWorkspace, type Tree } from './tree.js';

const FORMAT = 'variance-authority-source-tree';
/** 2: the tree carries what tests load for real beside their mocks. */
const VERSION = 2;

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
  const { strings, id } = intern([
    ...paths,
    ...records.flatMap((record) => record.unknown === undefined ? [] : [record.unknown]),
  ]);
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
    if (record?.unknown !== undefined) unknown[row] = id(record.unknown);
  }
  offsets[paths.length] = targets.length;

  return encodeSegment(FORMAT, VERSION, {
    'strings.blob': blob,
    'strings.off': off,
    'files.path': Uint32Array.from(paths, id),
    'files.unknown': unknown,
    'edges.offset': offsets,
    'edges.target': Uint32Array.from(targets),
    'edges.kind': Uint8Array.from(kinds),
  });
}

/** Open a published path graph without materializing source-index records. */
export function decodeSourceTree(input: Uint8Array, root: string, workspace = root): Tree {
  return treeAtWorkspace(treeFromNative(openSourceTree(input), root), workspace);
}

function codeUnit(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
