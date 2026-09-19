import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFlags } from '../args.js';
import { parseCoveringArgs } from '../covering-args.js';
import { OperatorError } from '../exit.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { covering, formatCovering } from './covering.js';

const INDEX = {
  tests: [
    { id: 'near', file: 'total.test.ts', name: 'discounts' },
    { id: 'far', file: 'flow.test.tsx', name: 'checks out' },
  ],
  modules: [{
    file: 'src/total.ts',
    blocks: [
      {
        kind: 'function', name: 'applyDiscount', path: 'entry', startLine: 10, endLine: 20,
        source: true, crossings: [{ test: 0, distance: 1 }, { test: 1, distance: 6 }],
      },
      {
        kind: 'function', name: 'round', path: 'entry', startLine: 30, endLine: 34,
        source: true, crossings: [{ test: 1, distance: 3 }],
      },
    ],
  }],
};

async function indexFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'variance-covering-'));
  const file = join(dir, 'cases.json');
  await writeFile(file, JSON.stringify(INDEX));
  return file;
}

function parse(argv: readonly string[]) {
  return parseCoveringArgs(readFlags(argv, 'covering', flagsFor('covering'), synopsisFor('covering')));
}

describe('asking which tests entered a line', () => {
  it('orders a line answer by observed depth', async () => {
    const execution = await indexFile();

    const answer = await covering(parse(['--file', 'src/total.ts', '--line', '12', '--execution', execution]));

    expect(answer.tests?.map((test) => [test.id, test.distance])).toEqual([['near', 1], ['far', 6]]);
    expect(formatCovering(answer, 'text')).toContain('2 named tests reached line 12 of src/total.ts');
  });

  it('answers a function by name and carries the same reading into JSON', async () => {
    const execution = await indexFile();

    const answer = await covering(parse(['--file', 'src/total.ts', '--function', 'round', '--execution', execution]));

    expect(answer.tests?.map((test) => test.id)).toEqual(['far']);
    expect(JSON.parse(formatCovering(answer, 'json')).target).toEqual({ function: 'round' });
  });

  it('answers a bare file as ranges, so an unclaimed region shows up as one', async () => {
    const execution = await indexFile();

    const answer = await covering(parse(['--file', 'src/total.ts', '--execution', execution]));

    expect(answer.ranges?.map((range) => [range.startLine, range.endLine])).toEqual([[10, 20], [30, 34]]);
    expect(formatCovering(answer, 'text')).toContain('2 recorded ranges, 2 named tests');
  });

  it('refuses a missing index rather than reporting nothing covered', async () => {
    await expect(covering(parse(['--file', 'src/total.ts', '--execution', join(tmpdir(), 'absent.json')])))
      .rejects.toThrow(/no readable per-case execution index/);
  });

  it('points at the recorded spelling when the path is rooted differently', async () => {
    const execution = await indexFile();

    await expect(covering(parse(['--file', '/abs/src/total.ts', '--execution', execution])))
      .rejects.toThrow(/record spells it `src\/total\.ts`/);
  });

  it('separates a line nothing recorded from a line nothing reached', async () => {
    const execution = await indexFile();

    await expect(covering(parse(['--file', 'src/total.ts', '--line', '2', '--execution', execution])))
      .rejects.toThrow(/outside every recorded region/);
  });

  it('refuses a line and a function together, and a line that is not one', () => {
    expect(() => parse(['--file', 'a.ts', '--line', '3', '--function', 'f'])).toThrow(OperatorError);
    expect(() => parse(['--file', 'a.ts', '--line', '0'])).toThrow(/positive integer/);
    expect(() => parse(['--line', '3'])).toThrow(/needs `--file <path>`/);
  });
});
