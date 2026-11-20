import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages.fixture.js';

/**
 * `variance ask symbol --limit`, as every listing question takes it: the
 * declarations written out of one name, its file-private ones and its members
 * alike, every one still counted and the rest said, each cut naming the
 * `--limit` that shows them; five when it is not said.
 */

const cwd = process.cwd();

beforeEach(() => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-symbol-limit-cache-')));
});

afterEach(() => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
});

const PARTS = ['a', 'b', 'c', 'd', 'e', 'f'];

/** Six files that each keep a `rank` to themselves. */
const RANKS = Object.fromEntries(
  PARTS.map((part) => [`packages/kit/src/rank/${part}.ts`, `export const ${part} = (): number => rank();\n\nfunction rank(): number {\n  return 0;\n}\n`]),
);

/** Six interfaces named `Box`, none of which declares `size`. */
const BOXES = Object.fromEntries(
  PARTS.map((part) => [`packages/kit/src/box/${part}.ts`, `export interface Box {\n  width: number;\n}\n`]),
);

/** Six interfaces that each declare a `rank` member. */
const MEMBERS = Object.fromEntries(
  PARTS.map((part, at) => [`packages/kit/src/ranked/${part}.ts`, `export interface Ranked${at} {\n  rank: number;\n}\n`]),
);

describe('variance ask symbol --limit', () => {
  it('writes out every declaration up to the limit', async () => {
    checkout(RANKS);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out, err } = await run(['ask', 'symbol', '--name', 'rank', '--limit', '10']);
    expect(err).toBe('');
    expect(code).toBe(EXIT_CLEAN);
    expect(out.match(/^rank \[function\]$/gm)).toHaveLength(6);
    expect(out).toContain('declared, not exported, at packages/kit/src/rank/f.ts:3 by @acme/kit');
    expect(out).not.toContain('not shown');
  });

  it('cuts the declarations at a limit below five and says the rest', async () => {
    checkout(RANKS);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'symbol', '--name', 'rank', '--limit', '2']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out.match(/^rank \[function\]$/gm)).toHaveLength(2);
    expect(out).toContain('4 more declarations of `rank` not shown; a higher `--limit` shows them.');
  });

  it('cuts the members of a name at the same limit, five when none is said', async () => {
    checkout(MEMBERS);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const plain = await run(['ask', 'symbol', '--name', 'rank']);
    expect(plain.code).toBe(EXIT_CLEAN);
    expect(plain.out.match(/a member of `Ranked\d`/g)).toHaveLength(5);
    expect(plain.out).toContain('1 more member declaration of `rank` not shown; a higher `--limit` shows them.');

    const { code, out, err } = await run(['ask', 'symbol', '--name', 'rank', '--limit', '10']);
    expect(err).toBe('');
    expect(code).toBe(EXIT_CLEAN);
    expect(out.match(/a member of `Ranked\d`/g)).toHaveLength(6);
    expect(out).not.toContain('not shown');
  });

  it('names every container of a missing member up to the limit, in `symbol` and `uses` alike', async () => {
    checkout(BOXES);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    for (const question of ['symbol', 'uses']) {
      const plain = await run(['ask', question, '--name', 'Box.size']);
      expect(plain.out + plain.err).toContain('1 more declaration of `Box` not shown; a higher `--limit` shows them.');

      const wide = await run(['ask', question, '--name', 'Box.size', '--limit', '10']);
      expect(wide.out + wide.err, question).toContain('packages/kit/src/box/f.ts:1');
      expect(wide.out + wide.err).not.toContain('not shown');
    }
  });
});
