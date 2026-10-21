// The case layer over a module the run cut into more regions than the index
// holds: a newly cut region takes what the region around it held.

import { describe, expect, it } from 'vitest';
import { index, ran, read } from './__fixtures__/case-indexes.js';
import { layerCaseIndex } from './case-layer.js';
import { caseMotion } from './case-motion.js';
import { CrossingSets } from './crossing-sets.js';
import { decodeExecutionIndex } from './execution-format.js';
import { NO_OWNER } from './format-layout.js';
import { encodeSetExecutionIndex, openSetExecutionIndex, type SetExecutionModule } from './execution-set-format.js';
import { repinnedCases } from './milestone-repin.js';

/** A region with its lines: kind, name, first and last line, the cases that called it, and whether it ran while the module loaded. */
type Nested = readonly [kind: string, name: string, lines: readonly [number, number], callers: readonly string[], loaded?: boolean];

/**
 * One module cut into regions that nest, as a function's resumptions sit in its
 * continuation. A region's owner is the one whose path its own extends by one
 * step, the region around it the cut recorded; the outermost has none.
 */
function nestedAt(cases: readonly string[], file: string, regions: readonly Nested[]): Buffer {
  const tests = cases.map((id) => ({ id, file: id.split(' > ')[0]!, name: id.split(' > ')[1]! }));
  const sets = new CrossingSets(tests.length);
  sets.intern([]);
  const at = new Map(cases.map((id, position) => [id, position]));
  const named = new Map(regions.map(([, name], position) => [name, position]));
  const ownerOf = (name: string): number =>
    name === '' ? NO_OWNER : named.get(name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '')!;
  const module: SetExecutionModule = {
    file,
    blocks: regions.map(([kind, name, [startLine, endLine]]) => ({ kind, name, path: name, startLine, endLine, source: true })),
    called: Uint32Array.from(regions, ([, , , callers]) => sets.intern(callers.map((id) => at.get(id)!))),
    loaded: Uint8Array.from(regions, ([, , , , loaded]) => (loaded ? 1 : 0)),
    owner: Uint32Array.from(regions, ([, name]) => ownerOf(name)),
  };
  return encodeSetExecutionIndex({ tests, modules: [module], sets: sets.pool() });
}

describe('a module the run cut into more regions than the index holds', () => {
  const [observe, parity, run] = ['observe.test.ts > reads', 'parity.test.ts > agrees', 'run.test.ts > runs'];
  // The index holds the cut a source build gives; the run loaded only the
  // dist build of the same text, which cuts a resumption inside the
  // continuation, and one inside that, the source build never cut.
  const held = nestedAt([observe, parity, run], 'src/durable.ts', [
    ['module', '', [1, 40], [observe, parity, run]],
    ['function', 'put', [5, 30], [observe, parity, run]],
    ['continuation', 'put/continuation', [10, 29], [observe, parity]],
    ['resume', 'put/continuation/resume', [29, 29], [observe]],
  ]);
  const fresh = nestedAt([run], 'src/durable.ts', [
    ['module', '', [1, 40], [run]],
    ['function', 'put', [5, 30], [run]],
    ['continuation', 'put/continuation', [10, 29], []],
    ['resume', 'put/continuation/born', [12, 16], []],
    ['resume', 'put/continuation/born/inner', [14, 15], []],
    ['resume', 'put/continuation/resume', [29, 29], []],
  ]);

  it('carries the cases of the region around a newly cut one onto it, as the rows take crossings from the region around', () => {
    const { merged } = layerCaseIndex(held, fresh, { ...ran(['run.test.ts']), sameText: () => true });

    expect(read(merged).regions['src/durable.ts']).toEqual({
      '': [observe, parity, run],
      put: [observe, parity, run],
      'put/continuation': [observe, parity],
      'put/continuation/born': [observe, parity],
      'put/continuation/born/inner': [observe, parity],
      'put/continuation/resume': [observe],
    });
  });

  it('carries the load flag of the region around a newly cut one with its cases, as the rows carry `loadedBy` with `testFiles`', () => {
    const loadedHeld = nestedAt([observe, run], 'src/durable.ts', [
      ['module', '', [1, 40], [observe, run], true],
    ]);
    const loadedFresh = nestedAt([run], 'src/durable.ts', [
      ['module', '', [1, 40], [run], true],
      ['function', 'helper', [32, 38], []],
    ]);
    const { merged } = layerCaseIndex(loadedHeld, loadedFresh, { ...ran(['run.test.ts']), sameText: () => true });

    expect(read(merged).regions['src/durable.ts']).toEqual({
      ' (loaded)': [observe, run],
      'helper (loaded)': [observe],
    });
  });

  it('carries the cases of its owner onto a one-line region born on the line a sibling ends, not the sibling\'s', () => {
    // A branch on a sibling's last line sits inside the sibling's lines too;
    // the cut says it is the function's, and the rows take the function's crossings.
    const siblingHeld = nestedAt([observe, parity, run], 'src/durable.ts', [
      ['module', '', [1, 40], [observe, parity, run]],
      ['function', 'put', [5, 30], [observe, parity, run]],
      ['continuation', 'put/first', [6, 12], [observe]],
    ]);
    const siblingFresh = nestedAt([run], 'src/durable.ts', [
      ['module', '', [1, 40], [run]],
      ['function', 'put', [5, 30], [run]],
      ['continuation', 'put/first', [6, 12], []],
      ['branch', 'put/branch', [12, 12], []],
    ]);
    const { merged } = layerCaseIndex(siblingHeld, siblingFresh, { ...ran(['run.test.ts']), sameText: () => true });

    expect(read(merged).regions['src/durable.ts']).toEqual({
      '': [observe, parity, run],
      put: [observe, parity, run],
      'put/first': [observe],
      'put/branch': [observe, parity],
    });
  });

  it('carries the cases of the region around a newly cut one onto it when a repin lays the checkout\'s cases over a newer milestone', () => {
    const repinned = repinnedCases(held, fresh, new Set(['run.test.ts']));

    expect(read(repinned!).regions['src/durable.ts']).toMatchObject({
      'put/continuation/born': [observe, parity],
      'put/continuation/born/inner': [observe, parity],
    });
  });

  it('keeps the owners the run recorded, so a landing that lays its shard\'s index again walks them too', () => {
    const { merged } = layerCaseIndex(held, fresh, { ...ran(['run.test.ts']), sameText: () => true });

    expect(openSetExecutionIndex(merged)!.modules[0]!.owner).toEqual(openSetExecutionIndex(fresh)!.modules[0]!.owner);
  });

  it('moves no case when a run lays one cut, another, and the first again, so a region\'s inherited cases never read as lost or thinned', () => {
    const again = nestedAt([run], 'src/durable.ts', [
      ['module', '', [1, 40], [run]],
      ['function', 'put', [5, 30], [run]],
      ['continuation', 'put/continuation', [10, 29], []],
      ['resume', 'put/continuation/resume', [29, 29], []],
    ]);
    const lay = (previous: Uint8Array, cut: Uint8Array) =>
      layerCaseIndex(previous, cut, { ...ran(['run.test.ts']), sameText: () => true }).merged;
    const first = lay(held, again);
    const second = lay(first, fresh);
    const third = lay(second, again);
    const moved = (base: Uint8Array, now: Uint8Array) =>
      caseMotion(decodeExecutionIndex(base), decodeExecutionIndex(now), { diff: new Map() }).regions;

    expect(read(second).regions['src/durable.ts']!['put/continuation/born']).toEqual([observe, parity]);
    expect([moved(first, second), moved(second, third), moved(first, third)]).toEqual([[], [], []]);
  });

  it('keeps the owners of a module the run did not record, as the index stored them', () => {
    const elsewhere = index([run], { 'src/elsewhere.ts': [['', [run]]] });
    const { merged } = layerCaseIndex(held, elsewhere, ran(['run.test.ts']));

    const kept = openSetExecutionIndex(merged)!.modules.find((module) => module.file === 'src/durable.ts');
    expect(kept!.owner).toEqual(openSetExecutionIndex(held)!.modules[0]!.owner);
  });
});
