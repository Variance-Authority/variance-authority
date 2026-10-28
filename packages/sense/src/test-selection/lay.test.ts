// Where an index stands after two runs are folded together, what N shards of one
// run fold into.

import { describe, expect, it } from 'vitest';
import { INSTRUMENTATION_ID } from '../instrument/index.js';
import { laidCoverage } from './__fixtures__/laid.js';
import type { TestCoverage } from './index.js';

const BASELINE = '1111111111111111111111111111111111111111';
const LOCAL = '2222222222222222222222222222222222222222';

function at(commit: string | undefined, test: string): TestCoverage {
  return {
    version: 3,
    instrumentation: INSTRUMENTATION_ID,
    ...(commit === undefined ? {} : { commit }),
    tests: [{ file: test, complete: true, preconditions: [{ name: test, digest: 'source:test' }] }],
    modules: [
      {
        file: 'src/decide.ts',
        sourceDigest: 'source:decide',
        instrumented: true,
        blocks: [
          {
            ordinal: 0,
            kind: 'module',
            digest: 'block:decide',
            name: '',
            path: 'module',
            startLine: 1,
            endLine: 8,
            source: true,
            testFiles: [test],
          },
        ],
      },
    ],
  };
}

const DECIDE = 'export function decide(n) {\n  return n > 0;\n}\n';

/** A snapshot whose one module holds a function, recorded over older text. */
function carrying(test: string): TestCoverage {
  const base = at(BASELINE, test);
  const [root] = base.modules[0]!.blocks;
  return {
    ...base,
    modules: [{
      ...base.modules[0]!,
      blocks: [
        root!,
        {
          ordinal: 1,
          kind: 'function',
          owner: 0,
          digest: 'block:decide-entry',
          name: 'decide',
          path: 'entry',
          startLine: 1,
          endLine: 3,
          source: true,
          testFiles: [test],
          loadedBy: [test],
        },
      ],
    }],
  };
}

describe('a laid record', () => {
  it('stands where the run that just happened stands', () => {
    // A local layer over a baseline is the ordinary shape, so the two sides
    // naming different commits is not a conflict. The question a later reader
    // asks is what has changed since this index was last written, and that is
    // answered by the newer of the two and never by the one underneath it.
    const laid = laidCoverage(at(BASELINE, 'test/alpha.test.ts'), at(LOCAL, 'test/beta.test.ts'));

    expect(laid.commit).toBe(LOCAL);
    expect(laid.tests.map((test) => test.file)).toEqual([
      'test/alpha.test.ts',
      'test/beta.test.ts',
    ]);
  });

  it('leaves an index unpositioned when the run that wrote it was', () => {
    expect(laidCoverage(at(BASELINE, 'test/alpha.test.ts'), at(undefined, 'test/beta.test.ts')))
      .not.toHaveProperty('commit');
  });

  it('keeps a carried test\'s crossing and demotes it when the region it entered was edited', () => {
    // A full run saw alpha enter the module region. One file was then run by
    // hand over an edit to that region. Alpha's crossing is the only record that
    // alpha ever reached the place that just changed, so it is kept. The rows now
    // hold the edited text, and a reader frames them by it, so no later diff
    // shows alpha the edit: alpha is demoted, and runs until it is recorded again.
    const laid = laidCoverage(
      at(BASELINE, 'test/alpha.test.ts'),
      rewritten(at(LOCAL, 'test/beta.test.ts'), 'block:decide-edited'),
    );

    expect(laid.tests.filter((test) => !test.complete).map((test) => test.file)).toEqual(['test/alpha.test.ts']);
    expect(laid.modules[0]?.blocks[0]?.testFiles).toEqual([
      'test/alpha.test.ts',
      'test/beta.test.ts',
    ]);
  });

  it('keeps a carried test whole when another build of the same text cut its regions', () => {
    // A package's own tests load `src/decide.ts` through the runner's transform
    // and every other package's tests load it as `dist/decide.js`; both are
    // recorded under the source path with the source's digest. A region's
    // digest is taken of the text the probes were spliced into, so the two
    // builds digest one unedited region apart. A run that loaded the other
    // build edited nothing alpha ran over, and alpha stays whole.
    const otherBuild = at(LOCAL, 'test/beta.test.ts');
    const laid = laidCoverage(at(BASELINE, 'test/alpha.test.ts'), {
      ...otherBuild,
      modules: otherBuild.modules.map((module) => ({
        ...module,
        blocks: module.blocks.map((block) => ({ ...block, digest: 'block:decide-dist' })),
      })),
    });

    expect(laid.tests.every((test) => test.complete)).toBe(true);
    expect(laid.modules[0]?.blocks[0]?.testFiles).toEqual([
      'test/alpha.test.ts',
      'test/beta.test.ts',
    ]);
  });

  it('keeps a carried test whole when its regions are the ones it saw', () => {
    const laid = laidCoverage(at(BASELINE, 'test/alpha.test.ts'), at(LOCAL, 'test/beta.test.ts'));

    expect(laid.tests.every((test) => test.complete)).toBe(true);
    expect(laid.modules[0]?.blocks[0]?.testFiles).toEqual([
      'test/alpha.test.ts',
      'test/beta.test.ts',
    ]);
  });

  it('carries and unions what ran before the first test the way it carries crossings', () => {
    // Alpha's full run saw the module load before its first test. Beta then ran
    // by hand and saw the same. A retired alpha takes its early crossing with it.
    const early = (coverage: TestCoverage): TestCoverage => ({
      ...coverage,
      modules: coverage.modules.map((module) => ({
        ...module,
        blocks: module.blocks.map((block) => ({ ...block, loadedBy: block.testFiles })),
      })),
    });
    const laid = laidCoverage(early(at(BASELINE, 'test/alpha.test.ts')), early(at(LOCAL, 'test/beta.test.ts')));
    expect(laid.modules[0]?.blocks[0]?.loadedBy).toEqual(['test/alpha.test.ts', 'test/beta.test.ts']);

    const rerun = laidCoverage(laid, at(LOCAL, 'test/alpha.test.ts'));
    expect(rerun.modules[0]?.blocks[0]?.loadedBy).toEqual(['test/beta.test.ts']);

    const nobody = laidCoverage(rerun, at(LOCAL, 'test/beta.test.ts'));
    expect(nobody.modules[0]?.blocks[0]).not.toHaveProperty('loadedBy');
  });

  it('demotes a carried test whose region is gone', () => {
    const current = at(LOCAL, 'test/beta.test.ts');
    const laid = laidCoverage(at(BASELINE, 'test/alpha.test.ts'), {
      ...current,
      modules: [{
        ...current.modules[0]!,
        sourceDigest: 'source:decide-rewritten',
        blocks: [{ ...current.modules[0]!.blocks[0]!, digest: 'block:decide-rewritten' }],
      }],
    });

    expect(laid.tests.find((test) => test.file === 'test/alpha.test.ts')?.complete).toBe(false);
  });

  it("re-cuts a carried module's rows over the text it has now", () => {
    // A full run recorded the module at one commit. A file was then run by hand
    // at a later commit that moved the module's lines, without loading it. The
    // index now stands at the later commit, so the regions are read out of the
    // text standing there and each crossing is carried onto the region with its
    // address: alpha is still known to have entered `decide`, and `decide` is
    // now at the lines the next diff will name. The landing keeps the text the
    // rows are cut from, so no later diff shows alpha the module's edited top
    // level, and alpha is demoted.
    const laid = laidCoverage(
      carrying('test/alpha.test.ts'),
      { ...at(LOCAL, 'test/beta.test.ts'), modules: [] },
      new Map([['src/decide.ts', `const scale = 2;\n\n${DECIDE}`]]),
    );
    const decide = laid.modules[0]?.blocks.find((block) => block.name === 'decide');

    expect(laid.tests.filter((test) => !test.complete).map((test) => test.file)).toEqual(['test/alpha.test.ts']);
    expect(decide?.startLine).toBe(3);
    expect(decide?.testFiles).toEqual(['test/alpha.test.ts']);
    expect(decide?.loadedBy).toEqual(['test/alpha.test.ts']);
  });

  it('demotes a carried test when the region it entered was deleted', () => {
    // The same carry, over text that dropped the function alpha entered.
    // Arrival nests: alpha entered the module to reach `decide`, so its crossing
    // on the module is still there. But the module's text moved under it, and
    // the landing keeps that text, so no later diff holds the deletion.
    const laid = laidCoverage(
      carrying('test/alpha.test.ts'),
      { ...at(LOCAL, 'test/beta.test.ts'), modules: [] },
      new Map([['src/decide.ts', 'const scale = 2;\n']]),
    );

    expect(laid.tests.find((test) => test.file === 'test/alpha.test.ts')?.complete).toBe(false);
    expect(laid.modules[0]?.blocks.some((block) => block.name === 'decide')).toBe(false);
    expect(laid.modules[0]?.blocks[0]?.testFiles).toEqual(['test/alpha.test.ts']);
  });

  it('demotes a carried test whose snapshot names a recipe this build cannot cut', () => {
    // The rows were numbered by a walk this build does not have, so there is no
    // table to carry the crossings into: the module is carried as it was, and
    // alpha is demoted the way it is for text nobody can read.
    const foreign = { ...carrying('test/alpha.test.ts'), instrumentation: 'sense:instrument/other' };
    const laid = laidCoverage(
      foreign,
      { ...at(LOCAL, 'test/beta.test.ts'), modules: [], instrumentation: foreign.instrumentation },
      new Map([['src/decide.ts', `const scale = 2;\n\n${DECIDE}`]]),
    );

    expect(laid.tests.find((test) => test.file === 'test/alpha.test.ts')?.complete).toBe(false);
  });

  it('demotes a carried test whose module has text that cannot be read as source', () => {
    // Nothing to cut regions out of, and the rows that are there are ranges in
    // text nobody has. Alpha runs at the next selection whatever the diff says.
    const laid = laidCoverage(
      carrying('test/alpha.test.ts'),
      { ...at(LOCAL, 'test/beta.test.ts'), modules: [] },
      new Map([['src/decide.ts', 'export function decide( {']]),
    );

    expect(laid.tests.find((test) => test.file === 'test/alpha.test.ts')?.complete).toBe(false);
  });

  it('leaves a carried test whole when the run did not load its modules', () => {
    // A module the run never loaded, whose text has not moved, is carried as
    // it was: the texts handed in name only the modules whose text moved.
    const current = at(LOCAL, 'test/beta.test.ts');
    const laid = laidCoverage(at(BASELINE, 'test/alpha.test.ts'), { ...current, modules: [] }, new Map());

    expect(laid.tests.every((test) => test.complete)).toBe(true);
    expect(laid.modules[0]?.blocks[0]?.testFiles).toEqual(['test/alpha.test.ts']);
  });

  it('carries the row of a build this run did not re-record', () => {
    // What the record holds is one path read by two builds: `src/decide.ts` as
    // the chromium bundle built it, crossed by the chromium suite, and the same
    // path as the webkit bundle built it, crossed by the webkit suite. Two rows,
    // each with its own text and its own crossings. This run re-recorded the
    // chromium build and observed nothing whatever about the webkit one, so
    // keeping the first previous row of the path and dropping the rest takes
    // webkit's only record of entering this module with it — and takes it
    // silently, because the demotion that would answer for a lost crossing only
    // ever reads the row that was kept. Webkit stays whole with nothing recorded
    // against the file it entered, so a diff of `src/decide.ts` is answered
    // without it and a caller skips the one test known to have run there.
    const chromium = 'test/chromium.test.ts';
    const webkit = 'test/webkit.test.ts';
    const previous: TestCoverage = {
      ...at(BASELINE, chromium),
      tests: [...at(BASELINE, chromium).tests, ...at(BASELINE, webkit).tests],
      modules: [
        at(BASELINE, chromium).modules[0]!,
        { ...at(BASELINE, webkit).modules[0]!, sourceDigest: 'source:decide-webkit' },
      ],
    };

    const laid = laidCoverage(previous, at(LOCAL, chromium));

    expect(laid.modules.map((module) => module.sourceDigest)).toEqual([
      'source:decide',
      'source:decide-webkit',
    ]);
    expect(laid.modules.map((module) => module.blocks.flatMap((block) => block.testFiles)))
      .toEqual([[chromium], [webkit]]);
    expect(laid.tests.find((test) => test.file === webkit)?.complete).toBe(true);
  });
});

/** The same snapshot after the module's one region was edited. */
function rewritten(coverage: TestCoverage, digest: string): TestCoverage {
  return {
    ...coverage,
    modules: coverage.modules.map((module) => ({
      ...module,
      sourceDigest: `${module.sourceDigest}-edited`,
      blocks: module.blocks.map((block) => ({ ...block, digest })),
    })),
  };
}
