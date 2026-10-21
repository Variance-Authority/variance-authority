import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  encodeExecutionIndex,
  writeTestCoverage,
  type ExecutionIndex,
} from '@variance-authority/sense/test-selection';
import { INSTRUMENTATION_ID } from '@variance-authority/sense/instrument';
import { readFlags } from '../args.js';
import { parseCoveringArgs } from '../covering-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { covering, formatCovering } from './covering.js';

/**
 * A per-case index that holds the file beside a snapshot that holds no
 * instrumented row of it: the two are from different runs, so no test file's
 * distance can be read. The snapshot is stood in for, since one run writes both.
 */
vi.mock('./covering-frame.js', async (original) => ({
  ...await original<typeof import('./covering-frame.js')>(),
  snapshotFor: async () => '/records/coverage.bin',
  placementFor: async () => undefined,
}));
vi.mock('./source-graph.js', () => ({ relationsFor: async () => ({}) }));
vi.mock('@variance-authority/sense/test-selection', async (original) => ({
  ...await original<typeof import('@variance-authority/sense/test-selection')>(),
  distanceToSource: async () => ({ audience: { recorded: false }, distances: [] }),
}));

const INDEX: ExecutionIndex = {
  tests: [{ id: 'a.test.ts > adds', file: 'a.test.ts', name: 'adds' }, { id: 'b.test.ts > rounds', file: 'b.test.ts', name: 'rounds' }],
  modules: [{
    file: 'src/cart.ts',
    blocks: [{ kind: 'function', name: 'total', path: 'entry', startLine: 1, endLine: 3, source: true, crossings: [{ test: 0, distance: 0 }, { test: 1, distance: 0 }] }],
  }],
};

async function ask(argv: readonly string[]) {
  const root = await mkdtemp(join(tmpdir(), 'variance-covering-hops-'));
  const execution = join(root, 'coverage.bin');
  await writeTestCoverage(execution, { version: 3, instrumentation: INSTRUMENTATION_ID, tests: [], modules: [] }, {
    index: encodeExecutionIndex(INDEX),
  });
  return covering(parseCoveringArgs(readFlags(
    ['--file', 'src/cart.ts', '--line', '2', '--execution', execution, '--root', root, ...argv],
    'covering', flagsFor('covering'), synopsisFor('covering'),
  )));
}

const UNREAD = 'import hops are unmeasured: the coverage snapshot at /records/coverage.bin holds no instrumented row for src/cart.ts, '
  + 'though the per-case index holds it, so the two are from different runs and no test file\'s distance can be read';

describe('import hops a snapshot from another run cannot measure', () => {
  it('keeps no test under `--at-distance`, and says why rather than refusing', async () => {
    const answer = await ask(['--at-distance', '0-3']);

    expect(answer.tests).toEqual([]);
    expect(answer.narrowed).toEqual({ kept: 0, of: 2, notes: [UNREAD] });
    expect(formatCovering(answer, 'text')).toContain(`0 of 2 named tests kept.\n  ${UNREAD}\n`);
    expect(formatCovering(answer, 'text')).not.toMatch(/record once|ask again/);
  });

  it('lists the test files with no hops under `--hops`, and says why', async () => {
    const answer = await ask(['--hops']);

    expect(answer.files?.map((file) => [file.file, file.hops])).toEqual([['a.test.ts', undefined], ['b.test.ts', undefined]]);
    expect(answer.hopsGap).toBe(UNREAD);
    expect(formatCovering(answer, 'text')).toContain(`\nImport${UNREAD.slice('import'.length)}.\n`);
    expect(formatCovering(answer, 'refs')).toContain(`\nImport${UNREAD.slice('import'.length)}.\n`);
  });
});
