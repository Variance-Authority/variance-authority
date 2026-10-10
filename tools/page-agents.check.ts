import { beforeAll, describe, expect, it } from 'vitest';
import { beforeReach, changedBefore, relationsOfFiles, type Relations } from '@variance-authority/core/relate';
import { scanRelations } from '@variance-authority/sense';
import { beforeOf } from '@variance-authority/sense/test-selection';
import { AGENTS, ROOT, inputsOf } from './page-agents.mjs';

/**
 * What the page-agent bundles are built from is declared to the suite that
 * injects them.
 *
 * A bundle is read as text and run in a browser, so no test loads its inputs
 * through the runner and no recording holds a line of them: an edit confined
 * to them selected nothing under `yarn test:since`. The `chromium` suite's
 * `before` in `variance.config.json` names each bundle's entry, and selection
 * walks forward from an entry, so an edit to anything a bundle is built from
 * runs that whole suite. Over-picking, and declared, which is the difference
 * from an answer that silently selects nothing.
 *
 * The list each bundle is held to is esbuild's, asked with the options the
 * build uses (`tools/page-agents.mjs`), so a bundle that gains an input the walk
 * does not reach — a file it reads through a plugin, a path the scan cannot
 * resolve — fails here rather than in a run that skipped the suite.
 */
describe('the page-agent bundles rest under the chromium suite', () => {
  const declared = beforeOf(ROOT, 'chromium');
  let bundles: { entry: string; inputs: string[] }[];
  let relations: Relations;

  beforeAll(async () => {
    bundles = await Promise.all(AGENTS.map(inputsOf));
    relations = relationsOfFiles(await scanRelations({ root: ROOT, dirs: ['packages'] }));
  }, 60_000);

  it('declares the entry of every bundle the build writes', () => {
    expect(bundles.map((bundle) => bundle.entry).filter((entry) => !declared.includes(entry))).toEqual([]);
  });

  it('declares nothing for the suite that is not a bundle the build writes', () => {
    const entries = new Set(bundles.map((bundle) => bundle.entry));
    expect(declared.filter((entry) => !entries.has(entry))).toEqual([]);
  });

  it('runs the whole suite for an edit to any file a bundle is built from', () => {
    const inputs = [...new Set(bundles.flatMap((bundle) => bundle.inputs))].sort();
    expect(inputs.length).toBeGreaterThan(AGENTS.length);
    const before = beforeReach(relations, declared);
    expect(inputs.filter((input) => !changedBefore(before, [input]).includes(input))).toEqual([]);
  });
});
