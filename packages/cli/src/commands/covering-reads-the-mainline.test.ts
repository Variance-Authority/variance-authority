import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INSTRUMENTATION_ID } from '@variance-authority/sense/instrument';
import { readableTestCoverage, testCoverageFile, writeSelectedMainline } from '@variance-authority/sense/test-selection';
import { readFlags } from '../args.js';
import { parseCoveringArgs } from '../covering-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { formatCovering, type Covering } from './covering.js';
import { changeSince, listedChange } from './covering-since.js';
import { coveringAnswer } from './covering-suites.js';
import { main } from '../bin.fixture.js';
import { mainlineBase } from './mainline-base.js';
import { cloneOf, DISCOUNTS, git, publishTo, published, PUSH, recordIn } from './mainline-fixture.js';
import { GapRefusal } from './evidence-gap.js';
import { diffSince } from './since.js';
import { suiteBase } from './suite-base.js';

// `ci-info` decides CI once, when it loads, so the module is cut: these questions are asked outside CI.
vi.mock('ci-info', () => ({ isCI: false }));
// Spied, not replaced: how many times the change is read is what the read's cost is.
vi.mock('./since.js', async (original) => {
  const actual = await original<typeof import('./since.js')>();
  return { ...actual, diffSince: vi.fn(actual.diffSince) };
});
// Spied, not replaced: which reads reach the share, and how many resolve the record, is what is under test.
vi.mock('./mainline-base.js', async (original) => {
  const actual = await original<typeof import('./mainline-base.js')>();
  return { ...actual, mainlineBase: vi.fn(actual.mainlineBase) };
});
vi.mock('@variance-authority/sense/test-selection', async (original) => {
  const actual = await original<typeof import('@variance-authority/sense/test-selection')>();
  return { ...actual, readableTestCoverage: vi.fn(actual.readableTestCoverage), writeSelectedMainline: vi.fn(actual.writeSelectedMainline) };
});

/**
 * `covering` reads the record every other base reader reads, in a checkout that
 * never ran the suite and was never told to fetch: the mainline's newest, not
 * whatever an earlier read left on this machine. Its `--since` lists what the
 * change changed, whichever record answered, and it says which record that was.
 */

let home: string;
const cwd = process.cwd();

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'variance-covering-mainline-')));
});

afterEach(async () => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

const asCi = () => vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'ci-cache'));
const asClone = () => vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'clone-cache'));
const parse = (argv: readonly string[]) => parseCoveringArgs(readFlags(argv, 'covering', flagsFor('covering'), synopsisFor('covering')));
const asked = (argv: readonly string[]) => coveringAnswer(parse(argv)) as Promise<Covering>;
const since = ['--since', 'origin/main', '--suite', 'unit'];

/** A clone that fetched the mainline's first record, with main then moved past it by a commit the clone holds. */
async function behindTheMainline(options: { readonly publish: boolean }) {
  asCi();
  const ci = await published(home);
  const clone = await cloneOf(home, ci.origin);
  asClone();
  await suiteBase(clone, { env: {} });

  asCi();
  await writeFile(join(ci.dir, 'src/moved.ts'), 'export const moved = 1;\n');
  await git(ci.dir, 'add', '-A');
  await git(ci.dir, 'commit', '--quiet', '-m', 'main moves on');
  const second = await git(ci.dir, 'rev-parse', 'HEAD');
  await git(ci.dir, 'push', '--quiet', 'origin', 'main');
  if (options.publish) {
    await recordIn(ci.dir, second, ['test/total.test.ts'], [DISCOUNTS]);
    await publishTo(home, ci.dir, second, PUSH, 'mainline main');
  }
  asClone();
  await git(clone, 'pull', '--quiet', 'origin', 'main');
  process.chdir(clone);
  return { ...ci, clone, second };
}

/** The line the change makes, so a list that holds anything else holds a file nobody here changed. */
const edit = (clone: string) => writeFile(join(clone, 'src/total.ts'), 'export function applyDiscount(price: number): number {\n  return price * 0.8;\n}\n');

describe('a checkout that never ran the suite', () => {
  it("reads the mainline's newest record, not the one an earlier read left here, with no step before it", async () => {
    const { clone, second } = await behindTheMainline({ publish: true });
    await edit(clone);

    const answer = await asked(since);

    expect(answer.at).toBe(second);
    expect(answer.changed?.map((change) => change.file)).toEqual(['src/total.ts']);
    expect(answer.source).toMatchObject({ from: 'mainline', mainline: 'main', distance: 0 });
  });

  it('asks about a line of the record it read, and says whose that is', async () => {
    const { second } = await behindTheMainline({ publish: true });

    const answer = await asked(['--file', 'src/total.ts', '--suite', 'unit']);

    expect(answer.at).toBe(second);
    const said = formatCovering(answer, 'text', Date.now());
    expect(said).toContain(`record of "unit": read from mainline main, published at ${second}`);
    expect(JSON.parse(formatCovering(answer, 'json', Date.now()))).toMatchObject({ source: { from: 'mainline' } });
    expect(formatCovering(answer, 'refs', Date.now())).not.toContain('record of');
  });

  it('lists only what the change changed when the mainline cannot be read, and says the record is behind', async () => {
    const { clone, first } = await behindTheMainline({ publish: true });
    await rm(join(home, 'share'), { recursive: true, force: true });
    await edit(clone);

    const answer = await asked(since);

    expect(answer.at).toBe(first);
    expect(answer.changed?.map((change) => change.file)).toEqual(['src/total.ts']);
    expect(answer.source?.distance).toBe(1);
    expect(formatCovering(answer, 'text', Date.now())).toContain('because the mainline was not read now');
  });

  it("lists only what the change changed when the record trails the merge base, the commits between it being main's", async () => {
    const { clone, first } = await behindTheMainline({ publish: false });
    await edit(clone);

    const answer = await asked(since);

    expect(answer.at).toBe(first);
    expect(answer.changed?.map((change) => change.file)).toEqual(['src/total.ts']);
  });

  it('keeps the file a change renamed away, which the record holds under its old path', async () => {
    const { clone } = await behindTheMainline({ publish: false });
    await git(clone, 'mv', 'src/total.ts', 'src/sum.ts');

    const answer = await asked(since);

    expect(answer.changed?.map((change) => change.file).sort()).toEqual(['src/sum.ts', 'src/total.ts']);
  });

  it('does not ask the remote for a record already at the merge base', async () => {
    const { clone } = await behindTheMainline({ publish: true });
    await asked(['--file', 'src/total.ts', '--suite', 'unit']);
    await rm(join(home, 'share'), { recursive: true, force: true });
    await edit(clone);

    const answer = await asked(since);

    expect(answer.source?.says).not.toContain('not read now');
    expect(answer.source?.distance).toBe(0);
  });

  it('says why no record was read when the mainline gave none and nothing is held', async () => {
    asCi();
    const ci = await published(home, { publish: false });
    const clone = await cloneOf(home, ci.origin);
    asClone();
    process.chdir(clone);

    const refused = await asked(['--file', 'src/total.ts', '--suite', 'unit']).catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(GapRefusal);
    expect((refused as GapRefusal).message).toBe(
      `nothing is recorded in \`${clone}\`: no run left a per-case index in \`${testCoverageFile(clone, { suite: 'unit' })}\`, so no case can be named. ` +
        "`variance share --suite unit` fetches the mainline's record of it. " +
        'record of "unit": the share has none either; mainline main: nothing is published there.',
    );
    expect((refused as GapRefusal).gap).toMatchObject({ next: ['variance share --suite unit'] });
  });

  it('reads a record named by path as that record, and asks the remote nothing', async () => {
    const { clone } = await behindTheMainline({ publish: true });
    asCi();
    const named = testCoverageFile(join(home, 'ci'), { suite: 'unit' });
    asClone();
    await edit(clone);

    const answer = await asked(['--since', 'origin/main', '--execution', named]);

    expect(answer.from).toBe(named);
    expect(answer.source).toBeUndefined();
  });
});

describe('a file the change and the commits since the record both wrote', () => {
  const FILE = 'src/long.ts';
  const held = Array.from({ length: 20 }, (_, at) => `line ${String(at + 1)}`);
  const written = (dir: string, lines: readonly string[]) => writeFile(join(dir, FILE), `${lines.join('\n')}\n`);
  const rewritten = (lines: readonly string[], at: number, text: string) => lines.map((line, index) => (index === at - 1 ? text : line));

  /** A record's commit, and `main` a commit past it holding `mainline` where the record held `held`. */
  async function recordBehind(mainline: readonly string[]) {
    const dir = join(home, 'both');
    await mkdir(join(dir, 'src'), { recursive: true });
    await git(dir, 'init', '--quiet', '--initial-branch=main');
    await git(dir, 'config', 'user.email', 'a@example.com');
    await git(dir, 'config', 'user.name', 'a');
    await written(dir, held);
    await git(dir, 'add', '-A');
    await git(dir, 'commit', '--quiet', '-m', 'the record');
    const at = await git(dir, 'rev-parse', 'HEAD');
    await written(dir, mainline);
    await git(dir, 'commit', '--quiet', '-am', 'main moves on');
    process.chdir(dir);
    return { dir, at };
  }
  const answered = async (dir: string, at: string) => changeSince(await listedChange('HEAD'), 'HEAD', dir, at);

  it("answers for the change's hunk, in the record's numbers, and not for the mainline's", async () => {
    const mainline = rewritten(held, 2, 'the mainline');
    const { dir, at } = await recordBehind(mainline);
    await written(dir, rewritten(mainline, 18, 'the change'));

    expect(await answered(dir, at)).toEqual(new Map([[FILE, [{ start: 18, end: 18 }]]]));
  });

  it('keeps what the change removed and what it inserted, each where the record held it', async () => {
    const mainline = rewritten(held, 2, 'the mainline');
    const { dir, at } = await recordBehind(mainline);
    await written(dir, [...mainline.slice(0, 9), ...mainline.slice(10, 18), 'the change', ...mainline.slice(18)]);

    expect(await answered(dir, at)).toEqual(new Map([[FILE, [{ start: 10, end: 10 }, { start: 18, end: 19, added: 'the change' }]]]));
  });

  it('reads one hunk both sides wrote whole, a hunk being the grain', async () => {
    const mainline = rewritten(held, 17, 'the mainline');
    const { dir, at } = await recordBehind(mainline);
    await written(dir, rewritten(mainline, 18, 'the change'));

    expect(await answered(dir, at)).toEqual(new Map([[FILE, [{ start: 17, end: 17 }, { start: 18, end: 18 }]]]));
  });

  it('holds the line of a file the change put back as the record had it, which the change still changed', async () => {
    const mainline = rewritten(rewritten(held, 2, 'the mainline'), 18, 'the mainline again');
    const { dir, at } = await recordBehind(mainline);
    await written(dir, rewritten(mainline, 2, 'line 2'));

    expect(await answered(dir, at)).toEqual(new Map([[FILE, [{ start: 2, end: 2 }]]]));
  });
});

describe('a checkout that ran the suite', () => {
  it('answers from a record of its own at the merge base, and says so', async () => {
    const { clone, second } = await behindTheMainline({ publish: true });
    await recordIn(clone, second, ['test/total.test.ts'], [DISCOUNTS]);

    const answer = await asked(['--file', 'src/total.ts', '--suite', 'unit']);

    expect(answer.at).toBe(second);
    expect(answer.source).toMatchObject({ from: 'checkout' });
    expect(formatCovering(answer, 'text', Date.now())).toContain('record of "unit": read from this checkout\'s own');
  });
});

describe('a worktree of a clone whose record main has moved past', () => {
  /** The clone ran the suite at the first commit, and pulled the second. No line of it was published, so nothing newer exists to read. */
  async function worktreeOfTheClone() {
    asCi();
    const ci = await published(home, { publish: false });
    const clone = await cloneOf(home, ci.origin);
    asClone();
    await recordIn(clone, ci.first, ['test/total.test.ts'], [DISCOUNTS]);
    asCi();
    await writeFile(join(ci.dir, 'src/moved.ts'), 'export const moved = 1;\n');
    await git(ci.dir, 'add', '-A');
    await git(ci.dir, 'commit', '--quiet', '-m', 'main moves on');
    await git(ci.dir, 'push', '--quiet', 'origin', 'main');
    asClone();
    await git(clone, 'pull', '--quiet', 'origin', 'main');
    const worktree = join(home, 'feature');
    await git(clone, 'worktree', 'add', '--quiet', '--detach', worktree, 'origin/main');
    process.chdir(worktree);
    return { first: ci.first, worktree };
  }

  it('says a clean tree has nothing to ask about, whatever the record trails by', async () => {
    await worktreeOfTheClone();

    const answer = await coveringAnswer(parse(['--since', 'origin/main']));

    expect('suites' in answer ? answer.suites : []).toMatchObject([{ suite: 'unit', reason: 'nothing has changed since `origin/main`, so there is no region to ask about.' }]);
  });

  it("reads the primary checkout's record through the layers, says so, and lists only the change", async () => {
    const { first, worktree } = await worktreeOfTheClone();
    await edit(worktree);

    const answer = await asked(since);

    expect(answer.at).toBe(first);
    expect(answer.changed?.map((change) => change.file)).toEqual(['src/total.ts']);
    expect(answer.source?.says).toContain(`primary checkout`);
  });
});

describe('the change `--since` names', () => {
  const reads = () => vi.mocked(diffSince).mock.calls.filter(([ref]) => ref === 'origin/main').length;

  it('is read once when the record stands at the merge base', async () => {
    const { clone } = await behindTheMainline({ publish: true });
    await edit(clone);
    vi.mocked(diffSince).mockClear();

    await coveringAnswer(parse(['--since', 'origin/main']));

    expect(reads()).toBe(1);
  });

  it('is read again from the record whenever the record is not at the merge base', async () => {
    const { clone } = await behindTheMainline({ publish: false });
    await edit(clone);
    vi.mocked(diffSince).mockClear();

    await coveringAnswer(parse(['--since', 'origin/main']));

    expect(reads()).toBe(2);
  });

  it('lists what the change wrote into a record ahead of the merge base, and what moved past that record', async () => {
    const { clone } = await behindTheMainline({ publish: false });
    await git(clone, 'config', 'user.email', 'fixture@example.test');
    await git(clone, 'config', 'user.name', 'Fixture');
    await edit(clone);
    await git(clone, 'commit', '--quiet', '-am', 'the change the record runs over');
    await recordIn(clone, await git(clone, 'rev-parse', 'HEAD'), ['test/total.test.ts'], [DISCOUNTS]);
    await writeFile(join(clone, 'src/moved.ts'), 'export const moved = 2;\n');
    vi.mocked(diffSince).mockClear();

    const answer = await asked(since);

    expect(answer.changed?.map((change) => change.file)).toEqual(['src/moved.ts', 'src/total.ts']);
    expect(reads()).toBe(2);
  });

  it('says git could not read the diff, not that the clone lacks a commit it holds', async () => {
    const { clone, first } = await behindTheMainline({ publish: false });
    await edit(clone);
    const read = vi.mocked(diffSince).getMockImplementation()!;
    vi.mocked(diffSince).mockImplementation(async (ref, paths, at, options) => (at === first ? undefined : read(ref, paths, at, options)));

    try {
      await expect(asked(since)).rejects.toThrow(`The record was recorded at ${first}, and git could not read the diff from it to the working tree, so it is not compared.`);
    } finally {
      vi.mocked(diffSince).mockImplementation(read);
    }
  });

  it('names the commit to fetch when the record was made at one this clone lacks, rather than blaming the ref', async () => {
    asCi();
    const ci = await published(home);
    const clone = await cloneOf(home, ci.origin);
    await writeFile(join(ci.dir, 'src/moved.ts'), 'export const moved = 1;\n');
    await git(ci.dir, 'add', '-A');
    await git(ci.dir, 'commit', '--quiet', '-m', 'main moves on');
    const second = await git(ci.dir, 'rev-parse', 'HEAD');
    await recordIn(ci.dir, second, ['test/total.test.ts'], [DISCOUNTS]);
    const named = testCoverageFile(ci.dir, { suite: 'unit' });
    asClone();
    process.chdir(clone);
    await edit(clone);

    await expect(asked(['--since', 'origin/main', '--execution', named]))
      .rejects.toThrow(`The record was recorded at ${second}, which this clone does not have, so it is not compared. Fetch it with \`git fetch origin ${second}\``);
  });
});

describe('a question with `--text`, which an editor asks on every repaint', () => {
  const held = async () => {
    const text = join(home, 'held.ts');
    await writeFile(text, 'export function applyDiscount(price: number): number {\n  return price * 0.9;\n}\n');
    return text;
  };

  it('reads the record fetched here and does not ask the line, though the line holds a nearer one', async () => {
    const { first, second } = await behindTheMainline({ publish: true });

    const answer = await asked(['--file', 'src/total.ts', '--suite', 'unit', '--text', await held()]);

    expect(answer.at).toBe(first);
    expect(answer.source).toMatchObject({ from: 'mainline', mainline: 'main', distance: 1 });
    expect(answer.source?.says).toContain('and kept: the line was not asked');
    // No fetch happened: what a question that does fetch reads next is the record the line held all along.
    expect((await asked(['--file', 'src/total.ts', '--suite', 'unit'])).at).toBe(second);
  });

  it('reads the record a run left in this checkout first, as every other question does', async () => {
    const { clone, second } = await behindTheMainline({ publish: false });
    await recordIn(clone, second, ['test/total.test.ts'], [DISCOUNTS]);

    const answer = await asked(['--file', 'src/total.ts', '--suite', 'unit', '--text', await held()]);

    expect(answer.at).toBe(second);
    expect(answer.source).toMatchObject({ from: 'checkout' });
  });

  it('says the share was not asked when nothing is fetched here, though it holds a record', async () => {
    asCi();
    const ci = await published(home);
    const clone = await cloneOf(home, ci.origin);
    asClone();
    process.chdir(clone);

    const refused = asked(['--file', 'src/total.ts', '--suite', 'unit', '--text', await held()]);

    await expect(refused).rejects.toThrow('record of "unit": the share was not asked; this read does not fetch.');
    // Not `unconfigured`: nothing is missing from this environment, and a read that may fetch finds the record.
    expect(await suiteBase(clone, { env: {}, fetch: 'never' })).toMatchObject({ from: 'none', missed: { miss: { kind: 'unfetched' }, shareAsked: false } });
  });
});

describe('one answer', () => {
  it('resolves its record once, and the frame and the hops read that one', async () => {
    await behindTheMainline({ publish: true });
    for (const spy of [mainlineBase, readableTestCoverage]) vi.mocked(spy).mockClear();

    await asked(['--file', 'src/total.ts', '--line', '2', '--hops', '--suite', 'unit']);

    expect(vi.mocked(mainlineBase)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(readableTestCoverage)).not.toHaveBeenCalled();
  });

  it('selects no mainline for a repaint this checkout answers from its own record, which is nobody else\'s', async () => {
    const { clone, second } = await behindTheMainline({ publish: true });
    await recordIn(clone, second, ['test/total.test.ts'], [DISCOUNTS], INSTRUMENTATION_ID);
    const text = join(clone, 'held.ts');
    await writeFile(text, 'export function applyDiscount(price: number): number {\n  return price * 0.8;\n}\n');
    vi.mocked(writeSelectedMainline).mockClear();

    const answer = await asked(['--file', 'src/total.ts', '--suite', 'unit', '--text', text]);

    expect(answer.source).toMatchObject({ from: 'checkout' });
    expect(vi.mocked(writeSelectedMainline)).not.toHaveBeenCalled();
  });
});

describe('the streams of an answer', () => {
  const ask = async (argv: readonly string[]) => {
    let out = '';
    let err = '';
    const code = await main(argv, { out: (text) => (out += text), err: (text) => (err += text) });
    return { code, out, err };
  };

  it('keeps stdout a list under `refs`, and says whose record it read on stderr, for one suite or each', async () => {
    const { second } = await behindTheMainline({ publish: true });
    const says = `record of "unit": read from mainline main, published at ${second}`;

    for (const argv of [['--suite', 'unit'], []]) {
      const answer = await ask(['covering', '--file', 'src/total.ts', '--format', 'refs', ...argv]);

      expect(answer.out).not.toContain('record of');
      expect(answer.err).toContain(says);
    }
  });

  it("says a tree with no change is each suite's reason at exit 0, and fetches no record for it", async () => {
    await behindTheMainline({ publish: true });
    vi.mocked(mainlineBase).mockClear();

    const answer = await ask(['covering', '--since', 'origin/main']);

    expect(answer.code).toBe(0);
    expect(answer.out).toContain('nothing has changed since `origin/main`');
    expect(vi.mocked(mainlineBase)).not.toHaveBeenCalled();
  });

  it('refuses a ref that does not read at exit 2, on the stream a program parses, before any record is read', async () => {
    await behindTheMainline({ publish: true });
    vi.mocked(mainlineBase).mockClear();

    const answer = await ask(['covering', '--since', 'no-such-ref', '--format', 'json']);

    expect(answer.code).toBe(2);
    expect(JSON.parse(answer.out)).toEqual({ refused: 'undiffed' });
    expect(answer.err).toContain('`--since no-such-ref` could not be read as a diff');
    expect(vi.mocked(mainlineBase)).not.toHaveBeenCalled();
  });
});
