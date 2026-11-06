import { afterEach, expect, it, vi } from 'vitest';
import { treeOf } from '@variance-authority/mcp/tools';
import { readHelp } from '@variance-authority/package/help';
import { declaredOf } from '@variance-authority/sense';
import { INVENTED_PACKAGES } from '../__fixtures__/invented-packages.js';
import { inventedWorkspace } from '../__fixtures__/invented-workspace.js';
import { answerSearch, searchIndexOf } from './search.js';
import { symbol } from './symbol.js';

/**
 * A rule written only as a test is found by what the test says: its title, in
 * the words it is written in with others between them, and the doc above the
 * call. A block is no declaration, so it is marked as a test, and a question for
 * a name never meets one.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

const RULE = [
  "import { describe, it } from 'vitest';",
  '',
  '/**',
  ' * A pinned browser image is a declared requirement, and it must match.',
  ' */',
  "describe('a pinned browser image matches the playwright it runs', () => {",
  "  it.each(['a'])('%s', () => {});",
  "  it('keeps one tag per image', () => {});",
  '});',
  '',
].join('\n');

const asked = async (query: string): Promise<string> => {
  const root = await inventedWorkspace(INVENTED_PACKAGES, [], { 'tools/rules.check.ts': RULE });
  return answerSearch(searchIndexOf(readHelp(root)), { query }, treeOf([], root), root);
};

it('finds a block by its title, the words apart, marked as a test at its file and line', async () => {
  const said = await asked('pinned browser image matches playwright');

  expect(said).toContain('a pinned browser image matches the playwright it runs [test] — fixture · tools/rules.check.ts:6');
  expect(said).not.toContain('No export');
});

it('finds a block inside a block by a piece of its title', async () => {
  expect(await asked('one tag per')).toContain('keeps one tag per image [test] — fixture · tools/rules.check.ts:8');
});

it('finds a block by the doc above the call, and shows the doc it matched', async () => {
  expect(await asked('pinned browser image is a declared requirement')).toContain(
    'tools/rules.check.ts:6 — A pinned browser image is a declared requirement, and it must match.',
  );
});

it('says a title was read when no block writes the question', async () => {
  expect(await asked('resize every thumbnail')).toContain("nor a function inside a function, nor a test's title or the doc above it, writes `resize every thumbnail`");
});

it('takes no row for a title that spells nothing', async () => {
  expect(await asked('%s')).not.toContain('[test]');
});

it('answers no question for a name with a block', async () => {
  const root = await inventedWorkspace(INVENTED_PACKAGES, [], { 'tools/rules.check.ts': RULE });

  expect(declaredOf(root, 'keeps one tag per image', {})?.names).toEqual([]);
  expect(() => symbol.run(readHelp(root), { name: 'keeps one tag per image' }, { root })).toThrow('No file in this workspace declares');
});
