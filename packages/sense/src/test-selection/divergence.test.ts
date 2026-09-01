import { describe, expect, it } from 'vitest';
import { journeyDivergences } from './divergence.js';
import type { CoverageBlock, CoverageModule, TestCoverage } from './index.js';

/**
 * Which of two renders of one file went somewhere the other did not.
 *
 * The failures worth guarding are the ones that bury the finding rather than
 * get it wrong. Import is not execution, a truncated recording is not an
 * absence, and a synthesized `else` nobody took is not a divergence — each of
 * those, counted, puts ten rows of noise above the one row that says a click
 * handler has only ever been entered by the story that clicks.
 */

function block(over: Partial<CoverageBlock> & Pick<CoverageBlock, 'ordinal'>): CoverageBlock {
  return {
    kind: 'function',
    digest: `sha256:${over.ordinal}`,
    name: 'CartCard',
    path: 'app/src/components/CartCard.tsx',
    startLine: over.ordinal,
    endLine: over.ordinal,
    source: true,
    testFiles: [],
    ...over,
  };
}

function module(blocks: readonly CoverageBlock[], over: Partial<CoverageModule> = {}): CoverageModule {
  return {
    file: 'app/src/components/CartCard.tsx',
    sourceDigest: 'sha256:source',
    instrumented: true,
    blocks,
    ...over,
  };
}

const THREE = ['story:cart-card--item', 'story:cart-card--removing', 'story:cart-card--verbose'];

function coverage(modules: readonly CoverageModule[], tests = THREE): TestCoverage {
  return {
    version: 3,
    instrumentation: 'sense:instrument@1',
    tests: tests.map((file) => ({ file, complete: true, preconditions: [] })),
    modules,
  };
}

describe('what the observers of one file did not do alike', () => {
  it('names the region one render entered and the others never have', () => {
    const [found] = journeyDivergences(
      coverage([
        module([
          block({ ordinal: 1, startLine: 19, endLine: 60, testFiles: THREE }),
          block({
            ordinal: 2,
            kind: 'function',
            name: 'CartCard/onClick',
            startLine: 51,
            endLine: 51,
            testFiles: ['story:cart-card--removing'],
          }),
        ]),
      ]),
    );

    expect(found?.observers).toEqual(THREE);
    expect(found?.parted).toEqual([
      expect.objectContaining({
        name: 'CartCard/onClick',
        startLine: 51,
        entered: ['story:cart-card--removing'],
        missed: ['story:cart-card--item', 'story:cart-card--verbose'],
      }),
    ]);
  });

  it('counts loading a file as loading it, and not as rendering it', () => {
    // The module root is crossed on import, so every subject in the bundle
    // crosses it. Pooled from there, `MainNav`'s stories are parties to every
    // region of a file they were never near, and the finding above arrives
    // under ten rows of subjects that only ever imported this module.
    const [found] = journeyDivergences(
      coverage(
        [
          module([
            block({
              ordinal: 0,
              kind: 'module',
              startLine: 1,
              endLine: 60,
              testFiles: [...THREE, 'story:main-nav--empty'],
            }),
            block({ ordinal: 1, startLine: 19, endLine: 60, testFiles: THREE }),
            block({ ordinal: 2, startLine: 51, endLine: 51, testFiles: ['story:cart-card--removing'] }),
          ]),
        ],
        [...THREE, 'story:main-nav--empty'],
      ),
    );

    expect(found?.observers).toEqual(THREE);
    expect(found?.parted[0]?.missed).not.toContain('story:main-nav--empty');
  });

  it('drops a truncated observation rather than counting it as having missed', () => {
    // The rule `narrowByExecution` states. A run cut short entered fewer regions
    // than the subject would have, so its absence from one is not evidence, and
    // a pool that held it would manufacture a parting out of a broken recording.
    const partial: TestCoverage = {
      ...coverage([
        module([
          block({ ordinal: 1, startLine: 19, endLine: 60, testFiles: THREE }),
          block({ ordinal: 2, startLine: 51, endLine: 51, testFiles: THREE }),
        ]),
      ]),
      tests: [
        { file: 'story:cart-card--item', complete: true, preconditions: [] },
        { file: 'story:cart-card--removing', complete: true, preconditions: [] },
        { file: 'story:cart-card--verbose', complete: false, preconditions: [] },
      ],
    };

    const [found] = journeyDivergences(partial);

    expect(found).toBeUndefined();
  });

  it('reports a region with source that nobody entered, apart from a parting', () => {
    const [found] = journeyDivergences(
      coverage([
        module([
          block({ ordinal: 1, startLine: 19, endLine: 60, testFiles: THREE }),
          block({ ordinal: 2, name: 'checkout', startLine: 45, endLine: 52, testFiles: [] }),
        ]),
      ]),
    );

    expect(found?.parted).toEqual([]);
    expect(found?.unentered).toEqual([
      expect.objectContaining({ name: 'checkout', entered: [], missed: THREE }),
    ]);
  });

  it('leaves a synthesized region out of both lists', () => {
    // An implicit `else` nobody took is every `a && b` in the file. There is
    // nothing at that line for a reader to open, and a list of them is a list
    // read past.
    const [found] = journeyDivergences(
      coverage([
        module([
          block({ ordinal: 1, startLine: 19, endLine: 60, testFiles: THREE }),
          block({ ordinal: 2, kind: 'branch', startLine: 27, endLine: 27, source: false, testFiles: [] }),
        ]),
      ]),
    );

    expect(found).toBeUndefined();
  });

  it('says nothing about a module the instrument did not reach', () => {
    // `instrumented: false` records that nothing is known about this module's
    // regions. A module with no known regions has no unentered ones, and
    // answering *every function here is dead* out of an absent recording is the
    // strongest sentence available made from no evidence at all.
    const found = journeyDivergences(
      coverage([module([block({ ordinal: 1, testFiles: [] })], { instrumented: false })]),
    );

    expect(found).toEqual([]);
  });

  it('restricts the pool to the run’s own subjects when asked', () => {
    // The snapshot accumulates. Without this a subject deleted two commits ago
    // is still a party to every parting it was recorded in, and a reviewer is
    // shown a name their branch does not contain.
    const [found] = journeyDivergences(
      coverage(
        [
          module([
            block({ ordinal: 1, startLine: 19, endLine: 60, testFiles: [...THREE, 'story:gone'] }),
            block({ ordinal: 2, startLine: 51, endLine: 51, testFiles: ['story:cart-card--removing'] }),
          ]),
        ],
        [...THREE, 'story:gone'],
      ),
      { observers: THREE },
    );

    expect(found?.observers).toEqual(THREE);
  });

  it('has nothing to compare when one observer entered the file alone', () => {
    const found = journeyDivergences(
      coverage([
        module([block({ ordinal: 1, testFiles: ['story:cart-card--removing'] })]),
      ]),
    );

    expect(found).toEqual([]);
  });
});
