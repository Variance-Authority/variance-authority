import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../bin.js';

async function ask(argv: readonly string[]) {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (text) => (out += text), err: (text) => (err += text) });
  return { code, out, err };
}

describe('a project nothing was recorded in', () => {
  it('is refused as `unrecorded` on the stream a program parses with its Record gap, and in a sentence on stderr', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-unrecorded-'));
    const answer = await ask(['covering', '--file', 'src/total.ts', '--root', root, '--format', 'json']);

    expect(answer.code).toBe(2);
    expect(JSON.parse(answer.out)).toEqual({
      refused: 'unrecorded',
      gap: { question: 'which tests ran it', scope: 'src/total.ts', known: 'no run is recorded', reason: 'absent', remedy: 'record', run: {}, next: [] },
    });
    expect(answer.err).toMatch(/^nothing is recorded in .*\nGap \(absent\) on src\/total\.ts: which tests ran it\. Known: no run is recorded\.\nNext, Record, at a cost no record counts:\n {2}Wire the suite's producer and record one run of it: that first run is the record\.\n/u);
  });

  it('prints nothing on stdout when a person asked', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-unrecorded-'));
    const answer = await ask(['covering', '--file', 'src/total.ts', '--root', root]);

    expect(answer.code).toBe(2);
    expect(answer.out).toBe('');
  });
});
