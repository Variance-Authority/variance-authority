import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publishing } from './__fixtures__/published-then-written.js';
import { outlived } from './caught-up.js';
import { readWorkspace, workspaceGeneration } from './read.js';
import { search } from './tools/search.js';
import { symbol } from './tools/symbol.js';
import { uses } from './tools/uses.js';

/**
 * What an answer whose files are unchanged pays for the look: a stat of each,
 * and no second question to the source index. The index is cut at the reads
 * that cost, each still answered, so a repeated reading shows as a count.
 */

const asked = vi.hoisted(() => ({ reads: 0, importers: 0 }));

vi.mock('@variance-authority/sense', async (actual) => {
  const sense = await actual<typeof import('@variance-authority/sense')>();
  const counted = <Args extends readonly unknown[], Answer>(read: (...args: Args) => Answer) => (...args: Args): Answer => {
    asked.reads += 1;
    return read(...args);
  };
  return {
    ...sense,
    aliasesOf: counted(sense.aliasesOf),
    declaredOf: counted(sense.declaredOf),
    importersOf: (...args: Parameters<typeof sense.importersOf>) => {
      asked.importers += 1;
      return sense.importersOf(...args);
    },
    memberDeclarationsOf: counted(sense.memberDeclarationsOf),
  };
});

const fixture = publishing();
beforeEach(fixture.before);
afterEach(fixture.after);

describe('the look at an answer whose files are unchanged', () => {
  const later = (at: string | undefined): number => Date.parse(at!) + 1;

  it.each([
    [symbol, { name: 'taxOf' }],
    [uses, { name: 'taxOf' }],
    [search, { query: 'taxOf' }],
  ])('asks the source index nothing more once `$name` has answered', async (tool, input) => {
    const root = await fixture.published();
    const help = await readWorkspace(root);
    tool.run(help, input, { root });
    asked.reads = 0;

    expect(await outlived(tool.name, help, input, { root }, later(workspaceGeneration(help)))).toBe(false);
    expect(asked.reads).toBe(0);
  });

  it.each([
    [symbol, { name: 'taxOf' }],
    [uses, { name: 'taxOf' }],
  ])('leaves `$name` nothing more to ask when it looks first, as `variance ask` does', async (tool, input) => {
    const root = await fixture.published();
    const help = await readWorkspace(root);
    await outlived(tool.name, help, input, { root }, later(workspaceGeneration(help)));
    asked.reads = 0;

    tool.run(help, input, { root });
    expect(asked.reads).toBe(0);
  });

  it.each([
    [symbol, { name: 'taxOf' }],
    [uses, { name: 'taxOf' }],
  ])('walks who imports a published name for `$name` no more for the look, in either order', async (tool, input) => {
    const root = await fixture.published({
      'packages/kit/package.json': JSON.stringify({ name: '@acme/kit', exports: './src/index.ts' }),
      'packages/kit/src/index.ts': "export * from './tax.js';\n",
    });
    const alone = await readWorkspace(root);
    asked.importers = 0;
    tool.run(alone, input, { root });
    const answer = asked.importers;
    expect(answer).toBeGreaterThan(0);

    const answered = await readWorkspace(root);
    asked.importers = 0;
    tool.run(answered, input, { root });
    await outlived(tool.name, answered, input, { root }, later(workspaceGeneration(answered)));
    expect(asked.importers).toBe(answer);

    const looked = await readWorkspace(root);
    asked.importers = 0;
    await outlived(tool.name, looked, input, { root }, later(workspaceGeneration(looked)));
    tool.run(looked, input, { root });
    expect(asked.importers).toBe(answer);
  });

  it('shares nothing with another generation of the same checkout', async () => {
    const root = await fixture.published();
    symbol.run(await readWorkspace(root), { name: 'taxOf' }, { root });
    asked.reads = 0;

    symbol.run(await readWorkspace(root), { name: 'taxOf' }, { root });
    expect(asked.reads).toBeGreaterThan(0);
  });
});
