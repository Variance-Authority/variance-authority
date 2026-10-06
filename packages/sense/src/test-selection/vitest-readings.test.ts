import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeTestCoverage } from './format.js';
import { defaultInclude } from './instrumented-modules.js';
import { withTestSelection } from './vitest.js';
import type { TestCoverage } from './index.js';

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

/**
 * What a build emitted for {@link SOURCE}: a helper the source never wrote,
 * which the map gives no origin, the callback wrapped in it, and a pointer to
 * the map written beside it.
 */
const BUILT = [
  "var __name = (target, value) => Object.defineProperty(target, 'name', { value, configurable: true });",
  'export function total(items) {',
  '  if (items.length === 0) {',
  '    return 0;',
  '  }',
  "  return items.reduce(__name(function (sum, item) { return sum + item; }, 'sum'), 0);",
  '}',
  '//# sourceMappingURL=cart.js.map',
  '',
].join('\n');

/** What an older build emitted for {@link SOURCE}, into `lib/`: the branch kept, the callback a function. */
const LEGACY = [
  'export function total(items) {',
  '  if (items.length === 0) return 0;',
  '  return items.reduce(function (sum, item) { return sum + item; }, 0);',
  '}',
  '//# sourceMappingURL=cart.js.map',
  '',
].join('\n');

/** {@link SOURCE} once a comment was written above it, between two runs of a watching runner. */
const EDITED = `// What a cart holds.\n${SOURCE}`;

/** Another module of the package, whose tests load it and not the cart. */
const RATE = 'export const rate = 0.2;\n';

type Transform = (code: string, id: string) => unknown;

type Reading = 'source' | 'build' | 'legacy' | 'rate';

/**
 * What one run records of the readings `order` names, or, with `rerun`, what
 * the run records when it reruns and the rerun transformed only what `rerun`
 * names, after what `changed` names changed on disk: {@link EDITED} replaced
 * the source, or a watching build wrote `dist/cart.js` again.
 */
async function recorded(
  order: readonly Reading[],
  projects: 1 | 2 = 1,
  rerun?: readonly Reading[],
  changed: 'source' | 'build' | 'nothing' = 'source',
): Promise<TestCoverage['modules']> {
  return recordedUnder(() => true, order, projects, rerun, changed);
}

/** {@link recorded}, by a seam that asks `include` which modules are product source. */
async function recordedUnder(
  include: (file: string) => boolean,
  order: readonly Reading[],
  projects: 1 | 2 = 1,
  rerun?: readonly Reading[],
  changed: 'source' | 'build' | 'nothing' = 'source',
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
    await writeFile(resolve(root, 'src/rate.ts'), RATE, 'utf8');
    const configured = withTestSelection({}, { root, coverageFile, include });
    const plugin = (configured.plugins as unknown as Array<{
      transform: Transform;
      watchChange(id: string): void;
    }>)[0]!;
    // A `projects` layout wraps each project's config, and each brings a plugin of its own.
    const other = projects === 1
      ? plugin
      : (withTestSelection({}, { root, coverageFile, include }).plugins as unknown as Array<{
          transform: Transform;
        }>)[0]!;
    const reporter = (configured.test!.reporters as unknown as Array<{
      onFinished(files: readonly []): Promise<void>;
      onWatcherRerun(): void;
    }>)[1]!;
    // The maps each build wrote beside itself: one source, the file the build
    // was made from. A build of the edited source maps its first line one line
    // further down.
    const maps = async (first: string): Promise<void> => {
      const map = (mappings: string): string =>
        JSON.stringify({ version: 3, sources: ['../src/cart.ts'], names: [], mappings });
      await writeFile(resolve(root, 'dist/cart.js.map'), map(`;${first};AACA;AACA;AACA;AACA;AACA`), 'utf8');
      await writeFile(resolve(root, 'lib/cart.js.map'), map(`${first};AACA;AAGA;AACA`), 'utf8');
    };
    await maps('AAAA');
    const transform = (readings: readonly Reading[], source: string): void => {
      for (const reading of readings) {
        if (reading === 'source') plugin.transform(source, resolve(root, 'src/cart.ts'));
        else if (reading === 'build') other.transform(BUILT, resolve(root, 'dist/cart.js'));
        else if (reading === 'legacy') other.transform(LEGACY, resolve(root, 'lib/cart.js'));
        else plugin.transform(RATE, resolve(root, 'src/rate.ts'));
      }
    };
    transform(order, SOURCE);
    await reporter.onFinished([]);
    if (rerun !== undefined) {
      // What Vite's watcher tells every plugin once a file changed on disk.
      if (changed === 'source') {
        await writeFile(resolve(root, 'src/cart.ts'), EDITED, 'utf8');
        await maps('AACA');
        plugin.watchChange(resolve(root, 'src/cart.ts'));
      } else if (changed === 'build') {
        await writeFile(resolve(root, 'dist/cart.js'), BUILT, 'utf8');
        plugin.watchChange(resolve(root, 'dist/cart.js'));
      }
      reporter.onWatcherRerun();
      transform(rerun, changed === 'source' ? EDITED : SOURCE);
      await reporter.onFinished([]);
    }
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

  it('is recorded at the regions both readings cut, each where both readings put it', async () => {
    const place = (block: TestCoverage['modules'][number]['blocks'][number]): string =>
      JSON.stringify([block.kind, block.name, block.path, block.startLine, block.endLine, block.source]);
    const [joined] = await recorded(['source', 'build']);
    const [source] = await recorded(['source']);
    const [build] = await recorded(['build']);
    const cut = (module: typeof joined): ReadonlySet<string> => new Set(module!.blocks.map(place));

    expect(joined!.blocks.length).toBeGreaterThan(1);
    for (const block of joined!.blocks) {
      expect([cut(source).has(place(block)), cut(build).has(place(block))]).toEqual([true, true]);
    }
    expect(joined!.blocks.map((block) => block.ordinal)).toEqual(joined!.blocks.map((_, at) => at));
  });

  it('is recorded the same when each reading came through another project\'s plugin', async () => {
    expect(await recorded(['build', 'source'], 2)).toEqual(await recorded(['source', 'build']));
    expect(await recorded(['source', 'build'], 2)).toEqual(await recorded(['source', 'build']));
  });

  it('is recorded at the regions two builds both cut when the run loaded no source', async () => {
    const place = (block: TestCoverage['modules'][number]['blocks'][number]): string =>
      JSON.stringify([block.kind, block.name, block.path, block.startLine, block.endLine, block.source]);
    const [joined] = await recorded(['legacy', 'build']);
    const [legacy] = await recorded(['legacy']);
    const [build] = await recorded(['build']);
    const cut = (module: typeof joined): ReadonlySet<string> => new Set(module!.blocks.map(place));

    expect(await recorded(['build', 'legacy'])).toEqual([joined]);
    expect(joined!.blocks.length).toBeGreaterThan(1);
    for (const block of joined!.blocks) {
      expect([cut(legacy).has(place(block)), cut(build).has(place(block))]).toEqual([true, true]);
    }
  });

  it('is recorded from the readings a rerun made of the text on disk, not one a run before it made', async () => {
    const rebuilt = await recorded([], 1, ['build']);

    expect(rebuilt[0]!.blocks.find((block) => block.name === 'total')!.startLine).toBe(2);
    expect(await recorded(['source', 'build'], 1, ['build'])).toEqual(rebuilt);
  });

  it('is recorded from both readings when a rerun transformed only the build and the source did not change', async () => {
    expect(await recorded(['source', 'build'], 1, ['build'], 'nothing')).toEqual(await recorded(['source', 'build']));
  });

  it('is recorded from the source a rerun read alone, not joined to a build of the text before it', async () => {
    const rebuilt = await recorded([], 1, ['source']);

    expect(rebuilt[0]!.blocks.find((block) => block.name === 'total')!.startLine).toBe(2);
    expect(await recorded(['source', 'build'], 1, ['source'])).toEqual(rebuilt);
  });

  it('is carried from the text on disk by a rerun that loaded no reading of it once its source changed', async () => {
    const carried = (await recorded(['source'], 1, ['rate'])).find((module) => module.file === 'src/cart.ts');

    expect(carried!.blocks.find((block) => block.name === 'total')!.startLine).toBe(2);
  });

  it('is carried from the text on disk, not a build of the text before it, once its source changed', async () => {
    const carried = (await recorded(['source', 'build'], 1, ['rate'])).find((module) => module.file === 'src/cart.ts');

    expect(carried!.blocks.find((block) => block.name === 'total')!.startLine).toBe(2);
  });

  it('is recorded without the reading of a build written again that the rerun did not load', async () => {
    expect(await recorded(['build', 'legacy'], 1, ['legacy'], 'build')).toEqual(await recorded(['legacy']));
  });
});

describe('a module the runner loaded from its build alone', () => {
  it('is recorded under the source its map leads to by the default include, which refuses built output', async () => {
    expect((await recordedUnder(defaultInclude, ['build'])).map((module) => module.file)).toEqual(['src/cart.ts']);
  });
});
