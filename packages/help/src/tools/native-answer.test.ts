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
  it(`${tool.name} answers through the addon, its text and whether it found the name`, async () => {
    const root = await fixture.published();
    const asked = vi.spyOn(sense, entry);
    // Over the wire and from a shell, each spells the inputs and the tools its answer names as its host does.
    for (const shell of [undefined, 'variance ask']) {
      for (const name of ['taxOf', 'nothingDeclaresThis']) {
        const answer = said(tool, await readWorkspace(root), { name, limit: 3 }, root, shell);
        expect(asked).toHaveLastReturnedWith(expect.objectContaining({ found: name === 'taxOf' }));
        const last = asked.mock.results.at(-1)?.value as { readonly text: string } | undefined;
        const text = last?.text;
        expect(answer).toBe(name === 'taxOf' ? text : `nothing: ${text}`);
      }
    }
  });

  it(`${tool.name} refuses a host that named no checkout`, async () => {
    const help = await readWorkspace(await fixture.published());
    expect(() => tool.run(help, { name: 'taxOf' }, undefined)).toThrow(`\`${tool.name}\` reads the source index of a checkout, and this host named none`);
  });

  it(`${tool.name} refuses a host that holds no snapshot`, async () => {
    const root = await fixture.published();
    // A copy was read from no store, so it holds none.
    const help = { ...(await readWorkspace(root)) };
    expect(() => tool.run(help, { name: 'taxOf' }, { root })).toThrow(`\`${tool.name}\` reads a published workspace snapshot, and this host holds none; run \`variance index\``);
  });

  it(`${tool.name} says why, in the addon's words, when the answer did not read`, async () => {
    const root = await fixture.published();
    const help = await readWorkspace(root);
    vi.spyOn(sense, entry).mockImplementation(() => { throw new Error('the answer did not read: the export is bound to no declaration.'); });
    expect(() => tool.run(help, { name: 'taxOf' }, { root })).toThrow(/^the answer did not read: the export is bound to no declaration\.$/u);
  });

  it(`${tool.name} says no source index is published when the addon finds none`, async () => {
    const root = await fixture.published();
    const help = await readWorkspace(root);
    vi.spyOn(sense, entry).mockReturnValue(undefined);
    expect(() => tool.run(help, { name: 'taxOf' }, { root })).toThrow('no source index is published; run `variance index`');
  });
}

it('docs_symbol hands its start points to the addon, which orders by them', async () => {
  const root = await fixture.published();
  const asked = vi.spyOn(sense, 'answerSymbol');
  symbol.run(await readWorkspace(root), { name: 'taxOf', from: 'packages/kit/src/tax.ts' }, { root });
  expect(asked).toHaveBeenCalledWith(root, expect.anything(), expect.objectContaining({ from: ['packages/kit/src/tax.ts'] }));
  expect(asked).toHaveLastReturnedWith(expect.objectContaining({ found: true }));
});
