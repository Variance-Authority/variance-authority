import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readWorkspaceForAnswer } from '@variance-authority/help';
import { sourceIndexPath } from '@variance-authority/sense';
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';
import { checkout, run } from './ask-packages.fixture.js';
import { askSource } from './ask.js';

/**
 * `variance ask` answers from the generation `variance index` published, and
 * does nothing else: it does not compare it with the checkout, whatever its age
 * or whatever was edited since, and with none published it refuses. Keeping the
 * index fresh is `variance index`'s job, run by whoever edited the checkout.
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
  it.each(['symbol', 'uses'])('answers `%s` for a function written since `variance index` from the index, and says the checkout was not compared', async (question) => {
    const root = checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const published = snapshotOf((await run(['ask', 'symbol', '--name', 'taxOf'])).out);
    write(root, KEPT);

    const { code, out } = await run(['ask', question, '--name', 'keptOf']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('`keptOf` is not');
    expect(out).not.toContain('packages/kit/src/kept.ts');
    expect(out).toMatch(/^Snapshot \d{4}-\d\d-\d\dT[\d:.]+Z, not compared with the checkout: run `variance index` if files changed since\.$/mu);
    // Nothing was read again, so nothing was published: the generation is the one `variance index` made.
    expect(snapshotOf(out)).toBe(published);
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

  it('says `search` read an index it did not compare with the checkout, since it reads the published one at any age', async () => {
    const root = checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    write(root, KEPT);

    const { code, out } = await run(['ask', 'search', '--query', 'keptOf']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('No export, top-level declaration or member of a class, an interface or a type in this repository, nor the doc of one, nor a function inside a function, writes `keptof`');
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
  it.each(['symbol', 'uses'])('answers `%s` for a name renamed in the working tree from the generation `variance index` made, and publishes none', async (question) => {
    const root = checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const before = snapshotOf((await run(['ask', question, '--name', 'taxOf'])).out);
    write(root, Object.fromEntries([TAX, IMPORTER].map((file) => [file, readFileSync(join(root, file), 'utf8').replaceAll('taxOf', 'dutyOf')])));

    const { code, out } = await run(['ask', question, '--name', 'taxOf']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain(question === 'symbol' ? `${TAX}:1` : `${IMPORTER}:`);
    expect(out).toMatch(/^Snapshot \S+, not compared with the checkout: run `variance index` if files changed since\.$/mu);
    expect(snapshotOf(out)).toBe(before);
  });

  it('answers from the generation, and publishes none, when a file a `uses` answer lists changed', async () => {
    const root = checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const before = await run(['ask', 'uses', '--name', 'taxOf']);
    expect(before.out).toContain(`${IMPORTER}:`);
    write(root, { [IMPORTER]: `// one\n// two\n// three\n${readFileSync(join(root, IMPORTER), 'utf8')}` });

    const { out } = await run(['ask', 'uses', '--name', 'taxOf']);
    expect(out).toBe(before.out);
    expect(snapshotOf(out)).toBe(snapshotOf(before.out));
  });

  it('answers from a generation older than an hour without reading the checkout', async () => {
    const root = checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const before = await run(['ask', 'symbol', '--name', 'taxOf']);
    write(root, Object.fromEntries([TAX, IMPORTER].map((file) => [file, readFileSync(join(root, file), 'utf8').replaceAll('taxOf', 'dutyOf')])));
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 2 * 60 * 60 * 1000 });
    try {
      const { out } = await run(['ask', 'symbol', '--name', 'taxOf']);
      expect(out).toBe(before.out);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses in one line naming `variance index` when no generation is published, and publishes none', async () => {
    const root = checkout();

    for (const question of [['symbol', '--name', 'taxOf'], ['search', '--query', 'taxOf']]) {
      const { code, out, err } = await run(['ask', ...question]);
      expect(code).toBe(EXIT_OPERATOR);
      expect(out).toBe('');
      // The refusal is one line; the pointer to the skill every refusal ends with follows it.
      const [refusal, ...rest] = err.trim().split('\n\n');
      expect(refusal?.split('\n')).toHaveLength(1);
      expect(refusal).toContain('Run `variance index`');
      expect(rest.join('\n\n')).toMatch(/^See the skill at /u);
    }
    expect(existsSync(`${sourceIndexPath(root)}.help.bin`)).toBe(false);
  });

  it('refuses `--just-answer`, since reading only the published generation is what every question does', async () => {
    checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, err } = await run(['ask', 'symbol', '--name', 'taxOf', '--just-answer']);
    expect(code).toBe(EXIT_OPERATOR);
    expect(err).toContain('--just-answer');
  });

  it('refuses an empty name as the tool does', async () => {
    checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, err } = await run(['ask', 'symbol', '--name', '']);
    expect(code).toBe(EXIT_OPERATOR);
    expect(err).toContain('`name` is required and must be a non-empty string');
    expect(err).not.toContain('defect in the tool');
  });

  it('dates what a generation answers, and quotes a file written since it was read as it read it', async () => {
    const root = checkout({ 'packages/kit/src/options.ts': OPTIONS });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const read = await readWorkspaceForAnswer(root, { refreshAfterMs: 0 });
    write(root, { 'packages/kit/src/options.ts': `// one\n// two\n${OPTIONS}` });

    const answer = await askSource({ question: 'symbol', name: 'Options', source: async () => ({ help: read }) });

    expect(snapshotOf(answer)).toBeDefined();
    expect(answer).toContain('packages/kit/src/options.ts:3 — readonly ci: boolean;');
    expect(answer).not.toContain('// two');
  });

  it('prints the text the index read of a file written since, and none of what the file holds today', async () => {
    const root = checkout({ 'packages/kit/src/options.ts': OPTIONS, [HIDDEN]: HIDDEN_TEXT });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    write(root, { 'packages/kit/src/options.ts': OPTIONS_REWRITTEN, [HIDDEN]: HIDDEN_REWRITTEN });

    const members = (await run(['ask', 'symbol', '--name', 'Options'])).out;
    expect(members).toContain('packages/kit/src/options.ts:3 — readonly ci: boolean;');
    expect(members).toContain('packages/kit/src/options.ts:5 — readonly step: string;');
    expect(members).not.toContain('is gone');
    expect(members).not.toContain('went elsewhere');

    const declared = (await run(['ask', 'symbol', '--name', 'hiddenOf'])).out;
    expect(declared).toContain(`declared, not exported, at ${HIDDEN}:3 by @acme/kit\nfunction hiddenOf(amount: number): number\nHalves it.\n`);
    expect(declared).not.toContain('went elsewhere');
    expect(declared).not.toContain('words of today');
  });

  it('gives the opening the index read of a file `search` found, once that file was written since', async () => {
    const opening = (words: string): string => `/**\n * Where painted ${words} dance.\n */\n\n/** One. */\nexport const pond = 1;\n`;
    const root = checkout({ 'packages/kit/src/frogs.ts': opening('frogs') });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    write(root, { 'packages/kit/src/frogs.ts': opening('toads') });

    const { out } = await run(['ask', 'search', '--query', 'painted frogs dance']);

    expect(out).toContain('packages/kit/src/frogs.ts [file] — @acme/kit — Where painted frogs dance.');
    expect(out).not.toContain('toads');
  });

  it('gives the members it recorded with the text it read of them, and none of today\'s, when lines were added above them', async () => {
    const root = checkout({ 'packages/kit/src/options.ts': OPTIONS });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    write(root, { 'packages/kit/src/options.ts': `/** One.\n * Two.\n */\nexport const lead = 1;\n${OPTIONS}` });

    const { code, out } = await run(['ask', 'symbol', '--name', 'Options']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('packages/kit/src/options.ts:3 — readonly ci: boolean;');
    expect(out).toContain('packages/kit/src/options.ts:5 — readonly step: string;');
    expect(out).not.toContain('— */');
    expect(out).not.toContain('— export interface');
  });

  it('gives the lines the index read once `variance index` ran again, at the lines the file holds them on today', async () => {
    const root = checkout({ 'packages/kit/src/options.ts': OPTIONS });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    write(root, { 'packages/kit/src/options.ts': `/** One.\n * Two.\n */\nexport const lead = 1;\n${OPTIONS}` });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'symbol', '--name', 'Options']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('at packages/kit/src/options.ts:5 by');
    expect(out).toContain('packages/kit/src/options.ts:7 — readonly ci: boolean;');
    expect(out).toContain('packages/kit/src/options.ts:9 — readonly step: string;');
  });

  it('answers from its generation when only a file the answer does not name changed', async () => {
    const root = checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const before = await run(['ask', 'symbol', '--name', 'taxOf']);
    write(root, KEPT);

    const after = await run(['ask', 'symbol', '--name', 'taxOf']);
    expect(after.out).toBe(before.out);
    expect(snapshotOf(after.out)).toBeDefined();
  });
});
