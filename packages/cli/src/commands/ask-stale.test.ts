import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `variance ask` about a name the published source index does not hold yet.
 * A generation is reused for an hour, and the dependency lexicon is built only
 * by `variance index`, so a function written after the last index was refused
 * as not found, and an installed package's export as *the dependency lexicon is
 * not published* — answers that read as real absences.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-stale-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

function write(root: string, files: Readonly<Record<string, string>>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

const KEPT = { 'packages/kit/src/kept.ts': 'export function keptOf(amount: number): number {\n  return amount;\n}\n' };

/** An installed package declaring `makeStore`, which the checkout depends on and no file of it declares. */
const STATE_KIT = {
  'node_modules/state-kit/package.json': JSON.stringify({ name: 'state-kit', version: '0.3.1', types: 'index.d.ts', main: 'index.js' }),
  'node_modules/state-kit/index.js': 'exports.makeStore = () => ({});\n',
  'node_modules/state-kit/index.d.ts': 'export declare function makeStore(): object;\n',
};

describe('variance ask about a name written after the source index', () => {
  it('reads the checkout again before refusing `symbol` for a function written since `variance index`', async () => {
    const root = checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    write(root, KEPT);

    const { code, out, err } = await run(['ask', 'symbol', '--name', 'keptOf']);
    expect(err).toBe('');
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('packages/kit/src/kept.ts');
  });

  it('reads the checkout again before refusing `uses` for a function written since `variance index`', async () => {
    const root = checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    write(root, KEPT);

    const { code, out, err } = await run(['ask', 'uses', '--name', 'keptOf']);
    expect(err).not.toContain('keptOf` is not');
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('packages/kit/src/kept.ts');
  });

  it('builds the dependency lexicon rather than refusing `symbol` because it is not published', async () => {
    const root = checkout();
    write(root, {
      'package.json': JSON.stringify({ private: true, workspaces: ['packages/*', 'apps/*'], dependencies: { 'state-kit': '0.3.1' } }),
      ...STATE_KIT,
    });

    const { code, out, err } = await run(['ask', 'symbol', '--name', 'makeStore']);
    expect(err).toBe('');
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('state-kit');
  });

  it('builds the dependency lexicon for a reading of named changed files too', async () => {
    const root = checkout();
    write(root, {
      'package.json': JSON.stringify({ private: true, workspaces: ['packages/*', 'apps/*'], dependencies: { 'state-kit': '0.3.1' } }),
      ...STATE_KIT,
      ...KEPT,
      'changed.txt': 'packages/kit/src/kept.ts\n',
    });

    const { code, out, err } = await run(['ask', 'symbol', '--name', 'makeStore', '--changed-file', join(root, 'changed.txt')]);
    expect(err).toBe('');
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('state-kit');
  });

  it('answers a name it does not find under `--just-answer` with when the index was published and that the checkout was not compared with it', async () => {
    const root = checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    write(root, KEPT);

    const { code, out, err } = await run(['ask', 'symbol', '--name', 'keptOf', '--just-answer']);
    expect(code).toBe(EXIT_CLEAN);
    expect(err).toBe('');
    expect(out).toContain('`keptOf` is not published by this workspace');
    expect(out).toMatch(/^Snapshot \d{4}-\d\d-\d\dT[\d:.]+Z, not compared with the checkout: run `variance index` if files changed since\.$/mu);
  });

  it('says `search` read an index it did not compare with the checkout, since it reads the published one at any age', async () => {
    const root = checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    write(root, KEPT);

    const { code, out } = await run(['ask', 'search', '--query', 'keptOf']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('Nothing in this repository is named or documented with `keptof`');
    expect(out).toMatch(/^Snapshot \d{4}-\d\d-\d\dT[\d:.]+Z, not compared with the checkout: run `variance index` if files changed since\.$/mu);
  });

  it('says in `search --format json` that the index was not compared with the checkout', async () => {
    const root = checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    write(root, KEPT);

    const { code, out } = await run(['ask', 'search', '--query', 'keptOf', '--format', 'json']);
    expect(code).toBe(EXIT_CLEAN);
    expect(JSON.parse(out)).toMatchObject({ compared: false });
  });
});
