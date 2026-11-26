import * as sense from '@variance-authority/sense';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { publishing } from '../__fixtures__/published-then-written.js';
import { readWorkspace } from '../read.js';
import { FoundNothing } from './find.js';
import { symbol } from './symbol.js';
import { uses } from './uses.js';

// compass: variance-authority.report.agent-surface

const fixture = publishing();
beforeEach(fixture.before);
afterEach(() => {
  vi.restoreAllMocks();
  fixture.after();
});

/** What `tool` says of `input`, or the text of the nothing it found. */
function said(tool: typeof symbol, help: Awaited<ReturnType<typeof readWorkspace>>, input: Readonly<Record<string, unknown>>, root: string, shell: string | undefined): string {
  try {
    return tool.run(help, input, shell === undefined ? { root } : { root, shell });
  } catch (missed) {
    if (!(missed instanceof FoundNothing)) throw missed;
    return `nothing: ${missed.message}`;
  }
}

for (const [tool, entry] of [[symbol, 'answerSymbol'], [uses, 'answerUses']] as const) {
  it(`${tool.name} answers through the addon, word for word what its own reading says`, async () => {
    const root = await fixture.published();
    const asked = vi.spyOn(sense, entry);
    // Over the wire and from a shell, each spells the inputs and the tools its answer names as its host does.
    for (const shell of [undefined, 'variance ask']) {
      for (const name of ['taxOf', 'nothingDeclaresThis']) {
        const native = said(tool, await readWorkspace(root), { name, limit: 3 }, root, shell);
        expect(asked).toHaveLastReturnedWith(expect.objectContaining({ found: name === 'taxOf' }));
        asked.mockReturnValueOnce(undefined);
        expect(said(tool, await readWorkspace(root), { name, limit: 3 }, root, shell)).toBe(native);
      }
    }
  });
}

it('docs_symbol hands its start points to the addon, which orders by them', async () => {
  const root = await fixture.published();
  const asked = vi.spyOn(sense, 'answerSymbol');
  symbol.run(await readWorkspace(root), { name: 'taxOf', from: 'packages/kit/src/tax.ts' }, { root });
  expect(asked).toHaveBeenCalledWith(root, expect.anything(), expect.objectContaining({ from: ['packages/kit/src/tax.ts'] }));
  expect(asked).toHaveLastReturnedWith(expect.objectContaining({ found: true }));
});
