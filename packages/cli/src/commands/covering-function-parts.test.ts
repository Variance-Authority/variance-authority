import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { testCoverageFile } from '@variance-authority/sense/test-selection';
import { main } from '../bin.js';
import { readFlags } from '../args.js';
import { parseCoveringArgs } from '../covering-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { covering, formatCovering } from './covering.js';
import { AFTER, DISCOUNTS, ROUNDS, block, changed, recordTotal } from './review-fixture.js';

// `moved` is a function both cases entered. Inside it a branch ran, a one-line
// branch no case took, and a callback no case called, with a branch of its own.
// `movedAgain` is a namesake whose unrun branch is not `moved`'s, and every
// part of `read` ran.
const INDEX = {
  tests: [
    { id: 'reads', file: 'renders.test.ts', name: 'reads a context' },
    { id: 'moves', file: 'renders.test.ts', name: 'moves a context' },
  ],
  modules: [{
    file: 'src/renders.ts',
    blocks: [
      { kind: 'function', name: 'moved', path: 'entry', startLine: 10, endLine: 30, source: true, crossings: [{ test: 0, distance: 0 }, { test: 1, distance: 0 }] },
      { kind: 'branch', name: 'moved', path: 'for#0/body/if#0/then', startLine: 12, endLine: 12, source: true, crossings: [] },
      { kind: 'branch', name: 'moved', path: 'if#1/then', startLine: 14, endLine: 16, source: true, crossings: [{ test: 1, distance: 0 }] },
      { kind: 'function', name: 'moved/each.arg0', path: 'entry', startLine: 20, endLine: 26, source: true, crossings: [] },
      { kind: 'branch', name: 'moved/each.arg0', path: 'if#0/then', startLine: 22, endLine: 23, source: true, crossings: [] },
      { kind: 'function', name: 'movedAgain', path: 'entry', startLine: 40, endLine: 44, source: true, crossings: [{ test: 0, distance: 0 }] },
      { kind: 'branch', name: 'movedAgain', path: 'if#0/then', startLine: 42, endLine: 42, source: true, crossings: [] },
      { kind: 'function', name: 'read', path: 'entry', startLine: 50, endLine: 54, source: true, crossings: [{ test: 0, distance: 0 }] },
      { kind: 'branch', name: 'read', path: 'if#0/then', startLine: 52, endLine: 52, source: true, crossings: [{ test: 0, distance: 0 }] },
      { kind: 'function', name: 'split', path: 'entry', startLine: 60, endLine: 80, source: true, crossings: [{ test: 0, distance: 0 }] },
      { kind: 'branch', name: 'split', path: 'if#0/then', startLine: 62, endLine: 64, source: true, crossings: [] },
      { kind: 'branch', name: 'split', path: 'if#0/else', startLine: 64, endLine: 66, source: true, crossings: [] },
      { kind: 'branch', name: 'split', path: 'cond#0/then', startLine: 70, endLine: 70, source: true, crossings: [] },
      { kind: 'branch', name: 'split', path: 'cond#0/else', startLine: 70, endLine: 70, source: true, crossings: [] },
    ],
  }],
};

async function ask(...argv: string[]) {
  const dir = await mkdtemp(join(tmpdir(), 'variance-covering-function-parts-'));
  const execution = join(dir, 'cases.json');
  await writeFile(execution, JSON.stringify(INDEX));
  return covering(parseCoveringArgs(readFlags(
    ['--file', 'src/renders.ts', ...argv, '--execution', execution, '--root', dir],
    'covering', flagsFor('covering'), synopsisFor('covering'),
  )));
}

describe('a function some cases entered and some part of which none ran', () => {
  it('names each outermost part no case ran, as the handover counts it, and no namesake\'s', async () => {
    const answer = await ask('--function', 'moved');

    expect(answer.tests?.map((test) => test.id)).toEqual(['moves', 'reads']);
    expect(answer.unrun).toEqual([
      { kind: 'branch', startLine: 12, endLine: 12 },
      { kind: 'function', name: 'moved/each.arg0', startLine: 20, endLine: 26 },
    ]);
    expect(formatCovering(answer, 'text')).toContain(
      '\nNo case ran 2 parts of it: the branch at line 12, function moved/each.arg0 at lines 20-26.\n',
    );
    expect(JSON.parse(formatCovering(answer, 'json')).unrun).toHaveLength(2);
    expect(formatCovering(answer, 'refs')).toContain('; no case ran 12 branch, 20-26 function moved/each.arg0\n');
  });

  it('names both arms of a branch that share a line, a `} else {` or a one-line ternary', async () => {
    const answer = await ask('--function', 'split');

    expect(answer.unrun).toEqual([
      { kind: 'branch', startLine: 62, endLine: 64 },
      { kind: 'branch', startLine: 64, endLine: 66 },
      { kind: 'branch', startLine: 70, endLine: 70 },
      { kind: 'branch', startLine: 70, endLine: 70 },
    ]);
  });

  it('says nothing of parts when every part ran, or when no case entered the function at all', async () => {
    const ran = await ask('--function', 'read');
    expect(ran.tests?.map((test) => test.id)).toEqual(['reads']);
    expect(ran.unrun).toBeUndefined();
    expect(formatCovering(ran, 'text')).not.toContain('No case ran');

    // The answer already says no case entered the callback; its branch is not a second finding.
    const none = await ask('--function', 'moved/each.arg0');
    expect(none.tests).toEqual([]);
    expect(none.unrun).toBeUndefined();
  });
});

describe('a function the handover marks as holding a part no case ran', () => {
  const cwd = process.cwd();
  afterEach(() => process.chdir(cwd));

  it('is answered by covering --function with that part, read from the same record', async () => {
    const { root, first } = await changed();
    // `round` is entered, and the branch on its line 6 is not.
    await recordTotal(testCoverageFile(root, {}), {
      commit: first,
      text: AFTER,
      tests: [{ file: 'test/total.test.ts', complete: true, preconditions: [] }],
      entered: { applyDiscount: ['test/total.test.ts'], round: ['test/total.test.ts'] },
      index: {
        tests: [DISCOUNTS, ROUNDS],
        modules: [{ file: 'src/total.ts', blocks: [
          block('applyDiscount', 1, 3, [0]),
          block('round', 5, 7, [1]),
          { kind: 'branch', name: 'round', path: 'round/if#0/then', startLine: 6, endLine: 6, source: true, crossings: [] },
        ] }],
      },
    });
    let handover = '';
    await main(['review', '--since', first, '--root', root, '--format', 'handover'], { out: (text) => (handover += text), err: () => {} });
    let json = '';
    await main(['covering', '--file', 'src/total.ts', '--function', 'round', '--root', root, '--format', 'json'], { out: (text) => (json += text), err: () => {} });

    expect(handover).toContain('- 🔴 `round` in `src/total.ts` — a part no case ran');
    expect(JSON.parse(json).unrun).toEqual([{ kind: 'branch', startLine: 6, endLine: 6, state: 'unwalked' }]);

    // A distance that keeps no case narrows who is listed, not what ran.
    let far = '';
    await main(['covering', '--file', 'src/total.ts', '--function', 'round', '--at-distance', '5-', '--root', root, '--format', 'json'], { out: (text) => (far += text), err: () => {} });
    expect(JSON.parse(far)).toMatchObject({ tests: [], unrun: [{ kind: 'branch', startLine: 6, endLine: 6 }] });

    // A part whose every line the held text removed has nowhere to be named.
    const held = join(root, 'held.ts');
    await writeFile(held, AFTER.replace('  return Math.round(price);\n', ''));
    let removed = '';
    await main(['covering', '--file', 'src/total.ts', '--function', 'round', '--text', held, '--root', root, '--format', 'json'], { out: (text) => (removed += text), err: () => {} });
    expect(JSON.parse(removed).tests).toHaveLength(1);
    expect(JSON.parse(removed).unrun).toBeUndefined();
  });
});
