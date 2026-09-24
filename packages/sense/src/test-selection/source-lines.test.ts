import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { digestString } from '../digest.js';
import { sourceLines, type ExtentOf } from './source-lines.js';
import { testSelectionProbes, type TransformingContext } from './probes.js';
import { readRecord, recordStore } from './instrumented-modules.js';
import { coverageBlock, coverageModule } from './coverage-rows.js';
import { encodeTestCoverage } from './format.js';
import { openTestCoverage } from './format-view.js';
import { narrowByExecutionFromView } from './select.js';
import type { CoverageBlock, TestCoverage } from './index.js';

/**
 * Extents in the coordinates of the file the author edited.
 *
 * The failure this guards is silent and asymmetric. A block recorded at the
 * offsets a JSX transform left it at still intersects *something* when a diff
 * arrives — a different region, one or two enclosures out — and the selector
 * answers confidently with the wrong set. No exception, no warning, and the
 * cases it gets wrong are exactly the ones selection exists for: two edits to
 * one file that a run entered differently.
 */

// The map for a transform that dropped one blank line: four generated lines
// standing for original lines 1, 3, 4 and 5.
const DROPPED_BLANK = {
  sources: ['app/src/a.ts'],
  mappings: 'AAAA;AAEA;AACA;AACA',
};

const ORIGINAL = ['const a = 1;', '', 'const f = () => {', '  g();', '};'].join('\n');
const TRANSFORMED = ORIGINAL.split('\n')
  .filter((line) => line !== '')
  .join('\n');

/** The line one offset lands on, as a region of one character would be recorded. */
const lineIn = (extentOf: ExtentOf) => (offset: number): number | undefined =>
  extentOf(offset, offset)?.[0];

describe('reading a block back to where it was written', () => {
  it('answers with the original line, not the generated one', () => {
    const lineOf = lineIn(sourceLines(TRANSFORMED, DROPPED_BLANK, '/repo/app/src/a.ts'));

    expect(lineOf(TRANSFORMED.indexOf('const a'))).toBe(1);
    expect(lineOf(TRANSFORMED.indexOf('const f'))).toBe(3);
    expect(lineOf(TRANSFORMED.indexOf('g()'))).toBe(4);
  });

  it('falls back to counting newlines when the bundler kept no map', () => {
    // Not an error and not a guess: a build whose text *is* the file was the
    // only case this ever handled, and it still is.
    const of = (code: string): number =>
      lineIn(sourceLines(code, undefined, '/repo/app/src/a.ts'))(code.indexOf('const f'))!;

    expect(of(TRANSFORMED)).toBe(2);
    expect(of(ORIGINAL)).toBe(3);
  });

  it('gives a region no lines when the transform wrote it above every origin', () => {
    // The prologue esbuild writes when it lowers a decorator: real generated
    // lines that came from nothing. Counted in the generated text they land on
    // the author's lines below them, and an edit there selects whichever test
    // ran the helper.
    const withPrologue = `var __name = (t) => t;\n${TRANSFORMED}`;
    const extentOf = sourceLines(
      withPrologue,
      { sources: ['app/src/a.ts'], mappings: `;${DROPPED_BLANK.mappings}` },
      '/repo/app/src/a.ts',
    );
    const prologue = withPrologue.indexOf('\n') - 1;

    expect(lineIn(extentOf)(withPrologue.indexOf('const f'))).toBe(3);
    expect(extentOf(0, prologue)).toBeUndefined();
    // The module opens in the prologue and closes in the author's text: it was
    // written from its first origin on.
    expect(extentOf(0, withPrologue.length - 1)).toEqual([1, 5]);
  });

  it('gives emitted code below an origin the origin of what precedes it', () => {
    // A helper written mid-file has an author's line above it, and that line is
    // the nearest thing it was written for.
    const withHelper = `${TRANSFORMED}\nvar __name = (t) => t;`;
    const extentOf = sourceLines(withHelper, DROPPED_BLANK, '/repo/app/src/a.ts');

    expect(lineIn(extentOf)(withHelper.indexOf('var __name'))).toBe(5);
  });

  it('ignores segments belonging to another file the map also names', () => {
    // Two sources, and the second one's lines are not this file's lines. A
    // block placed by them points into a file the diff will never name.
    const lineOf = lineIn(
      sourceLines(
        TRANSFORMED,
        { sources: ['app/src/other.ts', 'app/src/a.ts'], mappings: 'AAAA;ACEA' },
        '/repo/app/src/a.ts',
      ),
    );

    expect(lineOf(TRANSFORMED.indexOf('const f'))).toBe(3);
  });

  it('keeps the span when the transform moved one end above the other', () => {
    // Solid's JSX compiler hoists every element into a `_tmpl$` above the
    // function that returns it, so a region opening inside the template closes
    // at a lower original line than it started on. A map answers one position
    // at a time and both answers are right; it is the pair that has to be an
    // extent, and an inverted one is refused when the record is read back.
    const hoisted = ['const _tmpl$ = tpl();', 'function View() {', '  return el(_tmpl$);', '}'].join(
      '\n',
    );
    // Generated line 1 came from original line 3, and lines 2-4 from 1-3.
    const extentOf = sourceLines(
      hoisted,
      { sources: ['app/src/a.tsx'], mappings: 'AAEA;AAFA;AACA;AACA' },
      '/repo/app/src/a.tsx',
    );
    const lineOf = lineIn(extentOf);
    const block = {
      ordinal: 0,
      kind: 'module' as const,
      digest: 'd',
      name: '',
      path: 'module',
      start: 0,
      end: hoisted.indexOf('_tmpl$)') + 1,
    };

    expect(lineOf(block.start)).toBeGreaterThan(lineOf(block.end - 1)!);

    const row = coverageBlock(hoisted, block, extentOf);

    expect(row.startLine).toBe(2);
    expect(row.endLine).toBe(3);
  });
});

const cacheRoot = join(tmpdir(), `variance-source-lines-${process.pid}`);
const recorded = async () =>
  await readRecord(recordStore('/repo', 'build', cacheRoot), 'app/src/a.ts');

afterEach(async () => {
  await rm(cacheRoot, { force: true, recursive: true });
});

describe('what the build seam writes down', () => {
  it('records a block at the line the author would find it on', async () => {
    const plugin = testSelectionProbes({ root: '/repo', cacheRoot });
    const context: TransformingContext = { getCombinedSourcemap: () => DROPPED_BLANK };

    plugin.transform.call(context, TRANSFORMED, '/repo/app/src/a.ts');

    const written = await recorded();
    const arrow = written?.blocks.find((block) => block.kind === 'function');

    expect(written?.file).toBe('app/src/a.ts');
    expect(arrow?.startLine).toBe(3);
    expect(arrow?.endLine).toBe(5);
  });

  it('survives a bundler that answers the map request by throwing', async () => {
    // Rollup without a sourcemap chain does exactly this, and losing the
    // record over it would lose the whole run's selection.
    const plugin = testSelectionProbes({ root: '/repo', cacheRoot });
    const context: TransformingContext = {
      getCombinedSourcemap: () => {
        throw new Error('no sourcemap chain');
      },
    };

    plugin.transform.call(context, TRANSFORMED, '/repo/app/src/a.ts');

    const written = await recorded();

    expect(written?.blocks.find((block) => block.kind === 'function')?.startLine).toBe(2);
  });
});

/**
 * The digest and the line numbers have to describe the same text.
 *
 * A record pairs one digest of the module's source with block extents, and the
 * only reader of those extents is a diff. When the bundler keeps no map the
 * extents fall back to the transformed text's own lines — that is the honest
 * answer for them — but the digest goes on being taken from the file on disk,
 * so the record says *these are lines of the file you edited* about numbers
 * counted somewhere else. Nothing downstream can catch it: `recorded()` in the
 * selector hashes the text at the snapshot's commit against that digest, they
 * agree, the module is not stale, and the changed lines are charged to
 * whichever region happens to occupy those numbers in the other number line.
 *
 * The test that entered the edited function is then absent from `entered` and
 * absent from `unread`, which is a caller's safe skip list telling it to skip
 * the only test that would have caught the change.
 */
describe('a text the seam cannot map back to the file', () => {
  const root = join(tmpdir(), `variance-frame-${process.pid}`);
  const module = 'src/thing.js';

  // The file as the author wrote it, and as the diff will speak of it: `alpha`
  // on lines 1 to 4, `beta` on lines 6 to 9.
  const onDisk = [
    'export function alpha(value) {',
    '  const a = value + 1;',
    '  return a;',
    '}',
    '',
    'export function beta(value) {',
    '  const b = value * 2;',
    '  return b;',
    '}',
    '',
  ].join('\n');

  // What an earlier plugin hands an `enforce: 'post'` hook: the same code under
  // a prologue, and no chain to read it back through. Rollup answers the map
  // request this way as soon as any upstream plugin returns `{ code, map: null }`
  // — which the two plugins in this package both do.
  const transformed = [
    'var __defProp = Object.defineProperty;',
    'var __name = (t, value) => __defProp(t, "name", { value });',
    'import { jsxDEV } from "react/jsx-dev-runtime";',
    'import.meta.hot;',
    '',
    onDisk,
  ].join('\n');

  const unmapped: TransformingContext = {
    getCombinedSourcemap: () => {
      throw new Error('no sourcemap chain');
    },
  };

  const record = async () => {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, module), onDisk);
    const plugin = testSelectionProbes({ root, cacheRoot });
    plugin.transform.call(unmapped, transformed, join(root, module));
    return await readRecord(recordStore(root, 'build', cacheRoot), module);
  };

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it('digests the text its block lines were counted in, not the file they moved away from', async () => {
    // What the record holds is `beta`'s lines under `alpha`'s name. A digest of
    // the file on disk beside them is the record vouching for coordinates it
    // never saw, and it is the only evidence the selector has.
    const written = await record();

    expect(written?.sourceDigest).not.toBe(digestString(onDisk));
  });

  it('keeps the test the diff reached, rather than the one those line numbers point at', async () => {
    // One line of `beta`'s body edited. `beta` is on lines 6 to 9 of the file
    // the author edited and at 11 to 14 of the text the seam was handed, where
    // 6 to 9 is `alpha` — so a selector reading the recorded numbers answers
    // with alpha's test and hands beta's to the caller as safe to skip.
    const written = await record();
    const crossed = (block: CoverageBlock): readonly string[] =>
      block.name === 'alpha'
        ? ['test/alpha.test.js']
        : block.name === 'beta'
          ? ['test/beta.test.js']
          : ['test/alpha.test.js', 'test/beta.test.js'];
    const snapshot: TestCoverage = {
      version: 3,
      instrumentation: 'fixture-instrumentation',
      commit: 'deadbee',
      tests: ['test/alpha.test.js', 'test/beta.test.js'].map((file) => ({
        file,
        complete: true,
        preconditions: [{ name: file, digest: `source:${file}` }],
      })),
      modules: [coverageModule({ ...written!, file: module }, crossed)],
    };
    const diff = [
      '--- a/src/thing.js',
      '+++ b/src/thing.js',
      '@@ -7,1 +7,1 @@ export function beta(value) {',
      '-  const b = value * 2;',
      '+  const b = value * 3;',
    ].join('\n');

    const narrowing = narrowByExecutionFromView(
      openTestCoverage(encodeTestCoverage(snapshot)),
      diff,
      { sourceAt: (file, commit) => (file === module && commit === 'deadbee' ? onDisk : undefined) },
    );

    expect(narrowing.entered).toContain('test/beta.test.js');
  });
});

/**
 * A module consumed as a build is recorded under the file it was written in.
 *
 * A host hands the transform hook whatever it resolved, and for a package
 * imported from its build that is `dist/a.js`. The lines already follow the map
 * home; the name did not, so the record named a path the scanner has never read
 * an import from and every test that entered the module came back unplaced.
 * Nobody asks *which tests cover dist*.
 */
describe('a module the host loaded from its build', () => {
  const root = join(tmpdir(), `variance-built-${process.pid}`);
  const built = async (sources: readonly string[]) => {
    await mkdir(join(root, 'src'), { recursive: true });
    await mkdir(join(root, 'dist'), { recursive: true });
    await writeFile(join(root, 'src/a.ts'), ORIGINAL);
    await writeFile(join(root, 'dist/a.js'), TRANSFORMED);
    // `defaultInclude` refuses build output, so a suite that reaches its
    // subject through a manifest's `exports` says so — this repository's own
    // config is one. Recording it is the opt-in; naming it is this.
    const plugin = testSelectionProbes({ root, cacheRoot, include: () => true });
    const context: TransformingContext = {
      getCombinedSourcemap: () => ({ sources: [...sources], mappings: DROPPED_BLANK.mappings }),
    };
    plugin.transform.call(context, TRANSFORMED, join(root, 'dist/a.js'));
    const store = recordStore(root, 'build', cacheRoot);
    return {
      original: await readRecord(store, 'src/a.ts'),
      generated: await readRecord(store, 'dist/a.js'),
    };
  };

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it('names it after the source its map points at, and digests that text', async () => {
    const { original, generated } = await built(['../src/a.ts']);

    expect(generated).toBeUndefined();
    expect(original?.file).toBe('src/a.ts');
    expect(original?.sourceDigest).toBe(digestString(ORIGINAL));
    expect(original?.blocks.find((block) => block.kind === 'function')?.startLine).toBe(3);
  });

  it('leaves a bundle chunk under the name the host gave it', async () => {
    // Many sources folded into one text. There is no single file to rename it
    // to, and the first one would be a name that joins to the wrong module
    // rather than to none.
    const { original, generated } = await built(['../src/a.ts', '../src/b.ts']);

    expect(original).toBeUndefined();
    expect(generated?.file).toBe('dist/a.js');
  });
});
