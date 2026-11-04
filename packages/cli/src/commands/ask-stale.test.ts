import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readWorkspaceForAnswer } from '@variance-authority/help';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages.fixture.js';
import { askSource } from './ask.js';

/**
 * `variance ask` about a name the published source index does not hold yet.
 * A generation is reused for an hour, and the dependency lexicon is built only
 * by `variance index`, so a function written after the last index was refused
 * as not found, and an installed package's export as *the dependency lexicon is
 * not published* — answers that read as real absences.
 */

const cwd = process.cwd();

beforeEach(() => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-stale-cache-')));
});

afterEach(() => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
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

const TAX = 'packages/kit/src/money/tax.ts';

/** The file of the fixture that imports {@link TAX}'s name, by path. */
const IMPORTER = 'apps/app/src/checkout.ts';

const OPTIONS = 'export interface Options {\n  /** Whether CI. */\n  readonly ci: boolean;\n  /** The step. */\n  readonly step: string;\n}\n';

/** The time an answer's generation was made, from its date line. */
function snapshotOf(out: string): string | undefined {
  return /^Snapshot (\S+Z)/mu.exec(out)?.[1];
}

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

describe('variance ask about a name whose file changed since the source index', () => {
  it('says nothing declares a name renamed in the working tree, from a generation made after the rename', async () => {
    const root = checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const before = snapshotOf((await run(['ask', 'symbol', '--name', 'taxOf'])).out);
    write(root, Object.fromEntries([TAX, IMPORTER].map((file) => [file, readFileSync(join(root, file), 'utf8').replaceAll('taxOf', 'dutyOf')])));

    const { code, out } = await run(['ask', 'symbol', '--name', 'taxOf']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('`taxOf` is not');
    expect(out).not.toContain(`${TAX}:1`);
    expect(Date.parse(snapshotOf(out)!)).toBeGreaterThan(Date.parse(before!));
  });

  it('keeps the answer, and says why it was not compared, when the checkout could not be read again', async () => {
    const root = checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const held = await readWorkspaceForAnswer(root);
    write(root, { [TAX]: `// moved\n${readFileSync(join(root, TAX), 'utf8')}` });

    const answer = await askSource({
      question: 'symbol',
      name: 'taxOf',
      source: async (_root, reading) => {
        if (reading?.current === true) throw new Error('a manifest is half-written');
        return { help: held };
      },
    });

    expect(answer).toContain(`${TAX}:1`);
    expect(answer).toMatch(/not compared with the checkout \(it could not be read again: a manifest is half-written\)/u);
  });

  it('says nothing declares a name whose file is gone', async () => {
    const root = checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    rmSync(join(root, TAX));
    write(root, { [IMPORTER]: 'export const total = 1;\n' });

    const { code, out } = await run(['ask', 'symbol', '--name', 'taxOf']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('`taxOf` is not');
    expect(out).not.toContain(`${TAX}:1`);
  });

  it('gives an interface and its members at the lines the file holds them on today', async () => {
    const root = checkout({ 'packages/kit/src/options.ts': OPTIONS });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    write(root, { 'packages/kit/src/options.ts': `/** One.\n * Two.\n */\nexport const lead = 1;\n${OPTIONS}` });

    const { code, out } = await run(['ask', 'symbol', '--name', 'Options']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('at packages/kit/src/options.ts:5 by');
    expect(out).toContain('packages/kit/src/options.ts:7 — readonly ci: boolean;');
    expect(out).toContain('packages/kit/src/options.ts:9 — readonly step: string;');
    expect(out).not.toContain('— */');
  });

  it('answers from its generation, and publishes none, when only a file the answer does not name changed', async () => {
    const root = checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const before = await run(['ask', 'symbol', '--name', 'taxOf']);
    write(root, KEPT);

    const after = await run(['ask', 'symbol', '--name', 'taxOf']);
    expect(after.out).toBe(before.out);
    expect(snapshotOf(after.out)).toBeDefined();
  });

  it('leaves `--just-answer` to its generation, and says that was not compared', async () => {
    const root = checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    write(root, { [TAX]: readFileSync(join(root, TAX), 'utf8').replace('taxOf', 'dutyOf') });

    const { code, out } = await run(['ask', 'symbol', '--name', 'taxOf', '--just-answer']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain(`${TAX}:1`);
    expect(out).toMatch(/^Snapshot \S+, not compared with the checkout/mu);
  });
});
