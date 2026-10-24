import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { ACCEPTANCE } from './ask-acceptance-fixture.js';
import { filesOf, uses } from './ask-facts.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `variance ask uses` held to spec 0104: who uses each declaration of a name.
 * Facts only, through `ask-facts`; a todo is a fact the spec asks for and the
 * answer does not hold yet.
 */

const cwd = process.cwd();

beforeAll(async () => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-acceptance-uses-'));
  checkout(ACCEPTANCE);
  expect((await run(['index'])).code).toBe(EXIT_CLEAN);
});

afterAll(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

describe('ask uses', () => {
  it('answers the tests that import a name apart from the source', async () => {
    const answer = await uses('greet');
    expect(filesOf(answer.uses.filter((use) => use.section === 'tests'))).toEqual(['apps/app/src/hello.test.ts']);
    expect(filesOf(answer.uses.filter((use) => use.section === 'source'))).toContain('apps/app/src/hello.ts');
  });

  it('follows a barrel to the declaration and never counts the barrel', async () => {
    expect(filesOf((await uses('greet')).uses)).not.toContain('packages/lib/src/index.ts');
  });

  it('says which import renames it, which loads it by import(), and which passes the module on whole', async () => {
    const byFile = new Map((await uses('greet')).uses.map((use) => [use.file, use]));
    expect(byFile.get('apps/app/src/renamed.ts')).toMatchObject({ as: 'hi' });
    expect(byFile.get('apps/app/src/later.ts')).toMatchObject({ dynamic: true });
    expect(byFile.get('apps/app/src/whole.ts')).toMatchObject({ passedOnWhole: true });
    expect(byFile.get('apps/app/src/hello.ts')).toMatchObject({ as: undefined, dynamic: false, passedOnWhole: false, typeOnly: false });
  });

  it('says which import is type-only', async () => {
    const { uses: found } = await uses('Tree');
    expect(found.map((use) => [use.file, use.typeOnly])).toEqual([
      ['apps/app/src/typed.ts', true],
      ['apps/app/src/written.ts', true],
    ]);
  });

  it('never counts an import of a namesake as a use', async () => {
    expect(filesOf((await uses('pngSize')).uses)).toEqual(['apps/app/src/sizes.ts']);
  });

  it('answers an unexported name by its uses in its own file', async () => {
    expect((await uses('gitNames')).uses).toEqual([expect.objectContaining({ file: 'packages/core/src/git.ts', section: 'own-file' })]);
  });

  it('answers a member by its uses through its container, each a read or a write', async () => {
    const answer = await uses('has');
    expect(answer.memberOf).toEqual(['Tree']);
    expect(answer.uses.map((use) => [use.file, use.container, use.access])).toEqual([
      ['apps/app/src/typed.ts', 'Tree', 'read'],
      ['apps/app/src/written.ts', 'Tree', 'write'],
    ]);
  });

  it.todo('answers the uses of each declaration of a name apart: `pngSize` in apps/app is used by sizes.ts as `fileSize` — needs uses keyed by declaration, local imports resolved to their file');
  it.todo('never lists the importers of one declaration under another of the same name (`Coverage`) — needs importers grouped by the declaration their specifier resolves to');
  it.todo('counts a name read off an `export * as` namespace (`text.shout` in loud.ts) — needs reads off a namespace import recorded as uses of the member read');
  it.todo('follows a namespace passed on whole to where it is read, instead of answering "may read it" — needs the namespace followed into the function it is passed to');
  it.todo('counts a destructured dynamic import (`const { greet } = await import(...)`) — needs destructuring of an `await import()` recorded as named imports');
  it.todo('does not mark `typeof lib.x` type-only — needs `typeof` in a type position told apart from a type-only import');
  it.todo('answers a module path (`packages/kit/src/money/tax.ts`) by the files importing it, on every surface — needs `uses` to accept a path and answer the importers of that file');
  it.todo('answers every use, however many there are, and narrows by --file to one declaration — needs the cap removed and a --file filter that picks the declaration');
  it.todo('answers in JSON with --format json, the same object the MCP tool returns — needs one answer object that both the CLI and the MCP tool render');
  it.todo('exits 1 when a name has no declaration, and 0 with no uses when a declaration nobody uses — needs the exit code chosen from the answer instead of always 0');
  it.todo('answers from the working tree: an import added since the index was built is a use — needs the files changed since the index re-read before the answer');
});
