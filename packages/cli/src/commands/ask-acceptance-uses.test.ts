import { describe, expect, it } from 'vitest';
import { indexAcceptance } from './ask-acceptance.fixture.js';
import { run } from './ask-packages-fixture.js';
import { filesOf, uses } from './ask-facts.fixture.js';

/**
 * `variance ask uses` held to spec 0104: who uses each declaration of a name.
 * Facts only, through `ask-facts`; a todo is a fact the spec asks for and the
 * answer does not hold yet.
 */

indexAcceptance('uses');

describe('ask uses', () => {
  it('answers the tests that import a name apart from the source', async () => {
    const answer = await uses('greet');
    expect(filesOf(answer.uses.filter((use) => use.section === 'tests'))).toEqual(['apps/app/src/hello.test.ts']);
    expect(filesOf(answer.uses.filter((use) => use.section === 'source'))).toContain('apps/app/src/hello.ts');
  });

  it('follows a barrel to the declaration and never counts the barrel', async () => {
    const files = filesOf((await uses('greet')).uses);
    expect(files).toContain('apps/app/src/hello.ts');
    expect(files).not.toContain('packages/lib/src/index.ts');
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

  it('answers the uses of each declaration of a name apart, a local import resolved to its file', async () => {
    const { namesakes } = await uses('pngSize');
    expect(namesakes.map((one) => [one.at, one.uses.map((use) => [use.file, use.as])])).toEqual([
      ['apps/app/src/png.ts', [['apps/app/src/local-sizes.ts', 'fileSize']]],
    ]);
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

  it('never lists the importers of one published declaration under another of the same name', async () => {
    const { uses: found, namesakes } = await uses('Coverage');
    expect([filesOf(found), ...namesakes.map((one) => filesOf(one.uses))].sort()).toEqual([['apps/app/src/covered.ts'], ['apps/app/src/reviewed.ts']]);
    expect(namesakes.map((one) => one.at)).toEqual([expect.stringMatching(/^packages\/(?:core\/src\/tree|review\/src\/index)\.ts$/u)]);
  });
  it.todo('counts a name read off an `export * as` namespace (`text.shout` in loud.ts) — needs reads off a namespace import recorded as uses of the member read');
  it('follows a namespace passed to a function the file declares to where that function reads it, and says "may read it" only where it goes further', async () => {
    const handed = async (name: string): Promise<string[]> =>
      (await run(['ask', 'uses', '--name', name, '--limit', '1000'])).out.split('\n').filter((line) => line.startsWith('apps/app/src/handed.ts:'));
    expect(await handed('left')).toEqual([
      'apps/app/src/handed.ts:8 — @acme/app (namespace, line 1)',
      'apps/app/src/handed.ts:11 — @acme/app (import() on line 4)',
      'apps/app/src/handed.ts:12 — @acme/app (namespace, line 1, passed on whole: may read it)',
    ]);
    expect(await handed('right')).toEqual(['apps/app/src/handed.ts:12 — @acme/app (namespace, line 1, passed on whole: may read it)']);
  });
  it.todo('counts a destructured dynamic import (`const { greet } = await import(...)`) — needs destructuring of an `await import()` recorded as named imports');
  it.todo('does not mark `typeof lib.x` type-only — needs `typeof` in a type position told apart from a type-only import');
  it.todo('answers a module path (`packages/kit/src/money/tax.ts`) by the files importing it, on every surface — needs `uses` to accept a path and answer the importers of that file');
  it.todo('answers every use, however many there are, and narrows by --file to one declaration — needs the cap removed and a --file filter that picks the declaration');
  it.todo('answers in JSON with --format json, the same object the MCP tool returns — needs one answer object that both the CLI and the MCP tool render');
  it.todo('exits 1 when a name has no declaration, and 0 with no uses when a declaration nobody uses — needs the exit code chosen from the answer instead of always 0');
  it.todo('answers from the working tree: an import added since the index was built is a use — needs the files changed since the index re-read before the answer');
});
