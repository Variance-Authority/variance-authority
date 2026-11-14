import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readCommandLine, selectingSequencer, type SequencerContext } from './vitest-sequencer.js';
import { withTestSelection } from './vitest.js';

const root = resolve('/checkout');
const spec = (file: string) => ({ moduleId: resolve(root, file) });
const names = (specs: readonly { moduleId: string }[]) => specs.map((one) => one.moduleId.slice(root.length + 1));
const context = (config: SequencerContext['config'] = {}): SequencerContext => ({ config, state: { getPaths: () => [] } });

/** A project's own sequencer, which keeps what it is handed. */
class Own {
  constructor(readonly ctx: SequencerContext) {}
  async shard<T>(files: T[]): Promise<T[]> {
    return files;
  }
  async sort<T>(files: T[]): Promise<T[]> {
    return files;
  }
}

describe('the sequencer under `sequence.shuffle`', () => {
  const files = ['a.test.ts', 'b.test.ts', 'c.test.ts', 'd.test.ts'];
  const shuffling = () => selectingSequencer(undefined, { root, configRoot: process.cwd(), say: () => {} });

  it('picks a seed when none was given, on the config the workers are handed, and shuffles by it', async () => {
    const config = { root, sequence: { shuffle: true } as { shuffle: boolean; seed?: number } };
    const before = Date.now();
    const sequencer = new (shuffling())(context(config));

    expect(config.sequence.seed).toBeGreaterThanOrEqual(before);
    const again = new (shuffling())(context({ root, sequence: { shuffle: true, seed: config.sequence.seed! } }));
    expect(names(await sequencer.sort(files.map(spec)))).toEqual(names(await again.sort(files.map(spec))));
  });

  it('fails by name when the project\'s Vitest names no `shuffle`, rather than ordering the files its own way', async () => {
    const project = await mkdtemp(resolve(tmpdir(), 'variance-no-shuffle-'));
    try {
      const write = async (file: string, text: string) => {
        await mkdir(dirname(resolve(project, file)), { recursive: true });
        await writeFile(resolve(project, file), text, 'utf8');
      };
      await write('node_modules/vitest/package.json', JSON.stringify({ name: 'vitest', type: 'module', exports: { './node': './node.js' } }));
      await write('node_modules/vitest/node.js', 'export class BaseSequencer { constructor(ctx) { this.ctx = ctx; } async shard(files) { return files; } async sort(files) { return files; } }\n');
      await write('node_modules/@vitest/utils/package.json', JSON.stringify({ name: '@vitest/utils', type: 'module', exports: { '.': './index.js' } }));
      await write('node_modules/@vitest/utils/index.js', 'export const other = 1;\n');
      const Sequencer = selectingSequencer(undefined, { root, configRoot: project, say: () => {} });

      const sorted = new Sequencer(context({ root, sequence: { shuffle: true, seed: 1 } })).sort(files.map(spec));

      await expect(sorted).rejects.toThrow(/^variance-authority: this Vitest names no `shuffle`/);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  // The orders `@vitest/utils`' `shuffle` gives these four files.
  it.each([
    [1, ['b.test.ts', 'a.test.ts', 'd.test.ts', 'c.test.ts']],
    [2, ['c.test.ts', 'b.test.ts', 'a.test.ts', 'd.test.ts']],
  ])('keeps seed %i when given, and orders the files as Vitest does with it', async (seed, order) => {
    const config = { root, sequence: { shuffle: true, seed } };

    expect(names(await new (shuffling())(context(config)).sort(files.map(spec)))).toEqual(order);
    expect(config.sequence.seed).toBe(seed);
  });

  // Vitest 3 and 4 put the command line on the context as parsed, where
  // `--sequence.shuffle.tests` is still an object; the resolved config already
  // reads `shuffle: true` for it.
  it.each([
    ['`--sequence.shuffle.tests`', { tests: true }, true, undefined, false],
    ['`--sequence.shuffle.files`', { files: true }, false, undefined, true],
    ['`--sequence.shuffle.tests` over a file that shuffles files', { tests: true }, true, { files: true }, true],
    ['`--sequence.shuffle=false` over a file that shuffles files', false, false, { files: true }, false],
  ])('shuffles files under %s as Vitest does', (_, asked, resolved, written, files) => {
    const config: SequencerContext['config'] = { root, sequence: { shuffle: resolved } };
    const ctx = { ...context(config), _cliOptions: { sequence: { shuffle: asked } } };
    new (selectingSequencer(undefined, { root, configRoot: process.cwd(), say: () => {}, shuffle: written }))(ctx);

    expect(config.sequence?.seed !== undefined).toBe(files);
  });

  // Vitest 2 puts the command line nowhere a sequencer can read it, and the
  // resolved config reads `--sequence.shuffle.files` as no shuffle. Under
  // Vitest's own command line the command line is read again, by its parser;
  // a run started from code has none to read.
  it.each([
    ['Vitest\'s command line', resolve(process.cwd(), 'node_modules/vitest/vitest.mjs'), true],
    ['a run started from code', fileURLToPath(import.meta.url), false],
  ])('reads `--sequence.shuffle.files` from %s', async (_, script, files) => {
    const argv = process.argv;
    process.argv = [process.execPath, script, 'run', '--sequence.shuffle.files'];
    try {
      const Selecting = selectingSequencer(undefined, { root, configRoot: process.cwd(), say: () => {} });
      await readCommandLine(Selecting);
      const config: SequencerContext['config'] = { root, sequence: {} };
      new Selecting(context(config));

      expect(config.sequence?.seed !== undefined).toBe(files);
    } finally {
      process.argv = argv;
    }
  });

  it('picks no seed when the project names its own sequencer, as Vitest leaves that to its own', () => {
    const config: SequencerContext['config'] = { root, sequence: { shuffle: true } };
    new (selectingSequencer(Own, { root, configRoot: root, say: () => {} }))(context(config));

    expect(config.sequence?.seed).toBeUndefined();
  });
});

describe('the banner of a shuffled run', () => {
  /** Vitest's banner as each major opens it: an empty line, the `RUN` line, then what follows it. */
  class Logger {
    readonly lines: string[] = [];
    log(...args: unknown[]): void {
      this.lines.push(args.join(' '));
    }
    printBanner(): void {
      this.log();
      this.log(' RUN  v0 /checkout');
      this.log('      API started at http://localhost:51204/');
      this.log();
    }
  }
  interface Hooked {
    readonly config: { readonly sequence: { readonly sequencer?: unknown; readonly shuffle: boolean; seed?: number }; readonly reporters: unknown[] };
    readonly logger: Logger;
  }
  const seam = async (shuffle: boolean) => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-seed-banner-'));
    try {
      const config = withTestSelection({ root: directory }, { root: directory, coverageFile: resolve(directory, 'coverage.bin') });
      const vitest: Hooked = { config: { sequence: { ...config.test?.sequence, shuffle }, reporters: [] }, logger: new Logger() };
      const [first] = config.test!.reporters as unknown as [{ onInit: (ctx: Hooked) => void }];
      const plugin = (config.plugins as unknown as { name: string; configResolved?: (config: object) => void; configureVitest?: (context: { vitest: Hooked }) => void }[])
        .find((one) => one.name === 'variance-authority:test-selection');
      plugin?.configResolved?.({ configFile: undefined, configFileDependencies: [] });
      return { vitest, onInit: () => first.onInit(vitest), configureVitest: () => plugin?.configureVitest?.({ vitest }) };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };

  it('names the seed it picked on the line after `RUN`, where Vitest names its own', async () => {
    const { vitest, onInit } = await seam(true);
    onInit();
    vitest.logger.printBanner();

    const seed = vitest.config.sequence.seed;
    expect(seed).toBeTypeOf('number');
    expect(vitest.logger.lines).toEqual(['', ' RUN  v0 /checkout', `      Running tests with seed "${seed}"`, '      API started at http://localhost:51204/', '']);
    expect(Object.hasOwn(vitest.logger, 'log')).toBe(false);
  });

  // From Vitest 3.1, where a command-line `--reporter` replaces the reporter
  // that would have hooked it.
  it('names the seed when the plugin alone hooks the banner', async () => {
    const { vitest, configureVitest } = await seam(true);
    configureVitest();
    vitest.logger.printBanner();

    expect(vitest.logger.lines).toContain(`      Running tests with seed "${vitest.config.sequence.seed}"`);
  });

  it('names it once when both the reporter and the plugin hook the banner', async () => {
    const { vitest, onInit, configureVitest } = await seam(true);
    configureVitest();
    onInit();
    vitest.logger.printBanner();

    expect(vitest.logger.lines.filter((line) => line.includes('Running tests with seed'))).toHaveLength(1);
  });

  it('leaves the banner as it is when files are not shuffled', async () => {
    const { vitest, onInit } = await seam(false);
    onInit();
    vitest.logger.printBanner();

    expect(vitest.logger.lines).toEqual(['', ' RUN  v0 /checkout', '      API started at http://localhost:51204/', '']);
    expect(vitest.config.sequence.seed).toBeUndefined();
  });
});
