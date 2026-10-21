import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  encodeAsSetExecutionIndex,
  writeTestCoverage,
  type ExecutionIndex,
  type ExecutionTest,
  type Placement,
} from '@variance-authority/sense/test-selection';
import { INSTRUMENTATION_ID } from '@variance-authority/sense/instrument';
import { readFlags } from '../args.js';
import { parseCoveringArgs } from '../covering-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { covering, formatCovering } from './covering.js';

/**
 * A file edited since the recording, whose recorded text is in neither git nor
 * the kept texts: no recorded line is a place in what is held. Framing it end
 * to end needs a record whose commit git does not hold, so the frame is stood
 * in for.
 */
const STALE: Placement = { frame: 'stale', at: '0123456789abcdef', place: () => undefined, recordedLine: () => undefined };

vi.mock('./covering-frame.js', async (original) => ({
  ...await original<typeof import('./covering-frame.js')>(),
  placementFor: async () => STALE,
}));

function said(name: string, flag?: string): ExecutionTest {
  const file = 'a.test.ts';
  return { id: `${file} > ${name}`, file, name, said: JSON.stringify({ said: flag === undefined ? [] : [['flags:checkout', JSON.stringify(flag), `${file}:3`, 1]] }) };
}

const TESTS: readonly ExecutionTest[] = [said('on', 'ff-on'), said('off', 'ff-off'), said('plain')];

/** `total` is crossed by every case, `round` by the first two. */
const INDEX: ExecutionIndex = {
  tests: TESTS,
  modules: [{
    file: 'src/cart.ts',
    blocks: [
      { kind: 'function', name: 'total', path: 'entry', startLine: 1, endLine: 3, source: true, crossings: [0, 1, 2].map((test) => ({ test, distance: 0 })) },
      { kind: 'function', name: 'round', path: 'entry', startLine: 5, endLine: 7, source: true, crossings: [0, 1].map((test) => ({ test, distance: 0 })) },
    ],
  }, {
    file: 'src/other.ts',
    blocks: [{ kind: 'function', name: 'other', path: 'entry', startLine: 1, endLine: 2, source: true, crossings: [] }],
  }],
};

async function ask(argv: readonly string[]) {
  const root = await mkdtemp(join(tmpdir(), 'variance-covering-stale-'));
  const execution = join(root, 'coverage.bin');
  await writeTestCoverage(execution, { version: 3, instrumentation: INSTRUMENTATION_ID, tests: [], modules: [] }, {
    index: encodeAsSetExecutionIndex(INDEX),
  });
  return covering(parseCoveringArgs(readFlags(
    ['--file', 'src/cart.ts', '--execution', execution, '--root', root, ...argv],
    'covering', flagsFor('covering'), synopsisFor('covering'),
  )));
}

const GONE = 'src/cart.ts is not the text the suite ran over at 0123456789ab, and that text could not be found, so no recorded line is a place in it.';

describe('a file whose recorded text is gone', () => {
  it('names the cases that ran code in the file, and says the line is what it cannot place', async () => {
    const answer = await ask(['--line', '6']);
    const text = formatCovering(answer, 'text');

    expect(answer).toMatchObject({ frame: 'stale', target: { line: 6 }, at: '0123456789abcdef' });
    expect(answer.tests?.map((test) => test.name)).toEqual(['off', 'on', 'plain']);
    expect(text).toContain(`${GONE}\n3 named tests ran code in src/cart.ts; which of them ran line 6 cannot be said:\n  a.test.ts — 3/3\n    off — flags:checkout=ff-off`);
    expect(text).not.toMatch(/[Rr]un the suite|[Rr]ecord .* again/);
  });

  it('answers the whole file the same way, with no range in it', async () => {
    const answer = await ask([]);

    expect(answer.ranges).toBeUndefined();
    expect(answer.tests?.map((test) => test.name)).toEqual(['off', 'on', 'plain']);
    expect(formatCovering(answer, 'text')).toContain(`${GONE}\n3 named tests ran code in src/cart.ts; at which of its lines cannot be said:\n`);
  });

  it('numbers the cases in refs, and says the same gap', async () => {
    const refs = formatCovering(await ask(['--line', '6']), 'refs');

    expect(refs).toContain(`${GONE}\n3 named tests ran code in src/cart.ts; which of them ran line 6 cannot be said: 1-3\n`);
    expect(refs).not.toMatch(/[Rr]un the suite/);
  });

  it('counts `--where` out of the cases that ran code in the file, not out of a line it cannot place', async () => {
    const text = formatCovering(await ask(['--line', '6', '--where', 'flags:checkout=ff-on']), 'text');

    expect(text).toContain('Kept the 1 of 3 cases that covered src/cart.ts and recorded flags:checkout=ff-on.\n');
    expect(text).toContain('1 named test ran code in src/cart.ts; which of them ran line 6 cannot be said:');
  });
});
