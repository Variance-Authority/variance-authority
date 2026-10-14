// A landing over a record lays the combined run over it as a runner's own
// teardown lays a run over the record it found, given no text from disk and no
// edit readings, because a landing reads no checkout. Every case that rule
// tells apart is landed here and compared, as a file, with the runner's lay of
// the same two records.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { instrumentationId } from '../instrument/index.js';
import { encodeTestCoverage } from './format.js';
import { layCoverage } from './format-layer.js';
import { openTestCoverage } from './format-view.js';
import { landedCoverage } from './fold-landing.js';
import type { CoverageBlock, CoverageModule, CoverageTest, TestCoverage } from './index.js';

const BASELINE = '1111111111111111111111111111111111111111';
const LOCAL = '2222222222222222222222222222222222222222';

function region(ordinal: number, file: string, crossed: readonly string[], shape: Partial<CoverageBlock> = {}): CoverageBlock {
  return {
    ordinal,
    kind: ordinal === 0 ? 'module' : 'function',
    ...(ordinal === 0 ? {} : { owner: 0 }),
    digest: `block:${file}:${ordinal}`,
    name: ordinal === 0 ? '' : `decide${ordinal}`,
    path: ordinal === 0 ? 'module' : 'entry',
    startLine: ordinal + 1,
    endLine: ordinal + 3,
    source: true,
    testFiles: [...crossed],
    ...shape,
  };
}

/** `block` as a run outside a checkout records it: on no lines, with no source. */
function unplaced(block: CoverageBlock): CoverageBlock {
  const { startLine: _start, endLine: _end, ...rest } = block;
  return { ...rest, source: false };
}

function module(file: string, crossed: readonly string[], shape: Partial<CoverageModule> = {}): CoverageModule {
  return {
    file,
    sourceDigest: `source:${file}`,
    instrumented: true,
    blocks: [region(0, file, crossed), region(1, file, crossed), region(2, file, crossed.slice(0, 1))],
    ...shape,
  };
}

function test(file: string, shape: Partial<CoverageTest> = {}): CoverageTest {
  return { file, complete: true, preconditions: [{ name: file, digest: 'source:test' }], ...shape };
}

function run(commit: string | undefined, tests: readonly CoverageTest[], modules: readonly CoverageModule[]): TestCoverage {
  return { version: 3, instrumentation: 'recipe', ...(commit === undefined ? {} : { commit }), tests: [...tests], modules: [...modules] };
}

const ALPHA = 'test/alpha.test.ts';
const BETA = 'test/beta.test.ts';
const GAMMA = 'test/gamma.test.ts';
const WIDE = ['src/alpha.ts', 'src/decide.ts', 'src/zeta.ts'];

/** Every region of `coverage`'s modules moved with the module's text: an edit. */
function edited(coverage: TestCoverage, only?: number): TestCoverage {
  return {
    ...coverage,
    modules: coverage.modules.map((held) => ({
      ...held,
      sourceDigest: `${held.sourceDigest}-edited`,
      blocks: held.blocks.map((block) => (only === undefined || block.ordinal === only ? { ...block, digest: `${block.digest}-edited` } : block)),
    })),
  };
}

const CASES: Readonly<Record<string, { previous: TestCoverage; current: TestCoverage }>> = {
  'another test re-recording the module': {
    previous: run(BASELINE, [test(ALPHA, { duration: 12 })], [module('src/decide.ts', [ALPHA])]),
    current: run(LOCAL, [test(BETA, { duration: 7 })], [module('src/decide.ts', [BETA])]),
  },
  'the same test re-recorded whole, retiring what it entered elsewhere': {
    previous: run(BASELINE, [test(ALPHA, { duration: 30 }), test(BETA)], WIDE.map((file) => module(file, [ALPHA, BETA]))),
    current: run(LOCAL, [test(ALPHA)], [module('src/decide.ts', [ALPHA])]),
  },
  'a test re-recorded incomplete under the preconditions it had': {
    previous: run(BASELINE, [test(ALPHA), test(BETA)], WIDE.map((file) => module(file, [ALPHA, BETA]))),
    current: run(LOCAL, [test(ALPHA, { complete: false })], [module('src/decide.ts', [])]),
  },
  'a test re-recorded incomplete under changed preconditions': {
    previous: run(BASELINE, [test(ALPHA), test(BETA)], WIDE.map((file) => module(file, [ALPHA, BETA]))),
    current: run(LOCAL, [test(ALPHA, { complete: false, preconditions: [{ name: ALPHA, digest: 'moved' }] })], [module('src/decide.ts', [ALPHA])]),
  },
  'preconditions out of order and repeated, on both sides': {
    previous: run(BASELINE, [
      test(ALPHA, { preconditions: [{ name: 'z', digest: '1' }, { name: 'b', digest: '2' }, { name: 'b', digest: '2' }] }),
      test(GAMMA, { complete: false, preconditions: [{ name: 'g', digest: '2' }, { name: 'g', digest: '1' }] }),
    ], [module('src/decide.ts', [ALPHA, GAMMA])]),
    current: run(LOCAL, [
      test(BETA, { preconditions: [{ name: 'y', digest: '1' }, { name: 'a', digest: '1' }, { name: 'y', digest: '1' }] }),
      test(GAMMA, { complete: false, preconditions: [{ name: 'g', digest: '1' }, { name: 'g', digest: '2' }, { name: 'g', digest: '1' }] }),
    ], [module('src/decide.ts', [BETA, GAMMA])]),
  },
  'an edited module, every region moved': {
    previous: run(BASELINE, [test(ALPHA), test(GAMMA)], [module('src/decide.ts', [ALPHA, GAMMA])]),
    current: edited(run(LOCAL, [test(BETA)], [module('src/decide.ts', [BETA])])),
  },
  'an edited module, one region moved': {
    previous: run(BASELINE, [test(ALPHA), test(GAMMA)], [module('src/decide.ts', [GAMMA, ALPHA])]),
    current: edited(run(LOCAL, [test(BETA)], [module('src/decide.ts', [BETA])]), 2),
  },
  'another build of the same text': {
    previous: run(BASELINE, [test(ALPHA)], [module('src/decide.ts', [ALPHA])]),
    current: run(LOCAL, [test(BETA)], [{ ...module('src/decide.ts', [BETA]), blocks: module('src/decide.ts', [BETA]).blocks.map((block) => ({ ...block, digest: `${block.digest}-dist` })) }]),
  },
  'a region gone from the re-recorded cut': {
    previous: run(BASELINE, [test(ALPHA), test(GAMMA)], [module('src/decide.ts', [GAMMA, ALPHA])]),
    current: run(LOCAL, [test(BETA)], [{ ...module('src/decide.ts', [BETA]), blocks: module('src/decide.ts', [BETA]).blocks.slice(0, 2) }]),
  },
  'a region that changed kind under its address': {
    previous: run(BASELINE, [test(ALPHA)], [module('src/decide.ts', [ALPHA])]),
    current: edited(run(LOCAL, [test(BETA)], [{ ...module('src/decide.ts', [BETA]), blocks: module('src/decide.ts', [BETA]).blocks.map((block) => (block.ordinal === 1 ? { ...block, kind: 'branch' } : block)) }]), 99),
  },
  'regions born inside a carried one and inside a born one': {
    previous: run(BASELINE, [test(ALPHA), test(GAMMA)], [{ ...module('src/decide.ts', [ALPHA, GAMMA]), blocks: [region(0, 'src/decide.ts', [ALPHA, GAMMA]), region(1, 'src/decide.ts', [ALPHA], { loadedBy: [ALPHA] })] }]),
    current: edited(run(LOCAL, [test(BETA)], [{
      ...module('src/decide.ts', [BETA]),
      blocks: [
        region(0, 'src/decide.ts', [BETA]),
        region(1, 'src/decide.ts', [BETA]),
        region(2, 'src/decide.ts', [], { owner: 1, name: 'born' }),
        region(3, 'src/decide.ts', [BETA], { owner: 2, name: 'born/inner' }),
      ],
    }]), 3),
  },
  'a re-recorded cut that renumbered a counter': {
    previous: run(BASELINE, [test(ALPHA)], [{ ...module('src/decide.ts', [ALPHA]), blocks: [region(0, 'src/decide.ts', [ALPHA]), region(1, 'src/decide.ts', [ALPHA], { path: 'if#0/then' }), region(2, 'src/decide.ts', [ALPHA], { path: 'if#1/then' })] }]),
    current: edited(run(LOCAL, [test(BETA)], [{ ...module('src/decide.ts', [BETA]), blocks: [region(0, 'src/decide.ts', [BETA]), region(1, 'src/decide.ts', [BETA], { path: 'if#0/then' })] }])),
  },
  'two regions at one address': {
    previous: run(BASELINE, [test(ALPHA), test(GAMMA)], [{ ...module('src/decide.ts', []), blocks: [region(0, 'src/decide.ts', [ALPHA, GAMMA]), region(1, 'src/decide.ts', [ALPHA], { name: 'decide/map.arg0' }), region(2, 'src/decide.ts', [GAMMA], { name: 'decide/map.arg0' })] }]),
    current: run(LOCAL, [test(BETA)], [{ ...module('src/decide.ts', []), blocks: [region(0, 'src/decide.ts', [BETA]), region(1, 'src/decide.ts', [], { name: 'decide/map.arg0' }), region(2, 'src/decide.ts', [], { name: 'decide/map.arg0' })] }]),
  },
  'regions loaded before their tests began, carried and retired': {
    previous: run(BASELINE, [test(ALPHA), test(GAMMA)], WIDE.map((file) => ({ ...module(file, [ALPHA, GAMMA]), blocks: [region(0, file, [ALPHA, GAMMA], { loadedBy: [ALPHA] }), region(1, file, [GAMMA], { loadedBy: [GAMMA] })] }))),
    current: run(LOCAL, [test(ALPHA)], [{ ...module('src/decide.ts', [ALPHA]), blocks: [region(0, 'src/decide.ts', [ALPHA], { loadedBy: [ALPHA] }), region(1, 'src/decide.ts', [ALPHA])] }]),
  },
  'a path two builds read, one re-recorded': {
    previous: run(BASELINE, [test(ALPHA), test(GAMMA)], [module('src/decide.ts', [ALPHA]), module('src/decide.ts', [GAMMA], { sourceDigest: 'source:src/decide.ts-webkit' })]),
    current: run(LOCAL, [test(ALPHA)], [module('src/decide.ts', [ALPHA], { sourceDigest: 'source:src/decide.ts-webkit' })]),
  },
  'a path two builds read, both re-recorded': {
    previous: run(BASELINE, [test(ALPHA), test(GAMMA)], [module('src/decide.ts', [ALPHA]), module('src/decide.ts', [GAMMA], { sourceDigest: 'source:src/decide.ts-webkit' })]),
    current: run(LOCAL, [test(ALPHA), test(GAMMA)], [module('src/decide.ts', [GAMMA], { sourceDigest: 'source:src/decide.ts-webkit' }), module('src/decide.ts', [ALPHA])]),
  },
  'modules recorded as never measured, on either side': {
    previous: run(BASELINE, [test(ALPHA)], [module('src/alpha.ts', [], { instrumented: false, blocks: [] }), module('src/decide.ts', [ALPHA])]),
    current: run(LOCAL, [test(BETA)], [module('src/alpha.ts', [BETA]), module('src/decide.ts', [], { instrumented: false, blocks: [] })]),
  },
  'a module the record never held, and one the run never loaded': {
    previous: run(BASELINE, [test(ALPHA)], [module('src/decide.ts', [ALPHA]), module('src/zeta.ts', [ALPHA])]),
    current: run(LOCAL, [test(BETA)], [module('src/beta.ts', [BETA])]),
  },
  'a run recorded outside a checkout, with no regions placed on lines': {
    previous: run(BASELINE, [test(ALPHA, { complete: false })], [module('src/decide.ts', [ALPHA])]),
    current: run(undefined, [test(BETA)], [{ ...module('src/decide.ts', [BETA]), blocks: [unplaced(region(0, 'src/decide.ts', [BETA]))] }]),
  },
  'strings no comparison of bytes could order': {
    previous: run(BASELINE, [test(ALPHA)], [module('src/\u{1f600}.ts', [ALPHA]), module('src/￿.ts', [ALPHA])]),
    current: run(LOCAL, [test('test/\u{1f600}.test.ts')], [module('src/￿.ts', ['test/\u{1f600}.test.ts']), module('src/decide.ts', ['test/\u{1f600}.test.ts'])]),
  },
};

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'variance-fold-landing-'));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function written(name: string, coverage: TestCoverage): Promise<{ path: string; bytes: Buffer; coverage: ReturnType<typeof openTestCoverage> }> {
  const path = join(root, name);
  const bytes = encodeTestCoverage(coverage);
  await writeFile(path, bytes);
  return { path, bytes, coverage: openTestCoverage(bytes) };
}

// Each runner records under one of the two recipes, and the rule has no branch
// for either; every case is landed under both.
describe.each(['presence', 'entries'] as const)('landedCoverage under the %s recipe', (mode) => {
  const instrumentation = instrumentationId(mode);
  const under = (coverage: TestCoverage): TestCoverage => ({ ...coverage, instrumentation });

  for (const [what, { previous, current }] of Object.entries(CASES)) {
    it(`lays the fold as the runner's layering does: ${what}`, async () => {
      const name = `${mode}-${what.replace(/\W+/g, '-')}`;
      const held = await written(`${name}.previous.bin`, under(previous));
      const fold = await written(`${name}.fold.bin`, under(current));

      const landed = Buffer.from(landedCoverage(held.bytes, fold.bytes));

      expect(landed.equals(layCoverage(held.bytes, under(current)))).toBe(true);
    });
  }

  it('refuses a record under another recipe, naming both', async () => {
    const held = await written(`${mode}-other.previous.bin`, { ...CASES['another test re-recording the module']!.previous, instrumentation: 'another-recipe' });
    const fold = await written(`${mode}-other.fold.bin`, under(CASES['another test re-recording the module']!.current));

    expect(() => landedCoverage(held.bytes, fold.bytes)).toThrow(/`another-recipe`/);
  });

  it('lands the fold itself over nothing', async () => {
    const fold = await written(`${mode}-nothing.fold.bin`, under(CASES['another test re-recording the module']!.current));

    expect(Buffer.from(landedCoverage(undefined, fold.bytes)).equals(fold.bytes)).toBe(true);
  });
});
