import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Help } from '@variance-authority/package/help';
import { everyEntry } from '@variance-authority/package/help';
import { spellingOf } from '@variance-authority/mcp/tools';
import { updateSourceIndex } from '@variance-authority/sense';
import { publishWorkspaceFromIndex } from '../refresh-native.js';
import { heldStore, readWorkspaceSnapshot, searchIndexOf, storeBytesOf } from '../snapshot.js';
import { answering, answers } from './declaration-key.js';
import { exportedAmong, exportedIn } from './rows.js';
import { symbol } from './symbol.js';
import { uses } from './uses.js';
import { entriesNamed, unfound } from './find.js';

/**
 * A question about one name reads the rows that name, not the workspace: the
 * opened store's export list and its imports by path are tables of every file,
 * and a question that decoded them paid for the repository to print a few rows.
 */

const before = process.env['VARIANCE_AUTHORITY_CACHE'];
beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-one-name-cache-'));
});
afterEach(() => {
  if (before === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = before;
});

/** A workspace read back from the store `variance index` publishes. */
async function published(publicEntries = false): Promise<{ readonly root: string; readonly help: Help }> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-one-name-')));
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'fixture', private: true, workspaces: ['packages/*'] }),
    'packages/kit/package.json': JSON.stringify({ name: 'kit', ...(publicEntries ? { exports: { '.': './src/public.ts', './again': './src/internal/clamp.ts', './mount': './src/internal/mount.ts', './limit': './src/internal/limit.ts', './gauge': './src/internal/door.ts', './anonymous': './src/internal/anonymous.ts', './nameless': './src/internal/nameless.ts', './other': './src/internal/other.ts' } } : {}) }),
    'packages/kit/src/internal/clamp.ts': '/** The value, held under the ceiling. */\nexport const clamp = (value: number): number => value;\n',
    'packages/kit/src/internal/mount.ts': 'function mount(): void {}\nexport default mount;\n',
    'packages/kit/src/internal/limit.ts': "export { clamp as limit } from './clamp.js';\n",
    'packages/kit/src/internal/other.ts': 'export const other = 1;\nexport const another = 2;\n',
    'packages/kit/src/internal/anonymous.ts': 'export default (): number => 1;\n',
    'packages/kit/src/internal/door.ts': "export { default as gauge } from './anonymous.js';\n",
    'packages/kit/src/internal/nameless.ts': 'export default (): number => 2;\n',
    'packages/app/package.json': JSON.stringify({ name: 'app' }),
    'packages/app/src/bounded.ts': "import { clamp } from 'kit/src/internal/clamp';\nexport const bounded = clamp(140);\n",
    'packages/app/src/mounted.ts': "import mount from 'kit/src/internal/mount';\nexport const mounted = mount();\n",
    'packages/app/src/limited.ts': "import { limit } from 'kit/src/internal/limit';\nexport const limited = limit(140);\n",
    ...(publicEntries ? {
      'packages/kit/src/public.ts': "export { clamp, clamp as ceiling } from './internal/clamp.js';\nexport { default as mount } from './internal/mount.js';\nexport { first as chosen, second as first } from './internal/two.js';\nexport * as entire from './internal/other.js';\n",
      'packages/kit/src/internal/two.ts': 'export const first = 1;\nexport const second = 2;\nexport { first as alias };\nexport default first;\n',
      'packages/second/package.json': JSON.stringify({ name: 'second', exports: './index.ts' }),
      'packages/second/index.ts': '/** Another clamp. */\nexport const clamp = (value: string): string => value;\n',
      'packages/app/src/meter.ts': "import meter from 'kit/anonymous';\nexport const measured = meter();\n",
    } : {}),
  };
  for (const [path, value] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), value);
  }
  execFileSync('git', ['init', '--quiet', root]);
  execFileSync('git', ['add', '-f', '.'], { cwd: root });
  await updateSourceIndex(root);
  await publishWorkspaceFromIndex(root, { readStartedAt: new Date().toISOString() });
  return { root, help: await readWorkspaceSnapshot(root) };
}

/** The tables of `help` something has decoded: a field still behind its getter was never read. */
function decoded(help: Help): readonly string[] {
  return (['exported', 'deep', 'byPath', 'unfollowed'] as const).filter((field) => Object.getOwnPropertyDescriptor(help, field)?.get === undefined);
}

it.each(['clamp', 'mount', 'limit'])('`symbol` answers `%s` without decoding the export list or the imports by path', async (name) => {
  const { root, help } = await published();
  const out = symbol.run(help, { name }, { root });
  expect(out).toContain(name);
  expect(out).toContain('packages/kit/src/internal/');
  expect(decoded(help)).toEqual([]);
});

it.each([symbol, uses])('`$name` reads a published name and its files without materializing every package entry', async (tool) => {
  const { root, help } = await published(true);
  const eager = heldStore(storeBytesOf(help)!);
  const all = [...everyEntry(eager)].map((_, row) => row);
  vi.spyOn(searchIndexOf(eager).rows, 'publishedCandidates').mockReturnValue(all);
  const entries = vi.spyOn(searchIndexOf(help).rows, 'entry');
  const input = { name: 'clamp' };
  const expected = tool.run(eager, input, { root });
  const files = tool.files?.(eager, input, { root });
  expect(tool.files?.(help, input, { root })).toEqual(files);
  expect(tool.run(help, input, { root })).toBe(expected);
  expect(tool.files?.(help, input, { root })).toEqual(files);
  expect(entries.mock.results.every((result) => result.value.declared === 'clamp')).toBe(true);
  expect(Object.getOwnPropertyDescriptor(help, 'packages')?.get).toBeTypeOf('function');
  expect(decoded(help)).toEqual([]);
  const observe = (read: () => unknown): unknown => {
    try { return read(); } catch (error) { return String(error); }
  };
  for (const input of [
    ...['ceiling', 'mount', 'limit', 'gauge', 'default', 'meter', 'first', 'second', 'alias', 'chosen', 'other', 'nothing'].map((name) => ({ name })),
    { name: 'clamp', package: 'second' }, { name: 'clamp', package: 'kit/again' }, { name: 'clamp', package: 'absent' },
  ]) {
    expect(observe(() => tool.run(help, input, { root }))).toEqual(observe(() => tool.run(eager, input, { root })));
    expect(observe(() => tool.files?.(help, input, { root }))).toEqual(observe(() => tool.files?.(eager, input, { root })));
    const packages: Help['packages'] = Object.getOwnPropertyDescriptor(help, 'packages')?.value ?? [];
    const opened = packages.flatMap((held) => Object.getOwnPropertyDescriptor(held, 'openings')?.value ?? []);
    expect(opened.filter((opening) => Object.getOwnPropertyDescriptor(opening, 'entries')?.get === undefined), JSON.stringify(input)).toEqual([]);
  }
});

it.each(['entries', 'unfound'])('keeps the public %s helper usable with an already decoded Help value', async (question) => {
  const { help } = await published(true);
  const raw: Help = JSON.parse(JSON.stringify(help));
  const read = (value: Help) => question === 'entries' ? entriesNamed(value, 'clamp') : unfound(value, 'CLAMP', undefined, spellingOf());
  expect(read(raw)).toEqual(read(help));
});

// The fixture's imports resolve to no file: `clamp` and `limit` are found by the path they spell, a default import by none.
it.each([
  ['clamp', 'packages/app/src/bounded.ts'],
  ['mount', 'packages/kit/src/internal/mount.ts'],
  ['limit', 'packages/app/src/limited.ts'],
])('`uses` answers `%s` without decoding the export list or the imports by path', async (name, place) => {
  const { root, help } = await published();
  const out = uses.run(help, { name }, { root });
  expect(out).toContain(place);
  expect(decoded(help)).toEqual([]);
});

it('names an anonymous default by the export that passes it on, read off the rows of the file that does', async () => {
  const { root, help } = await published();
  const out = symbol.run(help, { name: 'gauge' }, { root });
  expect(out).toContain('It passes on `gauge`, declared at packages/kit/src/internal/anonymous.ts:1');
  expect(decoded(help)).toEqual([]);
});

it.each(['clamp', 'mount', 'limit', 'gauge', 'default', 'other', 'nothing'])('finds for `%s` the exports the whole list, asked one by one, says answer to it', async (name) => {
  const { root, help } = await published();
  const found = answering(help, root, name);
  expect(found).toEqual(help.exported.filter((held) => answers(help, root, held, name)));
  if (name !== 'nothing') expect(found.length).toBeGreaterThan(0);
});

it('reads the exports of several files in the order the whole list holds them, whatever order the files are asked in', async () => {
  const { help } = await published();
  const among = ['packages/kit/src/internal/other.ts', 'packages/kit/src/internal/clamp.ts', 'packages/kit/src/internal/limit.ts'];
  const found = exportedAmong(help, among);
  expect(found).toEqual(help.exported.filter((held) => among.includes(held.at)));
  expect(found.length).toBe(4);
});

it('reads no export for a file the store does not hold', async () => {
  const { help } = await published();
  expect(exportedIn(help, 'packages/kit/src/internal/absent.ts')).toEqual([]);
  expect(exportedAmong(help, ['packages/kit/src/internal/absent.ts'])).toEqual([]);
});
