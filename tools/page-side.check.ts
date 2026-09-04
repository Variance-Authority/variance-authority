import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CROSSES, PAGE_SIDE, claims, sourceStem } from './page-side.mjs';
import { ROOT, sourceFiles } from './workspaces.js';

/**
 * The exclusion list, checked in the direction the suite cannot check itself.
 *
 * `tools/page-side.mjs` names the modules `yarn test` must not instrument, and a
 * missing entry is already loud: the probe throws `ReferenceError` in a headless
 * page and the suite goes red. Nothing watches the other direction. An entry
 * that has stopped being true — the module renamed, the `evaluate` call gone —
 * costs that module its measurement in every run from then on, silently, and
 * `yarn test:since` narrows around a hole nobody can see.
 *
 * So both ends are held here, and the reverse sweep is exact rather than
 * approximate: today every module outside a test file that hands a function to
 * another realm is claimed by the list, and this is what says so tomorrow.
 */

/**
 * The calls that send a function's source text somewhere it has no module scope.
 *
 * Playwright's four. A string argument crosses just as far and does not matter —
 * a string was never instrumented — so this over-matches on purpose and the
 * forward rule below is what makes that harmless.
 */
const CROSSING = /\.(evaluate|evaluateHandle|addInitScript|exposeFunction)\(/;

/** Never instrumented, so never able to lose a probe it was not given. */
const TEST = /\.(test|spec|measure)\.[cm]?[jt]sx?$/;

/**
 * What `vitest.config.mts` would instrument, in the shape it decides it.
 *
 * A workspace's `src`, and nothing else under it. The `collector` and `scripts`
 * directories beside it hold production code the CLI loads in its own process,
 * and two of them hand functions to a page — but no probe is placed in them,
 * because the suite's `PRODUCT` pattern does not reach there. Sweeping wider
 * than the instrumenter would report modules that cannot break, and the day the
 * instrumenter widens this widens with it.
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

describe('every entry still earns its place', () => {
  it.each(CROSSES)('%s hands a function to another realm', (entry: string) => {
    const sources = modules.filter((file) => claims(entry, sourceStem(ROOT, file)));
    const crossing = sources.filter((file) => CROSSING.test(readFileSync(file, 'utf8')));
    expect(
      crossing.map((file) => relative(ROOT, file)),
      `${entry} no longer calls evaluate, addInitScript or exposeFunction — instrument it again`,
    ).not.toHaveLength(0);
  });

  it('and nothing that crosses is missing from the list', () => {
    const uncovered = modules
      .filter((file) => CROSSING.test(readFileSync(file, 'utf8')))
      .map((file) => sourceStem(ROOT, file))
      .filter((stem) => !PAGE_SIDE.some((entry: string) => claims(entry, stem)));
    expect(uncovered, 'would throw ReferenceError inside a page the first time it is probed').toEqual(
      [],
    );
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
