import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { publishing, UNCOMPARED } from './__fixtures__/published-then-written.js';

/**
 * A question about a name written after the last published generation, asked
 * of `variance-authority-help`. A generation is reused for an hour, so the name
 * was refused as not published — an answer that reads as a real absence —
 * while `variance ask` read the checkout again first.
 */

const BIN = fileURLToPath(new URL('../dist/bin.js', import.meta.url));

const fixture = publishing();
beforeEach(fixture.before);
afterEach(fixture.after);

function bin(root: string, args: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile('node', [BIN, ...args, '--root', root], { cwd: root, env: { ...process.env, VARIANCE_AUTHORITY_CACHE: fixture.cache() } }, (error, out, err) => {
      resolve({ code: error === null ? 0 : Number(error.code ?? 1), out, err });
    });
  });
}

describe('variance-authority-help about a name written after the published generation', () => {
  it('reads the checkout again before refusing `symbol`', async () => {
    const { code, out, err } = await bin(await fixture.published(), ['symbol', '--name', 'keptOf']);
    expect(err).toBe('');
    expect(code).toBe(0);
    expect(out).toContain('packages/kit/src/kept.ts');
  });

  it('answers a name it does not find under `--just-answer` with when the generation was published and that the checkout was not compared with it', async () => {
    const { code, out, err } = await bin(await fixture.published(), ['symbol', '--name', 'keptOf', '--just-answer']);
    expect(err).toBe('');
    expect(code).toBe(0);
    expect(out).toContain('`keptOf` is not published by this workspace');
    expect(out).toMatch(UNCOMPARED);
  });

  it('says `search --format json` was not compared with the checkout', async () => {
    const { code, out } = await bin(await fixture.published(), ['search', '--query', 'tax', '--format', 'json']);
    expect(code).toBe(0);
    expect(JSON.parse(out)).toMatchObject({ compared: false });
  });
});
