import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { updateSourceIndex } from '@variance-authority/sense';
import type { Placement } from '@variance-authority/sense/test-selection';
import { readFlags } from '../args.js';
import { parseCoveringArgs } from '../covering-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { covering, formatCovering } from './covering.js';

/**
 * A held text the edit wrote line 3 into: held lines after it are the recorded
 * ones a line up. Framing it end to end needs a module with a line no region
 * holds, which the recorded fixture has none of, so the frame is stood in for.
 */
const MAPPED: Placement = {
  frame: 'mapped',
  place: (range) => ({ lines: range, moved: false }),
  recordedLine: (line) => (line === 3 ? undefined : line < 3 ? line : line - 1),
};

vi.mock('./covering-frame.js', async (original) => ({
  ...await original<typeof import('./covering-frame.js')>(),
  placementFor: async () => MAPPED,
}));

/** `total` spans recorded lines 4-6; recorded lines 1-3 are an import and blanks. */
const INDEX = {
  tests: [{ id: 'a.test.ts > adds', file: 'a.test.ts', name: 'adds' }],
  modules: [{
    file: 'src/cart.ts',
    blocks: [{ kind: 'function', name: 'total', path: 'entry', startLine: 4, endLine: 6, source: true, crossings: [{ test: 0, distance: 0 }] }],
  }],
};

async function ask(line: string) {
  const dir = await mkdtemp(join(tmpdir(), 'variance-covering-unentered-'));
  const execution = join(dir, 'cases.json');
  await writeFile(execution, JSON.stringify(INDEX));
  // Under CI nothing builds the source index implicitly; the fixture publishes it, as the pipeline's `variance index` step does.
  execFileSync('git', ['init', '--quiet', dir]);
  await updateSourceIndex(dir);
  return covering(parseCoveringArgs(readFlags(
    ['--file', 'src/cart.ts', '--line', line, '--execution', execution, '--root', dir],
    'covering', flagsFor('covering'), synopsisFor('covering'),
  )));
}

describe('a run of lines no recorded region holds', () => {
  it('answers with no case, says which lines hold no region and which the edit wrote, and names the run of the file\'s tests that would read the new one', async () => {
    const answer = await ask('2-3');

    expect(answer).toMatchObject({ tests: [], frame: 'mapped', outside: [{ startLine: 2, endLine: 2 }], written: [{ startLine: 3, endLine: 3 }] });
    expect(formatCovering(answer, 'text')).toBe(
      'No named test covered lines 2-3 of src/cart.ts.\n'
        + 'Line 2 is outside every recorded region, so no case can be said to have run it.\n'
        + 'Line 3 was written since the recording, so no case has run it.\n'
        + 'Gap (stale) on lines 2-3 of src/cart.ts: which tests run it now. Known: line 3 was written since the recording.\n'
        + 'Next, Record, 1 test in 1 test file:\n'
        + "  Run with the suite's own runner: a.test.ts\n",
    );
  });

  it('still names the cases of a line beside them that a region holds', async () => {
    const answer = await ask('2-5');

    expect(answer.tests?.map((test) => test.name)).toEqual(['adds']);
    // Held line 4 is recorded line 3, a blank.
    expect(answer).toMatchObject({ outside: [{ startLine: 2, endLine: 2 }, { startLine: 4, endLine: 4 }], written: [{ startLine: 3, endLine: 3 }] });
  });
});
