import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sourceLines } from './source-lines.js';
import { testSelectionProbes, type TransformingContext } from './probes.js';
import type { InstrumentedModules } from './instrumented-modules.js';

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

describe('reading a block back to where it was written', () => {
  it('answers with the original line, not the generated one', () => {
    const lineOf = sourceLines(TRANSFORMED, DROPPED_BLANK, '/repo/app/src/a.ts');

    expect(lineOf(TRANSFORMED.indexOf('const a'))).toBe(1);
    expect(lineOf(TRANSFORMED.indexOf('const f'))).toBe(3);
    expect(lineOf(TRANSFORMED.indexOf('g()'))).toBe(4);
  });

  it('falls back to counting newlines when the bundler kept no map', () => {
    // Not an error and not a guess: a build whose text *is* the file was the
    // only case this ever handled, and it still is.
    const of = (code: string): number =>
      sourceLines(code, undefined, '/repo/app/src/a.ts')(code.indexOf('const f'));

    expect(of(TRANSFORMED)).toBe(2);
    expect(of(ORIGINAL)).toBe(3);
  });

  it('gives emitted code with no origin the origin of what precedes it', () => {
    // A `keepNames` prologue, a hoisted helper, an import the transform moved:
    // real generated lines that came from nothing. Reporting line 1 for them
    // would file every one under the top of the file.
    const withPrologue = `var __name = (t) => t;\n${TRANSFORMED}`;
    const lineOf = sourceLines(
      withPrologue,
      { sources: ['app/src/a.ts'], mappings: `;${DROPPED_BLANK.mappings}` },
      '/repo/app/src/a.ts',
    );

    expect(lineOf(withPrologue.indexOf('const f'))).toBe(3);
    expect(lineOf(0)).toBe(1);
  });

  it('ignores segments belonging to another file the map also names', () => {
    // Two sources, and the second one's lines are not this file's lines. A
    // block placed by them points into a file the diff will never name.
    const lineOf = sourceLines(
      TRANSFORMED,
      { sources: ['app/src/other.ts', 'app/src/a.ts'], mappings: 'AAAA;ACEA' },
      '/repo/app/src/a.ts',
    );

    expect(lineOf(TRANSFORMED.indexOf('const f'))).toBe(3);
  });
});

const inventory = join(tmpdir(), `variance-source-lines-${process.pid}.json`);

afterEach(async () => {
  await rm(inventory, { force: true });
});

describe('what the build seam writes down', () => {
  it('records a block at the line the author would find it on', async () => {
    const plugin = testSelectionProbes({ root: '/repo', modulesFile: inventory });
    const context: TransformingContext = { getCombinedSourcemap: () => DROPPED_BLANK };

    plugin.transform.call(context, TRANSFORMED, '/repo/app/src/a.ts');
    await plugin.buildEnd();

    const written = JSON.parse(await readFile(inventory, 'utf8')) as InstrumentedModules;
    const blocks = written.modules[0]?.blocks ?? [];
    const arrow = blocks.find((block) => block.kind === 'function');

    expect(written.modules[0]?.file).toBe('app/src/a.ts');
    expect(arrow?.startLine).toBe(3);
    expect(arrow?.endLine).toBe(5);
  });

  it('survives a bundler that answers the map request by throwing', async () => {
    // Rollup without a sourcemap chain does exactly this, and losing the
    // inventory over it would lose the whole run's selection.
    const plugin = testSelectionProbes({ root: '/repo', modulesFile: inventory });
    const context: TransformingContext = {
      getCombinedSourcemap: () => {
        throw new Error('no sourcemap chain');
      },
    };

    plugin.transform.call(context, TRANSFORMED, '/repo/app/src/a.ts');
    await plugin.buildEnd();

    const written = JSON.parse(await readFile(inventory, 'utf8')) as InstrumentedModules;

    expect(written.modules[0]?.blocks.find((block) => block.kind === 'function')?.startLine).toBe(2);
  });
});
