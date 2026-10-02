import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeTestCoverage } from './format.js';
import { withTestSelection } from './vitest.js';
import type { TestCoverage } from './index.js';
import type { TransformingContext } from './probes.js';

/**
 * A monorepo's own tests load `src/cart.ts`, and another package's tests reach
 * the same code through its manifest as `dist/cart.js`, whose map leads back to
 * the source. Both are recorded under `src/cart.ts`, and the two readings cut
 * different regions: the build is what `tsc` made of the text, not the text.
 */
const SOURCE = [
  'export function total(items) {',
  '  if (items.length === 0) {',
  '    return 0;',
  '  }',
  '  return items.reduce((sum, item) => sum + item, 0);',
  '}',
  '',
].join('\n');

/** What a build emitted for {@link SOURCE}: the branch folded into an expression. */
const BUILT = [
  'export function total(items) {',
  '  return items.length === 0 ? 0 : items.reduce(function (sum, item) { return sum + item; }, 0);',
  '}',
  '',
].join('\n');

/** What an older build emitted for {@link SOURCE}, into `lib/`: the branch kept, the callback a function. */
const LEGACY = [
  'export function total(items) {',
  '  if (items.length === 0) return 0;',
  '  return items.reduce(function (sum, item) { return sum + item; }, 0);',
  '}',
  '',
].join('\n');

type Transform = (this: TransformingContext | undefined, code: string, id: string) => unknown;

async function recorded(
  order: readonly ('source' | 'build' | 'legacy')[],
  projects: 1 | 2 = 1,
): Promise<TestCoverage['modules']> {
  const root = await mkdtemp(resolve(tmpdir(), 'variance-two-readings-'));
  const coverageFile = resolve(root, 'coverage.bin');
  try {
    await mkdir(resolve(root, 'src'), { recursive: true });
    await mkdir(resolve(root, 'dist'), { recursive: true });
    await writeFile(resolve(root, 'src/cart.ts'), SOURCE, 'utf8');
    await mkdir(resolve(root, 'lib'), { recursive: true });
    await writeFile(resolve(root, 'dist/cart.js'), BUILT, 'utf8');
    await writeFile(resolve(root, 'lib/cart.js'), LEGACY, 'utf8');
    const configured = withTestSelection({}, { root, coverageFile, include: () => true });
    const plugin = (configured.plugins as unknown as Array<{ transform: Transform }>)[0]!;
    // A `projects` layout wraps each project's config, and each brings a plugin of its own.
    const other = projects === 1
      ? plugin
      : (withTestSelection({}, { root, coverageFile, include: () => true }).plugins as unknown as Array<{
          transform: Transform;
        }>)[0]!;
    const reporter = (configured.test!.reporters as unknown as Array<{
      onFinished(files: readonly []): Promise<void>;
    }>)[1]!;
    // `tsc`'s map: one source, the file the build was made from, line for line.
    const built: TransformingContext = {
      getCombinedSourcemap: () => ({
        version: 3,
        sources: ['../src/cart.ts'],
        names: [],
        mappings: 'AAAA;AACA;AACA',
      }) as unknown as ReturnType<TransformingContext['getCombinedSourcemap']>,
    };
    const legacy: TransformingContext = {
      getCombinedSourcemap: () => ({
        version: 3,
        sources: ['../src/cart.ts'],
        names: [],
        mappings: 'AAAA;AACA;AAIA;AACA',
      }) as unknown as ReturnType<TransformingContext['getCombinedSourcemap']>,
    };
    for (const reading of order) {
      if (reading === 'source') plugin.transform.call(undefined, SOURCE, resolve(root, 'src/cart.ts'));
      else if (reading === 'build') other.transform.call(built, BUILT, resolve(root, 'dist/cart.js'));
      else other.transform.call(legacy, LEGACY, resolve(root, 'lib/cart.js'));
    }
    await reporter.onFinished([]);
    return decodeTestCoverage(await readFile(coverageFile)).modules;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('a module two transforms both name', () => {
  it('is recorded the same whichever reading the runner transformed last', async () => {
    const sourceFirst = await recorded(['source', 'build']);
    const buildFirst = await recorded(['build', 'source']);

    expect(sourceFirst.map((module) => module.file)).toEqual(['src/cart.ts']);
    expect(buildFirst).toEqual(sourceFirst);
  });

  it('is recorded as its source reading, which a run without the build also records', async () => {
    const alone = await recorded(['source']);

    expect(await recorded(['source', 'build'])).toEqual(alone);
    expect(await recorded(['build', 'source'])).toEqual(alone);
  });

  it('is recorded the same when each reading came through another project\'s plugin', async () => {
    expect(await recorded(['build', 'source'], 2)).toEqual(await recorded(['source']));
    expect(await recorded(['source', 'build'], 2)).toEqual(await recorded(['source']));
  });

  it('is recorded as the build whose file sorts first when the run loaded no source', async () => {
    const dist = await recorded(['build']);

    expect(await recorded(['legacy'])).not.toEqual(dist);
    expect(await recorded(['legacy', 'build'])).toEqual(dist);
    expect(await recorded(['build', 'legacy'])).toEqual(dist);
  });
});
