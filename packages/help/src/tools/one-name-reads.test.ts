import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { Help } from '@variance-authority/package/help';
import { updateSourceIndex } from '@variance-authority/sense';
import { publishWorkspaceFromIndex } from '../refresh-native.js';
import { readWorkspaceSnapshot } from '../snapshot.js';
import { answering, answers } from './declaration-key.js';
import { exportedAmong, exportedIn } from './rows.js';
import { symbol } from './symbol.js';
import { uses } from './uses.js';

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
async function published(): Promise<{ readonly root: string; readonly help: Help }> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-one-name-')));
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'fixture', private: true, workspaces: ['packages/*'] }),
    'packages/kit/package.json': JSON.stringify({ name: 'kit' }),
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

it.each(['clamp', 'mount', 'limit'])('`uses` answers `%s` without decoding the export list or the imports by path', async (name) => {
  const { root, help } = await published();
  const out = uses.run(help, { name }, { root });
  expect(out).toContain('packages/app/src/');
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
