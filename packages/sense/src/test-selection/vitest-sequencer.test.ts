import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { SuiteSelection } from './suite-selection.js';
import { readCommandLine, selectingSequencer, type SequencerContext } from './vitest-sequencer.js';
import { withTestSelection } from './vitest.js';

const root = resolve('/checkout');
const spec = (file: string) => ({ moduleId: resolve(root, file) });
const names = (specs: readonly { moduleId: string }[]) => specs.map((one) => one.moduleId.slice(root.length + 1));
const selection = (skip: readonly string[], more: Partial<SuiteSelection> = {}): SuiteSelection => ({
  whole: new Set(skip),
  skip: new Set(skip),
  notes: [],
  ...more,
});
const context = (config: SequencerContext['config'] = {}, paths: readonly string[] = []): SequencerContext => ({
  config,
  state: { getPaths: () => paths.map((file) => resolve(root, file)) },
});

/** A project's own sequencer, which reverses what it is handed and shards by halves. */
class Reversing {
  constructor(readonly ctx: SequencerContext) {}
  async shard<T>(files: T[]): Promise<T[]> {
    return files.slice(0, Math.ceil(files.length / 2));
  }
  async sort<T>(files: T[]): Promise<T[]> {
    return [...files].reverse();
  }
}

describe('the sequencer that drops what a selection may skip', () => {
  it('drops the skipped files and hands the rest to the project\'s own sequencer', async () => {
    const lines: string[] = [];
    const Sequencer = selectingSequencer(Reversing, {
      root,
      configRoot: root,
      selection: async () => selection(['a.test.ts', 'c.test.ts']),
      say: (line) => lines.push(line),
    });
    const sequencer = new Sequencer(context({}, ['a.test.ts', 'b.test.ts', 'c.test.ts', 'd.test.ts']));

    const sorted = await sequencer.sort(['a.test.ts', 'b.test.ts', 'c.test.ts', 'd.test.ts'].map(spec));

    expect(names(sorted)).toEqual(['d.test.ts', 'b.test.ts']);
    expect(lines).toEqual(['variance-authority: selected 2 of 4']);
  });

  it('drops before the shard is cut, so the shards split what runs', async () => {
    const Sequencer = selectingSequencer(Reversing, {
      root,
      configRoot: root,
      selection: async () => selection(['a.test.ts', 'b.test.ts']),
      say: () => {},
    });
    const sequencer = new Sequencer(context({ shard: { index: 1, count: 2 } }));

    const part = await sequencer.shard(['a.test.ts', 'b.test.ts', 'c.test.ts', 'd.test.ts'].map(spec));

    expect(names(part)).toEqual(['c.test.ts']);
  });

  it('hands on the cases the kept files skip, by the path the run knows each by', async () => {
    const handed: unknown[] = [];
    const cases = new Map([['a.test.ts', ['one']], ['c.test.ts', ['two']]]);
    const Sequencer = selectingSequencer(Reversing, {
      root,
      configRoot: root,
      selection: async () => selection(['c.test.ts'], { cases }),
      cut: (cut) => handed.push(cut),
      say: () => {},
    });

    await new Sequencer(context({}, ['a.test.ts', 'b.test.ts', 'c.test.ts'])).sort(['a.test.ts', 'b.test.ts', 'c.test.ts'].map(spec));

    expect(handed).toEqual([new Map([[resolve(root, 'a.test.ts'), ['one']]])]);
  });

  it('chains Vitest\'s own sequencer when the project names none', async () => {
    const Sequencer = selectingSequencer(undefined, {
      root,
      configRoot: process.cwd(),
      selection: async () => selection(['a.test.ts']),
      say: () => {},
    });
    // Vitest's own sort runs the largest file first when no results are cached.
    const size = new Map([['b.test.ts', 1], ['c.test.ts', 3], ['d.test.ts', 2]]);
    const cache = {
      getFileTestResults: () => undefined,
      getFileStats: (key: string) => ({ size: size.get(key.slice(key.indexOf(':') + 1)) ?? 0 }),
    };
    const sequencer = new Sequencer({ config: { root }, cache } as SequencerContext);
    const files = ['a.test.ts', 'b.test.ts', 'c.test.ts', 'd.test.ts'].map((file) => ({ ...spec(file), project: { name: '' } }));

    const sorted = await sequencer.sort(files);

    expect(names(sorted)).toEqual(['c.test.ts', 'd.test.ts', 'b.test.ts']);
  });

  it('hands a shard call that asks for no shard to the project\'s sequencer', async () => {
    const Sequencer = selectingSequencer(Reversing, { root, configRoot: root, say: () => {} });

    const part = await new Sequencer(context()).shard(['a.test.ts', 'b.test.ts', 'c.test.ts', 'd.test.ts'].map(spec));

    expect(names(part)).toEqual(['a.test.ts', 'b.test.ts']);
  });

  it('reads the selection once, however many pools and runs ask', async () => {
    const select = vi.fn(async () => selection(['a.test.ts']));
    const lines: string[] = [];
    const Sequencer = selectingSequencer(Reversing, { root, configRoot: root, selection: select, say: (line) => lines.push(line) });

    await new Sequencer(context()).sort([spec('a.test.ts')]);
    await new Sequencer(context()).sort([spec('b.test.ts')]);

    expect(select).toHaveBeenCalledTimes(1);
    expect(lines).toHaveLength(1);
  });

  it('wrapped twice, selects once', () => {
    const options = { root, configRoot: root, selection: async () => selection([]), say: () => {} };
    const once = selectingSequencer(Reversing, options);

    expect(selectingSequencer(once, options)).toBe(once);
  });

  it('selects nothing in watch mode, and says so', async () => {
    const select = vi.fn(async () => selection(['a.test.ts']));
    const lines: string[] = [];
    const Sequencer = selectingSequencer(Reversing, { root, configRoot: root, selection: select, say: (line) => lines.push(line) });

    const sorted = await new Sequencer(context({ watch: true })).sort(['a.test.ts', 'b.test.ts'].map(spec));

    expect(names(sorted)).toEqual(['b.test.ts', 'a.test.ts']);
    expect(select).not.toHaveBeenCalled();
    expect(lines).toEqual(['variance-authority: watch mode does not select']);
  });

  it('says which reading declined, and drops nothing', async () => {
    const lines: string[] = [];
    const Sequencer = selectingSequencer(Reversing, {
      root,
      configRoot: root,
      selection: async () => selection([], { declined: 'no execution journal at /cache/unit.bin', notes: ['run the suite once'] }),
      say: (line) => lines.push(line),
    });

    const sorted = await new Sequencer(context({}, ['a.test.ts'])).sort([spec('a.test.ts')]);

    expect(names(sorted)).toEqual(['a.test.ts']);
    expect(lines).toEqual(['variance-authority: declined: no execution journal at /cache/unit.bin', '  run the suite once']);
  });

  it('says none of M when every discovered file is skipped, and passes the run', async () => {
    const lines: string[] = [];
    const Sequencer = selectingSequencer(Reversing, {
      root,
      configRoot: root,
      selection: async () => selection(['a.test.ts', 'b.test.ts']),
      say: (line) => lines.push(line),
    });
    const config: SequencerContext['config'] = {};

    const sorted = await new Sequencer(context(config, ['a.test.ts', 'b.test.ts'])).sort(['a.test.ts', 'b.test.ts'].map(spec));

    expect(sorted).toEqual([]);
    expect(lines).toEqual(['variance-authority: selected none of 2']);
    expect(config.passWithNoTests).toBe(true);
  });

  it('leaves the project\'s `passWithNoTests` alone when the selection skips nothing', async () => {
    const Sequencer = selectingSequencer(Reversing, { root, configRoot: root, selection: async () => selection([]), say: () => {} });
    const config: SequencerContext['config'] = { shard: { index: 2, count: 2 } };

    expect(await new Sequencer(context(config)).sort([])).toEqual([]);
    expect(config.passWithNoTests).toBeUndefined();
  });

  it('fails the run by name when the selection cannot be read', async () => {
    const Sequencer = selectingSequencer(Reversing, {
      root,
      configRoot: root,
      selection: async () => {
        throw new Error('the record is unreadable');
      },
      say: () => {},
    });

    await expect(new Sequencer(context()).sort([spec('a.test.ts')])).rejects.toThrow('the record is unreadable');
  });
});

describe('the sequencer under --shard', () => {
  const times = async () => ({
    recording: '/cache/unit.bin',
    commit: 'f'.repeat(40),
    times: new Map([['a.test.ts', 9000], ['b.test.ts', 4000], ['c.test.ts', 3000], ['d.test.ts', 2000]]),
  });
  const files = ['a.test.ts', 'b.test.ts', 'c.test.ts', 'd.test.ts'];

  it('places files by the times recorded, rather than by the runner\'s count', async () => {
    const lines: string[] = [];
    const Sequencer = selectingSequencer(Reversing, { root, configRoot: root, times, say: (line) => lines.push(line) });

    const first = await new Sequencer(context({ shard: { index: 1, count: 2 } })).shard(files.map(spec));
    const second = await new Sequencer(context({ shard: { index: 2, count: 2 } })).shard(files.map(spec));

    expect(names(first)).toEqual(['a.test.ts']);
    expect(names(second)).toEqual(['b.test.ts', 'c.test.ts', 'd.test.ts']);
    expect(lines[0]).toBe('variance-authority: shard 1/2 by the times recorded at ffffffffffff: 1 of 4 files, 9.0 s (shards 9.0 s to 9.0 s)');
  });

  it('places what the selection kept, so the shards split what runs', async () => {
    const Sequencer = selectingSequencer(Reversing, {
      root,
      configRoot: root,
      selection: async () => selection(['a.test.ts']),
      times,
      say: () => {},
    });

    const first = await new Sequencer(context({ shard: { index: 1, count: 2 } })).shard(files.map(spec));

    expect(names(first)).toEqual(['b.test.ts']);
  });

  it('passes the shard the selection left nothing to run, and only that one', async () => {
    const Sequencer = selectingSequencer(Reversing, {
      root,
      configRoot: root,
      selection: async () => selection(['a.test.ts', 'b.test.ts', 'c.test.ts']),
      times,
      say: () => {},
    });
    const shard = async (index: number) => {
      const config: SequencerContext['config'] = { shard: { index, count: 2 } };
      const sequencer = new Sequencer(context(config));
      return { part: names(await sequencer.sort(await sequencer.shard(files.map(spec)))), passes: config.passWithNoTests };
    };

    expect(await shard(1)).toEqual({ part: ['d.test.ts'], passes: undefined });
    expect(await shard(2)).toEqual({ part: [], passes: true });
  });

  it('places whole files by count when nothing is timed, and says why', async () => {
    const lines: string[] = [];
    const Sequencer = selectingSequencer(Reversing, {
      root,
      configRoot: root,
      times: async () => ({ unread: 'nothing is recorded there', recording: '/cache/unit.bin' }),
      say: (line) => lines.push(line),
    });

    const part = await new Sequencer(context({ shard: { index: 1, count: 2 } })).shard(files.map(spec));

    expect(names(part)).toEqual(['a.test.ts', 'c.test.ts']);
    expect(lines).toEqual(['variance-authority: shard 1/2 by file count: 2 of 4 files; no times at /cache/unit.bin: nothing is recorded there']);
  });

  it('places by count when it is handed no way to read times', async () => {
    const lines: string[] = [];
    const Sequencer = selectingSequencer(Reversing, { root, configRoot: root, say: (line) => lines.push(line) });

    const part = await new Sequencer(context({ shard: { index: 2, count: 2 } })).shard(files.map(spec));

    expect(names(part)).toEqual(['b.test.ts', 'd.test.ts']);
    expect(lines).toEqual(['variance-authority: shard 2/2 by file count: 2 of 4 files; no times at the record: no record was named to read them from']);
  });

  it('passes a shard left empty by fewer files than shards, and only that one', async () => {
    const Sequencer = selectingSequencer(Reversing, { root, configRoot: root, say: () => {} });
    const shard = async (index: number) => {
      const config: SequencerContext['config'] = { shard: { index, count: 2 } };
      const sequencer = new Sequencer(context(config));
      return { part: names(await sequencer.sort(await sequencer.shard([spec('a.test.ts')]))), passes: config.passWithNoTests };
    };

    expect(await shard(1)).toEqual({ part: ['a.test.ts'], passes: undefined });
    expect(await shard(2)).toEqual({ part: [], passes: true });
  });

  it('reads no times and says nothing when no shard is asked for and nothing is selected', async () => {
    const read = vi.fn(times);
    const lines: string[] = [];
    const Sequencer = selectingSequencer(Reversing, { root, configRoot: root, times: read, say: (line) => lines.push(line) });

    const sorted = await new Sequencer(context()).sort(files.map(spec));

    expect(names(sorted)).toEqual(['d.test.ts', 'c.test.ts', 'b.test.ts', 'a.test.ts']);
    expect(read).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
  });
});

describe('a configuration handed a selection', () => {
  const sequencerOf = (config: ReturnType<typeof withTestSelection>) =>
    (config.test?.sequence as { sequencer?: unknown } | undefined)?.sequencer;
  const configured = async (config: Parameters<typeof withTestSelection>[0], selected: boolean) => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-selecting-sequencer-'));
    try {
      return sequencerOf(withTestSelection({ ...config, root: directory }, {
        root: directory,
        coverageFile: resolve(directory, 'coverage.bin'),
        ...(selected ? { selection: async () => selection([]) } : {}),
      }));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };

  it('sets the sequencer on a single configuration, chaining the one it names', async () => {
    const sequencer = await configured({ test: { sequence: { sequencer: Reversing as never } } }, true);

    expect(sequencer).toBeTypeOf('function');
    expect(sequencer).not.toBe(Reversing);
  });

  it('sets it on the configuration that describes projects, where Vitest reads it', async () => {
    expect(await configured({ test: { projects: ['a'] } as never }, true)).toBeTypeOf('function');
  });

  it('sets it with no selection asked for too, so a `--shard` run is placed by time', async () => {
    expect(await configured({ test: {} }, false)).toBeTypeOf('function');
  });
});

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
    new (selectingSequencer(Reversing, { root, configRoot: root, say: () => {} }))(context(config));

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
    readonly config: { readonly sequence: { readonly sequencer?: unknown; readonly shuffle: boolean; seed?: number } };
    readonly logger: Logger;
  }
  const seam = async (shuffle: boolean) => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-seed-banner-'));
    try {
      const config = withTestSelection({ root: directory }, { root: directory, coverageFile: resolve(directory, 'coverage.bin') });
      const vitest: Hooked = { config: { sequence: { ...config.test?.sequence, shuffle } }, logger: new Logger() };
      const [first] = config.test!.reporters as unknown as [{ onInit: (ctx: Hooked) => void }];
      const plugin = (config.plugins as unknown as { name: string; configureVitest?: (context: { vitest: Hooked }) => void }[])
        .find((one) => one.name === 'variance-authority:test-selection');
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
