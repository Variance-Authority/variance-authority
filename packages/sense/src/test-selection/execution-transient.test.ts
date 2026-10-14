import { expect, it } from 'vitest';
import { decodeExecutionIndex } from './execution-format.js';
import { calledCases, encodeAsSetExecutionIndex } from './execution-set-format.js';

it('opens set crossings on demand without retaining their expanded arrays', () => {
  const original = {
    tests: [{ id: 'one', file: 'a.test.ts', name: 'one', stopped: false }],
    modules: [{ file: 'a.ts', blocks: [{ kind: 'function', name: 'f', path: 'f',
      startLine: 1, endLine: 2, source: true, loaded: true as const,
      crossings: [{ test: 0, distance: 0 }] }] }],
  };
  const decoded = decodeExecutionIndex(encodeAsSetExecutionIndex(original), { crossings: 'transient' });
  const block = decoded.modules[0]!.blocks[0]!;
  expect(Object.getOwnPropertyDescriptor(block, 'crossings')?.get).toBeTypeOf('function');
  expect(decoded).toEqual(original);
  expect(block.crossings).not.toBe(block.crossings);
});

it('reads identical called sets once without expanding crossing objects', () => {
  const region = { kind: 'function', name: 'f', path: 'f', startLine: 1, endLine: 2,
    source: true, crossings: [{ test: 0, distance: 0 }] };
  const bytes = encodeAsSetExecutionIndex({
    tests: [{ id: 'one', file: 'a.test.ts', name: 'one', stopped: false }],
    modules: [{ file: 'a.ts', blocks: [region, { ...region, name: 'g' }, { ...region, kind: 'module' }] }],
  });
  const module = decodeExecutionIndex(bytes, { crossings: 'transient' }).modules[0]!;
  for (const block of module.blocks) Object.defineProperty(block, 'crossings', {
    get() { throw new Error('expanded crossing objects'); },
  });
  expect([...calledCases(module)]).toEqual([0]);
});

it('selects called cases equally from default, transient and object recordings', () => {
  const region = { kind: 'function', name: 'f', path: 'f', startLine: 1, endLine: 2,
    source: true, crossings: [{ test: 0, distance: 0 }, { test: 1, distance: 0, loaded: true as const }] };
  const original = {
    tests: [0, 1, 2].map((id) => ({ id: String(id), file: 'a.test.ts', name: String(id), stopped: false })),
    modules: [{ file: 'a.ts', blocks: [region, { ...region, kind: 'module',
      crossings: [{ test: 2, distance: 0 }] }] }],
  };
  const bytes = encodeAsSetExecutionIndex(original);
  const normal = decodeExecutionIndex(bytes);
  const transient = decodeExecutionIndex(bytes, { crossings: 'transient' });
  expect(transient).toEqual(normal);
  for (const index of [original, normal, transient]) {
    expect([...calledCases(index.modules[0]!)]).toEqual([0]);
  }
});
