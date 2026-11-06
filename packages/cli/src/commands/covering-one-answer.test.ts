import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INSTRUMENTATION_ID } from '@variance-authority/sense/instrument';
import { readableTestCoverage, testCoverageFile } from '@variance-authority/sense/test-selection';
import { main } from '../bin.fixture.js';
import { readFlags } from '../args.js';
import { parseCoveringArgs } from '../covering-args.js';
import { readerMainline } from '../share-lines.js';
import { flagsFor, synopsisFor } from '../usage.js';
import type { Covering } from './covering.js';
import { coveringAnswer } from './covering-suites.js';
import { mainlineBase } from './mainline-base.js';
import { behindMainline, DISCOUNTS, git, gitStarted, recordIn } from './mainline-fixture.js';

// `ci-info` decides CI once, when it loads, so the module is cut: these questions are asked outside CI.
vi.mock('ci-info', () => ({ isCI: false }));
// Spied, not replaced: which reads reach the share, and how many resolve the record, is what is under test.
vi.mock('./mainline-base.js', async (original) => {
  const actual = await original<typeof import('./mainline-base.js')>();
  return { ...actual, mainlineBase: vi.fn(actual.mainlineBase) };
});
vi.mock('@variance-authority/sense/test-selection', async (original) => {
  const actual = await original<typeof import('@variance-authority/sense/test-selection')>();
  return { ...actual, readableTestCoverage: vi.fn(actual.readableTestCoverage) };
});
// Spied, not replaced: whether a read worked out a selection at all is what is under test.
vi.mock('../share-lines.js', async (original) => {
  const actual = await original<typeof import('../share-lines.js')>();
  return { ...actual, readerMainline: vi.fn(actual.readerMainline) };
});

/** What one `covering` question costs, and which stream each part of its answer leaves on. */

let home: string;
const cwd = process.cwd();

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'variance-covering-answer-')));
});

afterEach(async () => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

const parse = (argv: readonly string[]) => parseCoveringArgs(readFlags(argv, 'covering', flagsFor('covering'), synopsisFor('covering')));
const asked = (argv: readonly string[]) => coveringAnswer(parse(argv)) as Promise<Covering>;
const behindTheMainline = (options: { readonly publish: boolean }) => behindMainline(home, options);

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
    vi.mocked(readerMainline).mockClear();

    const answer = await asked(['--file', 'src/total.ts', '--suite', 'unit', '--text', text]);

    expect(answer.source).toMatchObject({ from: 'checkout' });
    expect(vi.mocked(readerMainline)).not.toHaveBeenCalled();
  });

  it('selects no mainline under `--execution`, which names its record', async () => {
    const { clone, second } = await behindTheMainline({ publish: true });
    await recordIn(clone, second, ['test/total.test.ts'], [DISCOUNTS], INSTRUMENTATION_ID);
    const named = testCoverageFile(clone, { suite: 'unit' });
    vi.mocked(readerMainline).mockClear();

    await asked(['--file', 'src/total.ts', '--execution', named]);

    expect(vi.mocked(readerMainline)).not.toHaveBeenCalled();
  });

  it('starts the same git on a repaint however many commits its ledger holds', async () => {
    const { clone, second } = await behindTheMainline({ publish: true });
    await recordIn(clone, second, ['test/total.test.ts'], [DISCOUNTS], INSTRUMENTATION_ID);
    const own = testCoverageFile(clone, { suite: 'unit' });
    const text = join(clone, 'held.ts');
    await writeFile(text, 'export function applyDiscount(price: number): number {\n  return price * 0.8;\n}\n');
    const commits = [second];
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f']) {
      await git(clone, '-c', 'user.email=fixture@example.test', '-c', 'user.name=Fixture', 'commit', '--quiet', '--allow-empty', '-m', name);
      commits.push(await git(clone, 'rev-parse', 'HEAD'));
    }
    const repaint = async (ledger: readonly string[]) => {
      const ran = ledger.map((commit, at) => ({ commit, files: [`test/${String(at)}.test.ts`] }));
      await writeFile(own.replace(/\.bin$/u, '.layer.json'), JSON.stringify({ pinned: { mainline: 'main', commit: second }, ran }));
      return gitStarted(clone, () => asked(['--file', 'src/total.ts', '--suite', 'unit', '--text', text]));
    };

    // The first read of a checkout does work no repaint repeats, so it measures nothing here.
    await repaint(commits);
    const few = await repaint(commits.slice(0, 2));
    const many = await repaint(commits);

    expect(many.length).toBe(few.length);
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
