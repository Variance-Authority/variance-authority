import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAGE_SIDE, claims, sourceStem } from './page-side.mjs';
import { ROOT, sourceFiles } from './workspaces.js';

/**
 * The exclusion list, checked in the direction the suite cannot check itself.
 *
 * `tools/page-side.mjs` names the modules `yarn test` must not instrument, and a
 * missing entry is already loud: the probe throws `ReferenceError` in a headless
 * page and the suite goes red. Nothing watches the other direction. An entry
 * that has stopped being true — the module renamed or gone — costs that module
 * its measurement in every run from then on, silently, and `yarn test:since`
 * narrows around a hole nobody can see.
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
      (entry: string) => !entry.endsWith('/') && !existsSync(join(ROOT, `${entry}.ts`)) && !existsSync(join(ROOT, `${entry}.tsx`)),
    );
    expect(missing, 'renamed or deleted since somebody wrote them down').toEqual([]);
  });
});
