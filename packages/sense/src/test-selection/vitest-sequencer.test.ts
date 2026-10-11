import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { SuiteSelection } from './suite-selection.js';
import { selectingSequencer, type SequencerContext } from './vitest-sequencer.js';
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
    const sequencer = new Sequencer({ config: { root, shard: { index: 1, count: 1 } } });

    const part = await sequencer.shard(['a.test.ts', 'b.test.ts'].map(spec));

    expect(names(part)).toEqual(['b.test.ts']);
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

  it('says none of M when every discovered file is skipped', async () => {
    const lines: string[] = [];
    const Sequencer = selectingSequencer(Reversing, {
      root,
      configRoot: root,
      selection: async () => selection(['a.test.ts', 'b.test.ts']),
      say: (line) => lines.push(line),
    });

    const sorted = await new Sequencer(context({}, ['a.test.ts', 'b.test.ts'])).sort(['a.test.ts', 'b.test.ts'].map(spec));

    expect(sorted).toEqual([]);
    expect(lines).toEqual(['variance-authority: selected none of 2']);
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

  it('hands the split to the project\'s sequencer when nothing is timed, and says so', async () => {
    const lines: string[] = [];
    const Sequencer = selectingSequencer(Reversing, {
      root,
      configRoot: root,
      times: async () => ({ unread: 'nothing is recorded there', recording: '/cache/unit.bin' }),
      say: (line) => lines.push(line),
    });

    const part = await new Sequencer(context({ shard: { index: 1, count: 2 } })).shard(files.map(spec));

    expect(names(part)).toEqual(['a.test.ts', 'b.test.ts']);
    expect(lines).toEqual(['variance-authority: shard 1/2 split by the runner, by count: no times at /cache/unit.bin: nothing is recorded there']);
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
