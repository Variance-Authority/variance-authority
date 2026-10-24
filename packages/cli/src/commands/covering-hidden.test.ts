import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFlags } from '../args.js';
import { parseCoveringArgs } from '../covering-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { covering, formatCovering } from './covering.js';

/** `total` spans lines 4-8, and nobody took the one-line branch on line 6. */
const INDEX = {
  tests: [{ id: 'a.test.ts > adds', file: 'a.test.ts', name: 'adds', stopped: false }],
  modules: [{
    file: 'src/cart.ts',
    blocks: [
      { kind: 'function', name: 'total', path: 'entry', startLine: 4, endLine: 8, source: true, crossings: [{ test: 0, distance: 0 }] },
      { kind: 'branch', name: 'total', path: 'if#0/then', startLine: 6, endLine: 6, source: true, crossings: [] },
    ],
  }],
};

async function ask() {
  const dir = await mkdtemp(join(tmpdir(), 'variance-covering-hidden-'));
  const execution = join(dir, 'cases.json');
  await writeFile(execution, JSON.stringify(INDEX));
  return covering(parseCoveringArgs(readFlags(
    ['--file', 'src/cart.ts', '--execution', execution, '--root', dir],
    'covering', flagsFor('covering'), synopsisFor('covering'),
  )));
}

describe('the whole-file answer over a one-line region no case entered', () => {
  it('gives the region its own range and says nobody entered it', async () => {
    const answer = await ask();

    expect(formatCovering(answer, 'text')).toBe([
      'src/cart.ts — 3 recorded ranges, 1 named test',
      'lines 4-5 — alone',
      '  a.test.ts',
      '    adds',
      'line 6 — alone',
      '  the same named test as lines 4-5',
      '  no case entered the branch on line 6, and every case that could have reached it finished: unwalked.',
      'lines 7-8 — alone',
      '  the same named test as lines 4-5',
      '',
    ].join('\n'));
  });

  it('says it in the refs an agent reads', async () => {
    expect(formatCovering(await ask(), 'refs')).toContain('6 alone: 1; unentered branch 6 unwalked\n');
  });
});
