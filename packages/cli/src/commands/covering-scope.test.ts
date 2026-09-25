import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFlags } from '../args.js';
import { parseCoveringArgs } from '../covering-args.js';
import { OperatorError } from '../exit.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { caseLayerFiles, encodeExecutionIndex } from '@variance-authority/sense/test-selection';
import { covering, formatCovering } from './covering.js';
import { keepCases } from './covering-scope.js';

const INDEX = {
  tests: [
    { id: 'total.test.ts > discounts', file: 'total.test.ts', name: 'discounts' },
    { id: 'flow.test.tsx > checks out', file: 'flow.test.tsx', name: 'checks out' },
  ],
  modules: [{
    file: 'src/total.ts',
    blocks: [
      {
        kind: 'function', name: 'applyDiscount', path: 'entry', startLine: 10, endLine: 20,
        source: true, crossings: [{ test: 0, distance: 0 }, { test: 1, distance: 0 }],
      },
      {
        kind: 'function', name: 'round', path: 'entry', startLine: 30, endLine: 34,
        source: true, crossings: [{ test: 1, distance: 0 }],
      },
    ],
  }],
};

/** An index as a run leaves it, with the last run named beside it when given. */
async function recorded(last?: { readonly cases: readonly string[]; readonly commit?: string }): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'variance-covering-scope-'));
  const file = join(dir, 'cases.bin');
  await writeFile(file, encodeExecutionIndex(INDEX));
  if (last !== undefined) {
    await writeFile(caseLayerFiles(file).last, JSON.stringify({ at: '2026-09-25T00:00:00.000Z', files: [], ...last }));
  }
  return file;
}

function parse(argv: readonly string[]) {
  return parseCoveringArgs(readFlags(argv, 'covering', flagsFor('covering'), synopsisFor('covering')));
}

describe('a test read alone', () => {
  it('answers from the cases of the last run, and says so before anything else', async () => {
    const execution = await recorded({ cases: ['total.test.ts > discounts'], commit: 'abcdef0123456789' });

    const answer = await covering(parse(['--file', 'src/total.ts', '--cases', 'last', '--execution', execution]));

    expect(answer.scope).toEqual({ cases: 'last', tests: ['total.test.ts > discounts'], at: 'abcdef0123456789' });
    expect(answer.ranges?.map((range) => [range.startLine, range.tests.map((test) => test.id)])).toEqual([
      [10, ['total.test.ts > discounts']],
      [30, []],
    ]);
    const text = formatCovering(answer, 'text');
    expect(text.split('\n')[0]).toBe('Read from the 1 case of the last run at abcdef012345, not the whole suite.');
    expect(JSON.parse(formatCovering(answer, 'json')).scope.tests).toEqual(['total.test.ts > discounts']);
  });

  it('answers from every case of one test file', async () => {
    const execution = await recorded();

    const answer = await covering(parse(['--file', 'src/total.ts', '--line', '31', '--cases', 'flow.test.tsx', '--execution', execution]));

    expect(answer.tests?.map((test) => test.id)).toEqual(['flow.test.tsx > checks out']);
    expect(answer.scope).toEqual({ cases: 'flow.test.tsx', tests: ['flow.test.tsx > checks out'] });
  });

  it('refuses a test file the index holds no case of, and points at the spelling it does', async () => {
    const execution = await recorded();

    await expect(covering(parse(['--file', 'src/total.ts', '--cases', 'e2e/flow.test.tsx', '--execution', execution])))
      .rejects.toThrow(/names no test file.*`flow.test.tsx`/);
  });

  it('refuses `last` when no run named itself beside the index', async () => {
    const execution = await recorded();

    await expect(covering(parse(['--file', 'src/total.ts', '--cases', 'last', '--execution', execution])))
      .rejects.toThrow(OperatorError);
  });

  it('refuses a scope on a review, which a code host would show as the suite', () => {
    expect(() => parse(['--since', 'main', '--cases', 'last', '--format', 'github'])).toThrow(/takes no `--cases`/);
  });

  it('renumbers the crossings of the cases it keeps', () => {
    const kept = keepCases(INDEX, new Set(['flow.test.tsx > checks out']));

    expect(kept.tests.map((test) => test.id)).toEqual(['flow.test.tsx > checks out']);
    expect(kept.modules[0]!.blocks.map((block) => block.crossings.map((crossing) => crossing.test))).toEqual([[0], [0]]);
  });
});
