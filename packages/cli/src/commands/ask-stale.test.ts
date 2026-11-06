import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readWorkspaceForAnswer } from '@variance-authority/help';
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';
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

/** {@link OPTIONS} rewritten so every line the index read still spells the name it read there. */
const OPTIONS_REWRITTEN = '// Options went elsewhere\n//\n// the ci job is gone\n//\n// the last step is gone\n';

const HIDDEN = 'packages/kit/src/hidden.ts';

/** A name its file declares and does not export. */
const HIDDEN_TEXT = 'export const shown = 1;\n/** Halves it. */\nfunction hiddenOf(amount: number): number {\n  return amount / 2;\n}\nexport const used = hiddenOf(shown);\n';

/** {@link HIDDEN_TEXT} rewritten so the line the index read still spells the name. */
const HIDDEN_REWRITTEN = 'export const shown = 1;\n// the words of today\n// hiddenOf went elsewhere, and this comment is long enough to reach past the old signature\n';

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

  it('prints the true lines of a published name from a file `--changed-file` names', async () => {
    const root = checkout({ 'changed.txt': 'packages/lib/src/greet.ts\n' });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    write(root, { 'packages/lib/src/greet.ts': '// one\n// two\nexport function greet(name: string): string {\n  return name;\n}\n' });

    const { out } = await run(['ask', 'symbol', '--name', 'greet', '--changed-file', join(root, 'changed.txt')]);

    expect(out).toContain('packages/lib/src/greet.ts:3');
  });

  it('stops publishing a name when a file `--changed-file` names drops the `export *` it came through', async () => {
    const root = checkout({
      'changed.txt': 'packages/lib/src/mid.ts\n',
      'packages/lib/src/index.ts': "export * from './mid.js';\n",
      'packages/lib/src/mid.ts': "export * from './greet.js';\nexport const mid = 1;\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    write(root, { 'packages/lib/src/mid.ts': 'export const mid = 1;\n' });

    const { out } = await run(['ask', 'symbol', '--name', 'greet', '--changed-file', join(root, 'changed.txt')]);

    expect(out).toContain('exported, without being published');
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
    expect(out).toContain('No export, top-level declaration or member of a class, an interface or a type in this repository, nor the doc of one, nor a function inside a function, nor the title of a `describe`, `it` or `test` call or the doc above it, writes `keptof`');
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

describe('variance index over an entry that passes on another binding under the same name', () => {
  it('publishes the declaration the entry takes now, with the exported name and the target file unchanged', async () => {
    const root = checkout({
      'packages/lib/src/index.ts': "export { foo as shared } from './implementation.js';\n",
      'packages/lib/src/implementation.ts': 'export function foo(): void {}\nexport const bar = 2;\n',
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    // The kind is the declaration's: the two bindings differ in it, and `search` prints what the published value holds.
    expect((await run(['ask', 'search', '--query', 'shared'])).out).toContain('@acme/lib · shared [function]');
    write(root, { 'packages/lib/src/index.ts': "export { bar as shared } from './implementation.js';\n" });

    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    expect((await run(['ask', 'search', '--query', 'shared'])).out).toContain('@acme/lib · shared [const]');
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

  it('says nothing declares a name renamed in the working tree when `uses` asks for it', async () => {
    const root = checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const before = snapshotOf((await run(['ask', 'uses', '--name', 'taxOf'])).out);
    write(root, Object.fromEntries([TAX, IMPORTER].map((file) => [file, readFileSync(join(root, file), 'utf8').replaceAll('taxOf', 'dutyOf')])));

    const { code, out } = await run(['ask', 'uses', '--name', 'taxOf']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).not.toContain(IMPORTER);
    expect(out).toContain('`taxOf` is not');
    expect(Date.parse(snapshotOf(out)!)).toBeGreaterThan(Date.parse(before!));
  });

  it('refuses an empty name as the tool does, over a generation it looks at', async () => {
    checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, err } = await run(['ask', 'symbol', '--name', '']);
    expect(code).toBe(EXIT_OPERATOR);
    expect(err).toContain('`name` is required and must be a non-empty string');
    expect(err).not.toContain('defect in the tool');
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
    expect(answer.match(/^Snapshot /gmu)).toHaveLength(1);
  });

  it('says why under a refusal when the file the name was in moved after the read that found it gone', async () => {
    const root = checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const held = await readWorkspaceForAnswer(root);
    write(root, Object.fromEntries([TAX, IMPORTER].map((file) => [file, readFileSync(join(root, file), 'utf8').replaceAll('taxOf', 'dutyOf')])));

    const answer = await askSource({
      question: 'symbol',
      name: 'taxOf',
      source: async (_root, reading) => {
        if (reading?.current !== true) return { help: held };
        const help = await readWorkspaceForAnswer(root, { refreshAfterMs: 0 });
        write(root, { [TAX]: `// moved\n${readFileSync(join(root, TAX), 'utf8')}` });
        return { help };
      },
    });

    expect(answer).toMatch(/not compared with the checkout \(a file it rests on changed while it was read\)/u);
    expect(answer.match(/^Snapshot /gmu)).toHaveLength(1);
  });

  it('reads the checkout again when a file a `uses` answer lists changed', async () => {
    const root = checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const before = await run(['ask', 'uses', '--name', 'taxOf']);
    expect(before.out).toContain(`${IMPORTER}:`);
    write(root, { [IMPORTER]: `// one\n// two\n// three\n${readFileSync(join(root, IMPORTER), 'utf8')}` });

    const { out } = await run(['ask', 'uses', '--name', 'taxOf']);
    expect(snapshotOf(out)).not.toBe(snapshotOf(before.out));
  });

  it('dates what a generation it could not save answers, and quotes no file written since it was read', async () => {
    const root = checkout({ 'packages/kit/src/options.ts': OPTIONS });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const unsaved = await readWorkspaceForAnswer(root, { index: join(root, 'package.json', 'index'), refreshAfterMs: 0 });
    write(root, { 'packages/kit/src/options.ts': `// one\n// two\n${OPTIONS}` });

    const answer = await askSource({ question: 'symbol', name: 'Options', source: async () => ({ help: unsaved }) });

    expect(snapshotOf(answer)).toBeDefined();
    expect(answer).toContain('packages/kit/src/options.ts:3 — ci');
  });

  it('reads no text of a file the look found changed, though each recorded line still spells its name', async () => {
    const root = checkout({ 'packages/kit/src/options.ts': OPTIONS, [HIDDEN]: HIDDEN_TEXT });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const held = await readWorkspaceForAnswer(root);
    write(root, { 'packages/kit/src/options.ts': OPTIONS_REWRITTEN, [HIDDEN]: HIDDEN_REWRITTEN });
    const refused = async (name: string): Promise<string> =>
      await askSource({
        question: 'symbol',
        name,
        source: async (_root, reading) => {
          if (reading?.current === true) throw new Error('a manifest is half-written');
          return { help: held };
        },
      });

    const members = await refused('Options');
    expect(members).toContain('packages/kit/src/options.ts:3 — ci');
    expect(members).toContain('packages/kit/src/options.ts:5 — step');
    expect(members).not.toContain('is gone');
    expect(members).not.toContain('went elsewhere');

    const declared = await refused('hiddenOf');
    expect(declared).toContain(`declared, not exported, at ${HIDDEN}:3`);
    expect(declared).not.toContain('went elsewhere');
    expect(declared).not.toContain('words of today');
  });

  it('carries the caveat, with one reading and none of its text, for a file saved during the read the look asked for', async () => {
    const root = checkout({ 'packages/kit/src/options.ts': OPTIONS });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const held = await readWorkspaceForAnswer(root);
    write(root, { 'packages/kit/src/options.ts': `// moved\n${OPTIONS}` });
    let reads = 0;

    const answer = await askSource({
      question: 'symbol',
      name: 'Options',
      source: async (_root, reading) => {
        if (reading?.current !== true) return { help: held };
        reads += 1;
        const help = await readWorkspaceForAnswer(root, { refreshAfterMs: 0 });
        // The save the read could not have seen, made once the read is over.
        write(root, { 'packages/kit/src/options.ts': `// moved\n//\n// the ci job is gone\n${OPTIONS}` });
        return { help };
      },
    });

    expect(reads).toBe(1);
    expect(answer).toContain('packages/kit/src/options.ts:4 — ci');
    expect(answer).not.toContain('is gone');
    expect(answer).toMatch(/^Snapshot \S+, not compared with the checkout \(a file it rests on changed while it was read\)/mu);
    expect(answer.match(/^Snapshot /gmu)).toHaveLength(1);

    const next = await run(['ask', 'symbol', '--name', 'Options']);
    expect(next.out).toContain('packages/kit/src/options.ts:6 — readonly ci: boolean;');
    expect(next.out).not.toContain('not compared');
  });

  it('gives no opening of a file `search` found, once that file was written since the read and could not be read again', async () => {
    const opening = (words: string): string => `/**\n * Where painted ${words} dance.\n */\n\n/** One. */\nexport const pond = 1;\n`;
    const root = checkout({ 'packages/kit/src/frogs.ts': opening('frogs') });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const held = await readWorkspaceForAnswer(root);
    write(root, { 'packages/kit/src/frogs.ts': opening('toads') });

    const answer = await askSource({
      question: 'search',
      query: 'painted frogs dance',
      source: async (_root, reading) => {
        if (reading?.current === true) throw new Error('a manifest is half-written');
        return { help: held };
      },
    });

    expect(answer).toContain('packages/kit/src/frogs.ts');
    expect(answer).not.toContain('toads');
    expect(answer).toMatch(/^Snapshot \S+, not compared with the checkout \(it could not be read again: a manifest is half-written\)/mu);
  });

  it('gives the members it recorded, and none of today\'s text at their old lines, when the checkout could not be read again', async () => {
    const root = checkout({ 'packages/kit/src/options.ts': OPTIONS });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const held = await readWorkspaceForAnswer(root);
    write(root, { 'packages/kit/src/options.ts': `/** One.\n * Two.\n */\nexport const lead = 1;\n${OPTIONS}` });

    const answer = await askSource({
      question: 'symbol',
      name: 'Options',
      source: async (_root, reading) => {
        if (reading?.current === true) throw new Error('a manifest is half-written');
        return { help: held };
      },
    });

    expect(answer).toContain('packages/kit/src/options.ts:3 — ci');
    expect(answer).toContain('packages/kit/src/options.ts:5 — step');
    expect(answer).not.toContain('— */');
    expect(answer).not.toContain('— export interface');
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

  it('gives what the record holds, under `--just-answer`, of a file written since its generation was read', async () => {
    const root = checkout({ 'packages/kit/src/options.ts': OPTIONS });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    write(root, { 'packages/kit/src/options.ts': OPTIONS_REWRITTEN });

    const { code, out } = await run(['ask', 'symbol', '--name', 'Options', '--just-answer']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('packages/kit/src/options.ts:3 — ci');
    expect(out).not.toContain('is gone');
  });

  it('gives today\'s text, under `--just-answer`, of a file nothing wrote since its generation was read', async () => {
    checkout({ 'packages/kit/src/options.ts': OPTIONS });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { out } = await run(['ask', 'symbol', '--name', 'Options', '--just-answer']);
    expect(out).toContain('packages/kit/src/options.ts:3 — readonly ci: boolean;');
  });
});
