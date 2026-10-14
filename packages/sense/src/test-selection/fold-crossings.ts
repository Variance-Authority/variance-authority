import type { CoverageBlock } from './index.js';
import { crossedBlock, orderedCrossingBlock } from './merge-carry.js';

interface CrossingUnion {
  join(held: ReadonlySet<string> | undefined, input: readonly string[] | undefined): ReadonlySet<string>;
  block(block: CoverageBlock, entered: ReadonlySet<string>, loaded: ReadonlySet<string>): CoverageBlock;
}

/** One fold's shared input sets and their unions, kept immutable between regions. */
export function crossingUnion(): CrossingUnion {
  const empty: ReadonlySet<string> = new Set();
  const inputs = new WeakMap<readonly string[], ReadonlySet<string>>();
  const unions = new WeakMap<ReadonlySet<string>, WeakMap<ReadonlySet<string>, ReadonlySet<string>>>();
  const rows = new WeakMap<ReadonlySet<string>, WeakMap<ReadonlySet<string>, CoverageBlock>>();
  const inputSet = (input: readonly string[] | undefined): ReadonlySet<string> => {
    if (input === undefined || input.length === 0) return empty;
    let found = inputs.get(input);
    if (found === undefined) inputs.set(input, (found = new Set(input)));
    return found;
  };
  return {
    join(held, input) {
      const added = inputSet(input);
      if (held === undefined || held.size === 0) return added;
      if (added.size === 0 || held === added) return held;
      let byAdded = unions.get(held);
      if (byAdded === undefined) unions.set(held, (byAdded = new WeakMap()));
      let joined = byAdded.get(added);
      if (joined === undefined) {
        const made = new Set(held);
        for (const file of added) made.add(file);
        byAdded.set(added, (joined = made));
      }
      return joined;
    },
    block(block, entered, loaded) {
      let byLoaded = rows.get(entered);
      if (byLoaded === undefined) rows.set(entered, (byLoaded = new WeakMap()));
      let row = byLoaded.get(loaded);
      if (row === undefined) {
        row = crossedBlock(block, entered, loaded);
        byLoaded.set(loaded, row);
      }
      return orderedCrossingBlock(block, row.testFiles, row.loadedBy ?? []);
    },
  };
}
