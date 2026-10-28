import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import { sourceIndexPath } from '@variance-authority/sense';
import { INSTRUMENTATION_ID } from '@variance-authority/sense/instrument';
import { combineRecords, encodeAsSetExecutionIndex, readTestCoverage, sourceCut, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { main, parseArgs } from '../bin.js';
import { distillRows } from './distill.js';
import { readExecutionIndex } from './execution-input.js';
import { followUpsLogPath, holdFollowUps, releaseFollowUps } from './index-follow-ups.js';
import { recordedJourneys } from './resources.js';

vi.mock('./resources.js', async (original) => ({
  ...await original<typeof import('./resources.js')>(),
  recordedJourneys: vi.fn(() => { throw new Error('combine must not compute a journey comparison'); }),
}));

vi.mock('@variance-authority/sense/test-selection', async (original) => {
  const actual = await original<typeof import('@variance-authority/sense/test-selection')>();
  return { ...actual, combineRecords: vi.fn(actual.combineRecords) };
});

const temporary: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'va-combine-command-')));
  temporary.push(root);
  await mkdir(join(root, 'src'));
  const source = 'export function greet() { return "hello"; }\n';
  await writeFile(join(root, 'src/greet.ts'), source);
  const shards: string[] = [];
  for (const name of ['a', 'b']) {
    const file = `${name}.test.ts`;
    await writeFile(join(root, file), 'it("greets", () => {});\n');
    const path = join(root, `${name}.bin`);
    const test = { id: `${file} > greets`, file, name: 'greets', stopped: false };
    const blocks = [
      { ordinal: 0, kind: 'module' as const, digest: 'module', name: '', path: '', startLine: 1, endLine: 1, source: true, testFiles: [], loadedBy: [file] },
      { ordinal: 1, owner: 0, kind: 'function' as const, digest: 'function', name: 'greet', path: 'greet', startLine: 1, endLine: 1, source: true, testFiles: [file] },
    ];
    await writeTestCoverage(path, {
      version: 3, instrumentation: 'fixture',
      tests: [{ file, complete: true, preconditions: [] }],
      modules: [{ file: 'src/greet.ts', sourceDigest: digestString(source), instrumented: true, blocks }],
    }, { index: encodeAsSetExecutionIndex({ tests: [test], modules: [{ file: 'src/greet.ts', blocks: blocks.map((block) => ({
      ...block, crossings: block.kind === 'function' ? [{ test: 0, distance: 0 }] : [],
    })) }] }) });
    shards.push(path);
  }
  return { root, shards, into: join(root, 'combined.bin') };
}

describe('`journeys combine`', () => {
  it('combines coverage and cases without project configuration, a checkout or a comparison', async () => {
    const { root, shards, into } = await fixture();
    const before = (await Promise.all(shards.map((execution) => distillRows({ root, execution })))).flatMap((read) => [...read.rows]);
    let out = '';
    let err = '';
    const code = await main(['journeys', 'combine', ...shards, '--into', into], {
      out: (text) => { out += text; }, err: (text) => { err += text; },
    });

    expect({ code, err }).toEqual({ code: 0, err: '' });
    expect(out).toBe(`journeys: combined 2 records into ${into} (2 tests, 1 modules, 2 crossings, 2 cases)\n`);
    expect(out).not.toContain('pool:');
    expect(recordedJourneys).not.toHaveBeenCalled();
    expect((await readTestCoverage(into)).modules[0]!.blocks[0]!.loadedBy).toEqual(['a.test.ts', 'b.test.ts']);
    expect((await readExecutionIndex(into)).tests.map((test) => test.id)).toEqual(['a.test.ts > greets', 'b.test.ts > greets']);
    expect([...(await distillRows({ root, execution: into })).rows]).toEqual(before);
  });

  it('runs past a live process still making what `variance index` left to it, since it reads none of it', async () => {
    const { root, shards, into } = await fixture();
    const cwd = process.cwd();
    const index = sourceIndexPath(root);
    await mkdir(dirname(index), { recursive: true });
    // This process is live and never lets the lock go, so a command that waits on it never returns.
    holdFollowUps(index, { pid: process.pid, log: followUpsLogPath(index) });
    try {
      process.chdir(root);
      let err = '';
      const code = await main(['journeys', 'combine', ...shards, '--into', into], { out: () => {}, err: (text) => { err += text; } });
      expect({ code, err }).toEqual({ code: 0, err: '' });
    } finally {
      releaseFollowUps(index, process.pid);
      process.chdir(cwd);
    }
  });

  it('writes the same bytes whatever order the shards are named in', async () => {
    const { shards, into } = await fixture();
    const quiet = { out: () => {}, err: () => {} };
    expect(await main(['journeys', 'combine', ...shards, '--into', into], quiet)).toBe(0);
    const swapped = `${into}.swapped`;
    expect(await main(['journeys', 'combine', ...[...shards].reverse(), '--into', swapped], quiet)).toBe(0);
    expect(Buffer.compare(await readFile(into), await readFile(swapped))).toBe(0);
  });

  it('fails on shards that started from different commits, by name, and writes nothing', async () => {
    const { root, shards, into } = await fixture();
    const other = join(root, 'other.bin');
    await writeTestCoverage(other, { version: 3, instrumentation: 'fixture', commit: 'elsewhere', tests: [{ file: 'c.test.ts', complete: true, preconditions: [] }], modules: [] });
    let err = '';
    const code = await main(['journeys', 'combine', shards[0]!, other, '--into', into], { out: () => {}, err: (text) => { err += text; } });
    expect(code).not.toBe(0);
    expect(err).toContain('the build failed because the sharding was unstable');
    expect(err).toContain(`${other} from commit \`elsewhere\``);
    await expect(readFile(into)).rejects.toThrow();
  });

  it('combines a shard that cannot name the record its selection read, and says its read was not checked', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'va-combine-unknown-')));
    temporary.push(root);
    const read = `sha256:${'0123456789ab'.repeat(5)}0123`;
    const shards = [join(root, 'jvm.bin'), join(root, 'node.bin')];
    for (const [at, file, base] of [[shards[0]!, 'A.java', 'unknown over none'], [shards[1]!, 'b.test.ts', `${read} over none`]] as const) {
      await writeTestCoverage(at, { version: 3, instrumentation: 'fixture', commit: 'c0ffee', tests: [{ file, complete: true, preconditions: [] }], modules: [] }, { base: Buffer.from(base) });
    }
    const into = join(root, 'combined.bin');
    let out = '';
    const code = await main(['journeys', 'combine', ...shards, '--into', into], { out: (text) => { out += text; }, err: () => {} });
    expect(code).toBe(0);
    expect(out).toContain(
      `journeys: the read of ${shards[0]} was not checked: its record names the record its selection read \`unknown\`, ` +
        'so nothing says it chose its tests from the record the other shards read\n',
    );
  });

  async function refused(named: string[], into: string) {
    const before = await readFile(into);
    let err = '';
    const code = await main(['journeys', 'combine', ...named, '--into', into], { out: () => {}, err: (text) => { err += text; } });
    expect(code).not.toBe(0);
    expect(err).toContain(`${into} is already there`);
    expect(err).toContain('variance journeys <shards> --into');
    expect(Buffer.compare(await readFile(into), before)).toBe(0);
  }

  it('refuses an --into that is already there, names the command that lands over it, and leaves it as it was', async () => {
    const { shards, into } = await fixture();
    await writeFile(into, 'kept');
    await refused(shards, into);
  });

  it('leaves an --into made while the shards combine as it was, and leaves nothing beside it', async () => {
    const { root, shards, into } = await fixture();
    const actual = vi.mocked(combineRecords).getMockImplementation()!;
    vi.mocked(combineRecords).mockImplementationOnce((named, output) => {
      const result = actual(named, output);
      writeFileSync(into, 'made meanwhile');
      return result;
    });
    let err = '';
    const code = await main(['journeys', 'combine', ...shards, '--into', into], { out: () => {}, err: (text) => { err += text; } });
    expect(code).not.toBe(0);
    expect(err).toContain(`${into} is already there`);
    expect(await readFile(into, 'utf8')).toBe('made meanwhile');
    expect((await readdir(root)).filter((name) => name.startsWith('combined.bin'))).toEqual(['combined.bin']);
  });

  it('refuses an --into that is one of the shards, so no shard is written over', async () => {
    const { shards } = await fixture();
    await refused(shards, shards[0]!);
  });

  it('reads no checkout, so it takes no `--root`', () => {
    expect(() => parseArgs(['journeys', 'combine', 'one.bin', '--into', 'all.bin', '--root', 'checkout'])).toThrow('`--root` is not');
  });

  it('resolves shard and output paths at the working directory', () => {
    expect(parseArgs(['journeys', 'combine', 'one.bin', '--into', 'all.bin'])).toEqual({
      command: 'journeys', operation: 'combine', config: expect.any(String), shards: [resolve('one.bin')], into: resolve('all.bin'),
    });
  });

  it.each([
    ['combine'], ['combine', 'one.bin'], ['combine', '--into', 'all.bin'],
    ['combine', 'one.bin', '--into', 'all.bin', '--suite', 'unit'],
    ['combine', 'one.bin', '--into', 'all.bin', '--all'],
    ['combine', 'one.bin', '--into', 'all.bin', '--config', 'web.json'],
  ])('refuses incomplete or reading-specific arguments: %j', (...args) => {
    expect(() => parseArgs(['journeys', ...args])).toThrow('`variance journeys combine`');
  });
});

describe('`variance journeys combine` over shards that cut one text two ways', () => {
  it('cuts the module again in the checkout it runs in, from any directory of it', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'va-combine-disputed-')));
    temporary.push(root);
    execFileSync('git', ['init', '--quiet', root]);
    await mkdir(join(root, 'src'));
    const twice = 'export function both(run: (step: () => number) => void) {\n  run(() => 1);\n  run(() => 2);\n}\n';
    await writeFile(join(root, 'src/twice.ts'), twice);
    const cut = sourceCut(twice, 'src/twice.ts', 'presence')!;
    const shards = await Promise.all([['fresh', 'a.test.ts', undefined], ['carried', 'b.test.ts', 'older']].map(async ([name, file, stale]) => {
      const path = join(root, `${name}.bin`);
      const blocks = cut.rows.map((row, at) => ({ ...row, digest: at === 1 && stale !== undefined ? stale : row.digest, testFiles: [file!] }));
      await writeTestCoverage(path, {
        version: 3, instrumentation: INSTRUMENTATION_ID, commit: 'c0ffee',
        tests: [{ file: file!, complete: true, preconditions: [], duration: 1 }],
        modules: [{ file: 'src/twice.ts', sourceDigest: cut.sourceDigest, instrumented: true, blocks }],
      });
      return path;
    }));
    const into = join(root, 'combined.bin');
    const cwd = process.cwd();
    let err = '';
    try {
      process.chdir(join(root, 'src'));
      const code = await main(['journeys', 'combine', ...shards, '--into', into], { out: () => {}, err: (text) => { err += text; } });
      expect({ code, err }).toEqual({ code: 0, err: '' });
    } finally {
      process.chdir(cwd);
    }
    expect((await readTestCoverage(into)).modules[0]!.blocks.map((block) => block.testFiles)).toEqual(cut.rows.map(() => ['a.test.ts', 'b.test.ts']));
  });
});
