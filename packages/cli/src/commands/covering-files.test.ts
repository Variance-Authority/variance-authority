import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFlags } from '../args.js';
import { parseCoveringArgs } from '../covering-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { covering, formatCovering } from './covering.js';
import { coveringFiles } from './covering-files.js';

const INDEX = {
  tests: [
    { id: 'total.test.ts > discounts', file: 'total.test.ts', name: 'discounts' },
    { id: 'total.test.ts > rounds', file: 'total.test.ts', name: 'rounds' },
    { id: 'total.test.ts > taxes', file: 'total.test.ts', name: 'taxes' },
    { id: 'flow.test.tsx > checks out', file: 'flow.test.tsx', name: 'checks out' },
  ],
  modules: [{
    file: 'src/total.ts',
    blocks: [{
      kind: 'function', name: 'applyDiscount', path: 'entry', startLine: 10, endLine: 20,
      source: true, crossings: [{ test: 0, distance: 1 }, { test: 2, distance: 1 }, { test: 3, distance: 6 }],
    }],
  }],
};

async function indexFile(): Promise<string> {
  const file = join(await mkdtemp(join(tmpdir(), 'variance-covering-files-')), 'cases.json');
  await writeFile(file, JSON.stringify(INDEX));
  return file;
}

function parse(argv: readonly string[]) {
  return parseCoveringArgs(readFlags(argv, 'covering', flagsFor('covering'), synopsisFor('covering')));
}

describe('gathering a line\'s cases by test file', () => {
  it('counts each file\'s cases that went there out of every case it declares', async () => {
    const answer = await covering(parse(['--file', 'src/total.ts', '--line', '12', '--execution', await indexFile()]));

    expect(answer.files).toEqual([
      { file: 'total.test.ts', cases: 2, of: 3 },
      { file: 'flow.test.tsx', cases: 1, of: 1 },
    ]);
    expect(formatCovering(answer, 'text')).toContain('  total.test.ts — 2/3\n    discounts\n    taxes\n');
  });

  it('orders the files nearest first, and an unplaced file last', () => {
    const tests = INDEX.tests.map((test) => ({ ...test, distance: 0 }));
    const hops = new Map([['flow.test.tsx', 1], ['total.test.ts', undefined]]);

    expect(coveringFiles(tests, INDEX, hops)).toEqual([
      { file: 'flow.test.tsx', cases: 1, of: 1, hops: 1 },
      { file: 'total.test.ts', cases: 3, of: 3 },
    ]);
  });

  it('leaves out a case that only loaded the module', () => {
    const tests = [{ ...INDEX.tests[3]!, distance: 0, loaded: true as const }];

    expect(coveringFiles(tests, INDEX)).toEqual([]);
  });

  it('takes `--hops` only beside a line or a function, and never beside a diff', () => {
    expect(parse(['--file', 'src/total.ts', '--line', '12', '--hops']).hops).toBe(true);
    expect(() => parse(['--file', 'src/total.ts', '--hops'])).toThrow(/takes `--line` or `--function`/);
    expect(() => parse(['--since', 'HEAD~1', '--hops'])).toThrow(/do not compose/);
  });
});
