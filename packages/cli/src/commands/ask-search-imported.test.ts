import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { workspaceSnapshotPath } from '@variance-authority/help';
import { sourceIndexPath } from '@variance-authority/sense';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `variance ask search` says, beside each published name, how many places
 * import it and how many packages those places sit in, and the count is the
 * one `variance ask uses` gives for that name, whatever door each place
 * imports it through.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-search-imported-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

/** Five files of `@acme/lib` that import `greet` from its declaration, beside the one import from `@acme/app`. */
const FIVE_WITHIN = Object.fromEntries(
  ['one', 'two', 'three', 'four', 'five'].map((file) => [`packages/lib/src/${file}.ts`, `import { greet } from './greet.js';\nexport const ${file} = greet('${file}');\n`]),
);

/** The rows `search` prints for `greet`, by the door each is published from. */
const greetRows = (out: string): readonly string[] => out.split('\n').filter((line) => / · greet \[function\] /u.test(line));

/** How many places `uses` says import `name`. */
async function usesCount(name: string): Promise<number> {
  const { out } = await run(['ask', 'uses', '--name', name]);
  const count = /is imported in (\d+) place/u.exec(out)?.[1];
  if (count === undefined) throw new Error(`uses gave no count for ${name}:\n${out}`);
  return Number(count);
}

describe('variance ask search counts the places that import a published name as uses does', () => {
  it('counts the places inside the declaring package with the one from another package', async () => {
    checkout(FIVE_WITHIN);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    expect(await usesCount('greet')).toBe(6);
    const search = await run(['ask', 'search', '--query', 'greet']);
    expect(search.code).toBe(EXIT_CLEAN);
    expect(greetRows(search.out)).toEqual(['@acme/lib · greet [function] imported in 6 places in 2 packages — UNDOCUMENTED']);
  });

  it('counts a place that imports the name by its own package once', async () => {
    // The shape of a test importing its package by name: one import by a published specifier from inside the package.
    checkout({
      'packages/lib/src/self.ts': "import { greet } from '@acme/lib';\nexport const self = greet('self');\n",
      'packages/lib/src/near.ts': "import { greet } from './greet.js';\nexport const near = greet('near');\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    expect(await usesCount('greet')).toBe(3);
    const search = await run(['ask', 'search', '--query', 'greet']);
    expect(greetRows(search.out)).toEqual(['@acme/lib · greet [function] imported in 3 places in 2 packages — UNDOCUMENTED']);
  });

  it('gives each door that publishes one declaration the count of every place that imports it', async () => {
    checkout({
      'packages/relay/package.json': JSON.stringify({ name: '@acme/relay', main: 'src/index.ts' }),
      'packages/relay/src/index.ts': "export { greet } from '@acme/lib';\n",
      'apps/app/src/relayed.ts': "import { greet } from '@acme/relay';\nexport const relayed = greet('relay');\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    // `uses` lists the entry of `@acme/relay` that passes it on among the places.
    expect(await usesCount('greet')).toBe(3);
    const search = await run(['ask', 'search', '--query', 'greet']);
    expect(greetRows(search.out)).toEqual([
      '@acme/lib · greet [function] imported in 3 places in 2 packages — UNDOCUMENTED',
      '@acme/relay · greet [function] imported in 3 places in 2 packages — UNDOCUMENTED',
    ]);
  });

  it('carries the count as data', async () => {
    checkout(FIVE_WITHIN);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { out } = await run(['ask', 'search', '--query', 'greet', '--format', 'json']);
    const [row] = (JSON.parse(out) as { published: { shown: { name: string; importedIn?: unknown }[] } }).published.shown.filter((one) => one.name === 'greet');
    expect(row?.importedIn).toEqual({ places: 6, packages: 2 });
  });

  it('ranks a name imported in more packages, then in more places, above one imported in fewer', async () => {
    // The shape MUI showed: `TouchRippleClasses`, imported in one place within its package, sorted below `TouchRippleProps`, imported nowhere, because neither is imported from another package by a published path.
    checkout({
      'packages/lib/src/index.ts': "export { greet } from './greet.js';\nexport { toneLoud, toneQuiet } from './tone.js';\n",
      'packages/lib/src/tone.ts': 'export const toneLoud = 1;\nexport const toneQuiet = 2;\n',
      'packages/lib/src/quiet.ts': "import { toneQuiet } from './tone.js';\nexport const quiet = toneQuiet;\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const search = await run(['ask', 'search', '--query', 'tone']);
    expect(search.code).toBe(EXIT_CLEAN);
    expect(search.out.split('\n').filter((line) => / · tone\w+ \[/u.test(line))).toEqual([
      '@acme/lib · toneQuiet [const] imported in 1 place in 1 package — UNDOCUMENTED',
      '@acme/lib · toneLoud [const] imported nowhere — UNDOCUMENTED',
    ]);
  });

  it('says a name nothing imports is imported nowhere', async () => {
    checkout({ 'apps/app/src/hello.ts': 'export const hello = 1;\n' });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const search = await run(['ask', 'search', '--query', 'greet']);
    expect(greetRows(search.out)).toEqual(['@acme/lib · greet [function] imported nowhere — UNDOCUMENTED']);
  });

  it('counts what uses counts when the source index does not read, and says what is left out', async () => {
    const root = checkout(FIVE_WITHIN);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    writeFileSync(sourceIndexPath(root), 'not a source index');

    expect(await usesCount('greet')).toBe(1);
    const { code, out } = await run(['ask', 'search', '--query', 'greet']);
    expect(code).toBe(EXIT_CLEAN);
    expect(greetRows(out)).toEqual(['@acme/lib · greet [function] imported in 1 place in 1 package — UNDOCUMENTED']);
    expect(out).toMatch(/^Imports that do not name a package path are not counted: .*run `variance index`\.$/mu);
  });

  it('reads no value for a question whose rows include no published name', async () => {
    const root = checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    // A value read at all says it did not open; a question that counts no row never reads it.
    writeFileSync(workspaceSnapshotPath(sourceIndexPath(root)), 'not a value');

    const { code, out } = await run(['ask', 'search', '--query', 'stamp']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toMatch(/^stamp /mu);
    expect(out).not.toMatch(/did not open/u);
  });

  it('says the value did not open when it counts by published path instead', async () => {
    const root = checkout(FIVE_WITHIN);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    writeFileSync(workspaceSnapshotPath(sourceIndexPath(root)), 'not a value');

    const { code, out } = await run(['ask', 'search', '--query', 'greet']);
    expect(code).toBe(EXIT_CLEAN);
    expect(greetRows(out)).toEqual(['@acme/lib · greet [function] 1 import by published path from 1 other package — UNDOCUMENTED']);
    expect(out).toMatch(/^The published value at .* did not open \(.*\); the published search, with the counts it carries, was read instead\.$/mu);
  });

  it('says no other package imports a name by its published path when that count is zero', async () => {
    const root = checkout({ ...FIVE_WITHIN, 'apps/app/src/hello.ts': 'export const hello = 1;\n' });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    writeFileSync(workspaceSnapshotPath(sourceIndexPath(root)), 'not a value');

    const { out } = await run(['ask', 'search', '--query', 'greet']);
    expect(greetRows(out)).toEqual(['@acme/lib · greet [function] no other package imports it by its published path — UNDOCUMENTED']);
  });
});
