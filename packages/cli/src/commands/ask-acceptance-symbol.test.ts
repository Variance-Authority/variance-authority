import { describe, expect, it } from 'vitest';
import { indexAcceptance } from './ask-acceptance.fixture.js';
import { symbol } from './ask-facts.fixture.js';

/**
 * `variance ask symbol` held to spec 0104: what a name is, and where each of
 * its declarations is. Facts only, through `ask-facts`; a todo is a fact the
 * spec asks for and the answer does not hold yet.
 */

indexAcceptance('symbol');

describe('ask symbol', () => {
  it('answers a published name with the import a caller pastes', async () => {
    const { declarations } = await symbol('greet');
    expect(declarations).toEqual([
      expect.objectContaining({ kind: 'function', visibility: 'published', file: 'packages/lib/src/greet.ts', specifier: '@acme/lib' }),
    ]);
  });

  it('answers the subpath that publishes a name, not the package root', async () => {
    const { declarations } = await symbol('normalize');
    expect(declarations[0]).toMatchObject({ visibility: 'published', specifier: '@acme/core/rules' });
  });

  it('says a name no export names is unexported, and where', async () => {
    const { declarations } = await symbol('gitNames');
    expect(declarations).toEqual([expect.objectContaining({ visibility: 'unexported', file: 'packages/core/src/git.ts' })]);
  });

  it('tells a name exported behind no entry apart from a published one', async () => {
    const { declarations } = await symbol('clamp');
    expect(declarations).toEqual([expect.objectContaining({ kind: 'const', visibility: 'exported', file: 'packages/lib-exports/src/internal/clamp.ts' })]);
  });

  it('answers a name exported for a neighbour by its kind, as a published one is', async () => {
    const { declarations } = await symbol('limitOf');
    expect(declarations).toEqual([expect.objectContaining({ kind: 'function', visibility: 'exported', file: 'apps/app/src/limits.ts' })]);
  });

  it('names the files that import a declaration under another name', async () => {
    const { declarations } = await symbol('greet');
    expect(declarations[0]!.aliases).toEqual([{ file: 'apps/app/src/renamed.ts', local: 'hi' }]);
  });

  it('answers a local alias with the declaration it imports', async () => {
    const answer = await symbol('hi');
    expect(answer.localOf).toEqual({ file: 'apps/app/src/renamed.ts', imported: 'greet' });
    expect(answer.declarations[0]).toMatchObject({ name: 'greet', file: 'packages/lib/src/greet.ts' });
  });

  it('answers an interface member with its container', async () => {
    const { declarations } = await symbol('has');
    expect(declarations).toEqual([expect.objectContaining({ visibility: 'member', container: 'Tree', file: 'packages/core/src/tree.ts' })]);
  });

  it('answers a class member with its container', async () => {
    const { declarations } = await symbol('seedFiles');
    expect(declarations).toEqual([expect.objectContaining({ visibility: 'member', container: 'Scanner', file: 'packages/core/src/scanner.ts' })]);
  });

  it('answers a type alias by its kind', async () => {
    const { declarations } = await symbol('CheckoutPath');
    expect(declarations[0]).toMatchObject({ kind: 'type', visibility: 'published', specifier: '@acme/core' });
  });

  it('answers a name nothing declares with no declaration', async () => {
    expect(await symbol('nothingNamedThis')).toMatchObject({ declarations: [], missed: true });
  });

  it('answers every declaration of a name, published first', async () => {
    const { declarations } = await symbol('pngSize');
    expect(declarations.map((one) => [one.visibility, one.file])).toEqual([
      ['published', 'packages/core/src/png.ts'],
      ['exported', 'apps/app/src/png.ts'],
    ]);
  });
  it('answers each published declaration of a name apart, with the import that reaches it', async () => {
    const { declarations } = await symbol('Coverage');
    expect(declarations.map((one) => [one.visibility, one.file, one.specifier]).sort()).toEqual([
      ['published', 'packages/core/src/tree.ts', '@acme/core'],
      ['published', 'packages/review/src/index.ts', '@acme/review'],
    ]);
  });
  it.todo('answers a name published only inside an `export * as` namespace as published, with the import that reaches it (`text.shout`) — needs the publish walk to follow `export * as` into the namespace\'s module');
  it('answers `Container.member` (`Tree.has`) as the member of that container', async () => {
    const { declarations } = await symbol('Tree.has');
    expect(declarations).toEqual([expect.objectContaining({ visibility: 'member', container: 'Tree', file: 'packages/core/src/tree.ts' })]);
  });
  it.todo('answers a re-export of a dependency (`export { x } from \'dep\'`) as where it came from, not as a declaration — needs a re-export from a dependency recorded as a re-export, not a declaration');
  it.todo('answers a function declared inside another function, with the function that holds it — needs nested declarations in the index with the declaration that holds them');
  it.todo('answers every declaration, however many there are, and narrows by --file and --kind — needs the cap removed and --file and --kind filters on the reader');
  it.todo('answers in JSON with --format json, the same object the MCP tool returns — needs one answer object that both the CLI and the MCP tool render');
  it.todo('exits 1 on a miss and 2 on an error, and a miss is one line naming the nearest declared names — needs the miss answered from the nearest-name list, and the exit code chosen from the answer');
  it.todo('answers a miss as fast as a hit — needs the miss to skip the dependency and text scans it runs today');
  it.todo('carries no dependency README prose and names no tool of another surface — needs the README excerpt and the `docs_*` routes dropped from the CLI renderer');
  it.todo('answers from the working tree: a file edited since the index was built is read as it is now — needs the files changed since the index re-read before the answer');
});
