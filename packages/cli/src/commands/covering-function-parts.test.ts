import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFlags } from '../args.js';
import { parseCoveringArgs } from '../covering-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { covering, formatCovering } from './covering.js';

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
