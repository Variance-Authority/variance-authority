/// <depends path="./bin.ts" />
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { publishing, UNCOMPARED } from './__fixtures__/published-then-written.js';

/**
 * A question about a name written after the last published generation, asked
 * of `variance-authority-help`. A question answers from the published
 * generation at any age, as `variance ask` answers it: the answer says the
 * checkout was not compared with it, and `variance index` publishes a new one.
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
  it('answers `symbol` for a name written since from the generation, saying the checkout was not compared with it', async () => {
    const { code, out, err } = await bin(await fixture.published(), ['symbol', '--name', 'keptOf']);
    expect(err).toBe('');
    expect(code).toBe(0);
    expect(out).toContain('`keptOf` is not published by this workspace');
    expect(out).not.toContain('packages/kit/src/kept.ts');
    expect(out).toMatch(UNCOMPARED);
  });

  it('answers `symbol` from the published generation for a name renamed since, and says the checkout was not compared', async () => {
    const root = await fixture.published();
    const tax = join(root, 'packages/kit/src/tax.ts');
    writeFileSync(tax, readFileSync(tax, 'utf8').replace('taxOf', 'dutyOf'));

    const { code, out } = await bin(root, ['symbol', '--name', 'taxOf']);
    expect(code).toBe(0);
    expect(out).toContain('tax.ts');
    expect(out).not.toContain('`taxOf` is not');
    expect(out).toMatch(UNCOMPARED);
  });

  it('dates a `discover` answer with the generation it read, as every other answer is', async () => {
    const { code, out } = await bin(await fixture.published(), ['discover', '--declares', '^taxOf$']);
    expect(code).toBe(0);
    expect(out).toContain('tax.ts');
    expect(out).toMatch(UNCOMPARED);
  });

  it('says in `search --format json` that nothing compared the index to the files', async () => {
    const { code, out } = await bin(await fixture.published(), ['search', '--query', 'tax', '--format', 'json']);
    expect(code).toBe(0);
    expect(JSON.parse(out)).toMatchObject({ compared: false });
  });
});
