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
  it('is refused as `unrecorded` on the stream a program parses, and in a sentence on stderr', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-unrecorded-'));
    const answer = await ask(['covering', '--file', 'src/total.ts', '--root', root, '--format', 'json']);

    expect(answer.code).toBe(2);
    expect(JSON.parse(answer.out)).toEqual({ refused: 'unrecorded' });
    expect(answer.err).toMatch(/^nothing is recorded in/);
  });

  it('prints only the sentence when a person asked', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-unrecorded-'));
    const answer = await ask(['covering', '--file', 'src/total.ts', '--root', root]);

    expect(answer.code).toBe(2);
    expect(answer.out).toBe('');
  });
});
