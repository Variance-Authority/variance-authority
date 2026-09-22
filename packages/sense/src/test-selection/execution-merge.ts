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

/** Assemble independently recorded execution indexes into one deterministic relation. */
export function mergeExecutionIndexes(indexes: readonly ExecutionIndex[]): ExecutionIndex {
  const tests = collectTests(indexes);
  const testById = new Map(tests.map((test, at) => [test.id, at]));
  const modules = new Map<string, { readonly shape: ExecutionModule; readonly crossings: Map<number, Map<number, HeldCrossing>> }>();

  for (const index of indexes) {
    for (const module of index.modules) {
      const held = modules.get(module.file);
      if (held !== undefined && !sameShape(held.shape, module)) {
        throw new Error(`cannot assemble journey artifacts: ${module.file} has incompatible region inventories`);
      }
      const target = held ?? {
        shape: module,
        crossings: new Map<number, Map<number, HeldCrossing>>(),
      };
      modules.set(module.file, target);

      for (const [blockAt, block] of module.blocks.entries()) {
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
    modules: [...modules.values()]
      .sort((left, right) => codeUnitOrder(left.shape.file, right.shape.file))
      .map(({ shape, crossings }): ExecutionModule => ({
        file: shape.file,
        blocks: shape.blocks.map((block, at): ExecutionBlock => ({
          ...withoutCrossings(block),
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

function collectTests(indexes: readonly ExecutionIndex[]): readonly ExecutionTest[] {
  const tests = new Map<string, ExecutionTest>();
  for (const index of indexes) {
    for (const test of index.tests) {
      const before = tests.get(test.id);
      if (before !== undefined && (before.file !== test.file || before.name !== test.name)) {
        throw new Error(`cannot assemble journey artifacts: test id ${JSON.stringify(test.id)} names two tests`);
      }
      tests.set(test.id, test);
    }
  }
  return [...tests.values()].sort((left, right) =>
    codeUnitOrder(left.id, right.id) ||
    codeUnitOrder(left.file, right.file) ||
    codeUnitOrder(left.name, right.name));
}

function sameShape(left: ExecutionModule, right: ExecutionModule): boolean {
  return left.blocks.length === right.blocks.length && left.blocks.every((block, at) => {
    const other = right.blocks[at];
    return other !== undefined &&
      block.kind === other.kind &&
      block.name === other.name &&
      block.path === other.path &&
      block.startLine === other.startLine &&
      block.endLine === other.endLine &&
      block.source === other.source;
  });
}

function withoutCrossings(block: ExecutionBlock): Omit<ExecutionBlock, 'crossings'> {
  const { crossings: _crossings, ...shape } = block;
  return shape;
}

function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
