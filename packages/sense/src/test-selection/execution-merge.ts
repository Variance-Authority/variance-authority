import { settledAcross } from './cases.js';
import type {
  ExecutionBlock,
  ExecutionCrossing,
  ExecutionIndex,
  ExecutionModule,
  ExecutionTest,
} from './reverse.js';

interface HeldCrossing {
  readonly test: number;
  readonly distance: number;
  readonly loaded: boolean;
}

type Shape = Omit<ExecutionBlock, 'crossings'>;

/**
 * Assemble independently recorded execution indexes into one deterministic relation.
 *
 * Two shards can cut one file's regions apart — two projects transforming it
 * differently — and a block's place in the list then names a different region
 * in each. Such a file is read at the regions every shard holds: see
 * {@link reconcileRegions}.
 */
export function mergeExecutionIndexes(indexes: readonly ExecutionIndex[]): ExecutionIndex {
  const tests = collectTests(indexes);
  const testById = new Map(tests.map((test, at) => [test.id, at]));
  const inventories = new Map<string, Map<string, readonly Shape[]>>();
  for (const index of indexes) {
    for (const module of index.modules) {
      const shape = module.blocks.map(withoutCrossings);
      const held = inventories.get(module.file) ?? new Map<string, readonly Shape[]>();
      held.set(inventoryKey(shape), shape);
      inventories.set(module.file, held);
    }
  }
  const modules = new Map<string, {
    readonly blocks: readonly Shape[];
    readonly lands: ReadonlyMap<string, readonly number[]>;
    readonly crossings: Map<number, Map<number, HeldCrossing>>;
  }>();
  for (const [file, held] of inventories) {
    const keys = [...held.keys()];
    const reconciled = reconcileRegions(keys.map((key) => held.get(key)!));
    modules.set(file, {
      blocks: reconciled.blocks,
      lands: new Map(keys.map((key, at) => [key, reconciled.lands[at]!])),
      crossings: new Map(),
    });
  }

  for (const index of indexes) {
    for (const module of index.modules) {
      const target = modules.get(module.file)!;
      const lands = target.lands.get(inventoryKey(module.blocks.map(withoutCrossings)))!;
      for (const [own, block] of module.blocks.entries()) {
        const blockAt = lands[own]!;
        const byTest = target.crossings.get(blockAt) ?? new Map<number, HeldCrossing>();
        for (const crossing of block.crossings) {
          const local = index.tests[crossing.test];
          if (local === undefined) {
            throw new Error(`cannot assemble journey artifacts: crossing names missing test ${crossing.test}`);
          }
          if (!Number.isInteger(crossing.distance) || crossing.distance < 0) {
            throw new Error(`cannot assemble journey artifacts: crossing has invalid distance ${crossing.distance}`);
          }
          const test = testById.get(local.id)!;
          const before = byTest.get(test);
          byTest.set(test, {
            test,
            distance: Math.min(before?.distance ?? crossing.distance, crossing.distance),
            loaded: (before?.loaded ?? true) && crossing.loaded === true,
          });
        }
        target.crossings.set(blockAt, byTest);
      }
    }
  }

  return {
    tests,
    modules: [...modules]
      .sort(([left], [right]) => codeUnitOrder(left, right))
      .map(([file, { blocks, crossings }]): ExecutionModule => ({
        file,
        blocks: blocks.map((block, at): ExecutionBlock => ({
          ...block,
          crossings: [...(crossings.get(at)?.values() ?? [])]
            .sort((left, right) => left.test - right.test)
            .map(({ test, distance, loaded }): ExecutionCrossing => ({
              test,
              distance,
              ...(loaded ? { loaded: true } : {}),
            })),
        })),
      })),
  };
}

/**
 * Several inventories of one source text, read at the regions they all hold.
 *
 * A region only some inventories cut lands on the innermost shared source
 * region enclosing it, and on one region spanning the file only when nothing
 * does. That is where a changed line resolves: a shared region is in every
 * inventory and one inventory's regions nest, so every case that ran the line
 * is credited on the region the change will find. The native stitch applies
 * the same rule; this is its reading for indexes already in memory.
 */
// TODO: keep each build's own regions and read a case's ordinals against the build that cut them — needs the case journal to name that build.
function reconcileRegions(inventories: readonly (readonly Shape[])[]): {
  readonly blocks: readonly Shape[];
  readonly lands: readonly (readonly number[])[];
} {
  if (inventories.length === 1) {
    return { blocks: inventories[0]!, lands: [inventories[0]!.map((_, at) => at)] };
  }
  const base = [...inventories].sort(inventoryOrder)[0] ?? [];
  const held = inventories.map((inventory) => new Set(inventory.map(regionKey)));
  const blocks: Shape[] = [];
  const at = new Map<string, number>();
  for (const block of base) {
    const key = regionKey(block);
    if (!at.has(key) && held.every((keys) => keys.has(key))) {
      at.set(key, blocks.length);
      blocks.push(block);
    }
  }
  const shared = blocks.slice();
  let whole: number | undefined;
  const lands = inventories.map((inventory) => inventory.map((block) => {
    const found = at.get(regionKey(block)) ?? enclosing(shared, block);
    if (found !== undefined) return found;
    whole ??= blocks.push(wholeFile(inventories, base[0])) - 1;
    return whole;
  }));
  return { blocks, lands };
}

function enclosing(shared: readonly Shape[], block: Shape): number | undefined {
  let best: number | undefined;
  for (const [at, outer] of shared.entries()) {
    if (!outer.source || outer.startLine > block.startLine || block.endLine > outer.endLine) continue;
    const held = best === undefined ? undefined : shared[best]!;
    if (held === undefined || outer.endLine - outer.startLine < held.endLine - held.startLine) best = at;
  }
  return best;
}

function wholeFile(inventories: readonly (readonly Shape[])[], first: Shape | undefined): Shape {
  const sourced = inventories.flat().filter((block) => block.source);
  const source = sourced.length > 0;
  return {
    kind: 'module',
    name: first?.name ?? '',
    path: first?.path ?? '',
    startLine: source ? Math.min(...sourced.map((block) => block.startLine)) : first?.startLine ?? 0,
    endLine: source ? Math.max(...sourced.map((block) => block.endLine)) : first?.endLine ?? 0,
    source,
  };
}

function regionKey(block: Shape): string {
  return JSON.stringify([block.kind, block.name, block.path, block.startLine, block.endLine, block.source]);
}

function inventoryKey(inventory: readonly Shape[]): string {
  return JSON.stringify(inventory.map(regionKey));
}

function inventoryOrder(left: readonly Shape[], right: readonly Shape[]): number {
  if (left.length !== right.length) return left.length - right.length;
  for (const [at, block] of left.entries()) {
    const other = right[at]!;
    const ordered = block.startLine - other.startLine ||
      block.endLine - other.endLine ||
      Number(block.source) - Number(other.source) ||
      codeUnitOrder(block.kind, other.kind) ||
      codeUnitOrder(block.name, other.name) ||
      codeUnitOrder(block.path, other.path);
    if (ordered !== 0) return ordered;
  }
  return 0;
}

function collectTests(indexes: readonly ExecutionIndex[]): readonly ExecutionTest[] {
  const tests = new Map<string, ExecutionTest>();
  for (const index of indexes) {
    for (const test of index.tests) {
      const before = tests.get(test.id);
      if (before !== undefined && (before.file !== test.file || before.name !== test.name)) {
        throw new Error(`cannot assemble journey artifacts: test id ${JSON.stringify(test.id)} names two tests`);
      }
      const stopped = settledAcross(before?.stopped, test.stopped);
      const { stopped: _stopped, ...coordinate } = test;
      tests.set(test.id, { ...coordinate, ...stopped });
    }
  }
  return [...tests.values()].sort((left, right) =>
    codeUnitOrder(left.id, right.id) ||
    codeUnitOrder(left.file, right.file) ||
    codeUnitOrder(left.name, right.name));
}

function withoutCrossings(block: ExecutionBlock): Shape {
  const { crossings: _crossings, ...shape } = block;
  return shape;
}

function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
