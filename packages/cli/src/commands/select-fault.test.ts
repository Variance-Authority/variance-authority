import { describe, expect, it } from 'vitest';
import type { ExecutionBlock, ExecutionIndex } from '@variance-authority/sense/test-selection';
import { faultSelection } from './select-fault.js';

/**
 * A run with one region skipped runs the cases that entered it, and no other:
 * a case that never entered the region cannot see it skipped.
 */
describe('the cases a run with a region skipped runs', () => {
  const ALPHA = 'test/alpha.test.ts';
  const BETA = 'test/beta.test.ts';
  const GAMMA = 'test/gamma.test.ts';
  const tests: ExecutionIndex['tests'] = [
    { id: 'alpha > calls widget', file: ALPHA, name: 'calls widget', stopped: false },
    { id: 'alpha > calls other', file: ALPHA, name: 'calls other', stopped: false },
    { id: 'beta > calls other', file: BETA, name: 'calls other', stopped: false },
    { id: 'gamma > calls widget', file: GAMMA, name: 'calls widget', stopped: false },
  ];
  const block = (name: string, startLine: number, endLine: number, crossings: ExecutionBlock['crossings']): ExecutionBlock => ({
    kind: 'function', name, path: 'entry', startLine, endLine, source: true, crossings,
  });
  const index: ExecutionIndex = {
    tests,
    modules: [{
      file: 'src/widget.ts',
      blocks: [
        block('', 1, 9, []),
        block('widget', 1, 3, [{ test: 0, distance: 0 }, { test: 3, distance: 0 }]),
        block('other', 5, 7, [{ test: 1, distance: 0 }, { test: 2, distance: 0 }]),
      ],
    }],
  };

  it('skips the files no case of which entered the region, and the other cases of those that did', () => {
    const selection = faultSelection([ALPHA, BETA, GAMMA], index, { file: 'src/widget.ts', ordinal: 1 });

    expect(selection.declined).toBeUndefined();
    expect([...selection.skip]).toEqual([BETA]);
    expect(selection.cases).toEqual(new Map([[ALPHA, ['calls other']]]));
  });

  it('runs a file the record does not hold whole', () => {
    const selection = faultSelection([ALPHA, GAMMA], index, { file: 'src/widget.ts', ordinal: 2 });

    expect([...selection.skip]).toEqual([GAMMA]);
  });

  it('declines, skipping nothing, when the record holds no such region', () => {
    const selection = faultSelection([ALPHA, BETA, GAMMA], index, { file: 'src/widget.ts', ordinal: 7 });

    expect(selection.skip.size).toBe(0);
    expect(selection.declined).toBe('the record holds no region 7 of src/widget.ts, so every case runs');
  });
});
