/** The Tree surface over Rust-owned graph state; only query answers cross the boundary. */
import type { NativeSourceTreeReader, NativeSourceTreeWalk } from '@variance-authority/sense';
import type { Tree } from './tree.js';

function distances(walk: NativeSourceTreeWalk): ReadonlyMap<string, number> {
  const files = walk.files();
  const values = walk.distances();
  return new Map(files.map((file, at) => [file, values[at]!]));
}

export function treeFromNative(reader: NativeSourceTreeReader, root: string): Tree {
  return {
    root,
    files: new Set(reader.files()),
    reachedFrom: (seeds) => new Set(reader.walk([...seeds], false, false).files()),
    reaching: (seeds) => new Set(reader.walk([...seeds], true, false).files()),
    distanceFrom: (seeds) => distances(reader.walk([...seeds], false, false)),
    distanceTo: (seeds) => distances(reader.walk([...seeds], true, false)),
    unknownAmong: (files) => reader.unknownAmong([...files]),
    hopsFrom: (seeds) => distances(reader.walk([...seeds], false, true)),
    hopsTo: (seeds) => distances(reader.walk([...seeds], true, true)),
    chainsTo: (seeds) => {
      const walk = reader.walk([...seeds], true, false);
      return {
        distance: distances(walk),
        chain: (file) => walk.chain(file),
      };
    },
  };
}
