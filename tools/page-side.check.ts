import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAGE_SIDE, RUNTIME, SERIALIZED, claims, probeable, sourceStem } from './page-side.mjs';
import { selectionOf } from '../vitest.config.mts';
import { ROOT, sourceFiles } from './workspaces.js';

/**
 * The exclusion list, checked in the direction the suite cannot check itself.
 *
 * `tools/page-side.mjs` names the modules `yarn test` must not instrument, and a
 * missing entry is already loud: the probe throws `ReferenceError` in a headless
 * page and the suite goes red. Nothing watches the other direction. An entry
 * that has stopped being true — the module renamed or gone — costs that module
 * its measurement in every run from then on, silently: one in `SERIALIZED` is
 * marked as loaded instead, so a change to it selects every test file that
 * loaded it rather than the cases that ran it, and one in `RUNTIME` is
 * answered by the import graph alone.
 *
 * A module that hands its own function to a page is not listed, because the
 * instrumenter finds that function from the call and leaves only it bare; so
 * there is no call for this check to look for.
 */

/** Never instrumented, so never able to lose a probe it was not given. */
const TEST = /\.(test|spec|measure)\.[cm]?[jt]sx?$/;

/**
 * What `vitest.config.mts` would instrument, in the shape it decides it.
 *
 * A workspace's `src`, and nothing else under it. The `collector` and `scripts`
 * directories beside it hold production code the CLI loads in its own process,
 * and no probe is placed in them, because the suite's `PRODUCT` pattern does
 * not reach there.
 */
const modules = ['packages', 'examples', 'cases']
  .flatMap((group) => sourceFiles(join(ROOT, group)))
  .filter((file) => /\/(packages|examples|cases)\/[^/]+\/src\//.test(file) && !TEST.test(file));

describe('every entry names a module that is there', () => {
  it.each(PAGE_SIDE)('%s', (entry: string) => {
    const found = modules.filter((file) => claims(entry, sourceStem(ROOT, file)));
    expect(found, `${entry} claims no module in this repository`).not.toHaveLength(0);
  });

  it('claims each module once', () => {
    const shadowed = PAGE_SIDE.filter((entry: string) =>
      PAGE_SIDE.some((other: string) => other !== entry && claims(other, entry.replace(/\/$/, ''))),
    );
    expect(shadowed, 'already covered by a directory entry above them').toEqual([]);
  });
});

describe('the list governs the run', () => {
  it('is what the suite config subtracts', () => {
    const config = readFileSync(join(ROOT, 'vitest.config.mts'), 'utf8');
    expect(config).toContain("from './tools/page-side.mjs'");
    expect(config).toContain('probeable(ROOT, file)');
  });

  it('names a real file for each stem in both shapes', () => {
    const missing = PAGE_SIDE.filter(
      (entry: string) =>
        !entry.endsWith('/') && !['.ts', '.tsx', '.cts', '.mts'].some((extension) => existsSync(join(ROOT, `${entry}${extension}`))),
    );
    expect(missing, 'renamed or deleted since somebody wrote them down').toEqual([]);
  });
});

describe('a module the list keeps unprobed is marked as loaded, except the probe runtime', () => {
  const { include, unprobed } = selectionOf('unit');
  const claimed = (entries: readonly string[]) => (file: string) =>
    entries.some((entry) => claims(entry, sourceStem(ROOT, file)));

  it.each(SERIALIZED)('%s is marked, so a change to it selects the tests that loaded it', (entry: string) => {
    const sources = modules.filter(claimed([entry]));
    expect(sources.filter((file) => include(file) || !unprobed(file)).map((file) => relative(ROOT, file))).toEqual([]);
  });

  it('marks the built module as it marks its source', () => {
    const built = join(ROOT, 'packages/storybook/dist/show-story.js');
    expect([include(built), unprobed(built)]).toEqual([false, true]);
  });

  it('neither probes nor marks the probe runtime, which the mark itself calls', () => {
    const runtime = modules.filter(claimed(RUNTIME));
    expect(runtime).not.toHaveLength(0);
    expect(runtime.filter((file) => include(file) || unprobed(file)).map((file) => relative(ROOT, file))).toEqual([]);
  });

  it('marks nothing the list does not name', () => {
    const named = modules.filter((file) => unprobed(file) && probeable(ROOT, file));
    expect(named.map((file) => relative(ROOT, file))).toEqual([]);
  });
});
