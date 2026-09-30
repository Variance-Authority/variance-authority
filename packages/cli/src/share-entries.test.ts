import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { commitRunsFile, testCoverageFile, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { report } from './commands/push-fixture.js';
import {
  REPORT_ENTRY,
  frame,
  readReportEntry,
  readSuiteEntry,
  reportEntryOf,
  suiteEntryOf,
  unframe,
} from './share-entries.js';

const AT = { commit: 'a'.repeat(40), head: 'b'.repeat(40) } as const;
const PNG = Buffer.from('after-pixels');
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

let dir: string;
let cache: string;
let previous: string | undefined;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'variance-share-entries-'));
  cache = await mkdtemp(join(tmpdir(), 'variance-share-entries-cache-'));
  previous = process.env['VARIANCE_AUTHORITY_CACHE'];
  process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
});

afterAll(async () => {
  if (previous === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = previous;
  await rm(dir, { recursive: true, force: true });
  await rm(cache, { recursive: true, force: true });
});

describe('a report as a `report-v1` entry', () => {
  it('holds the report byte for byte, and the digest of each image it names', async () => {
    const at = join(dir, 'out', 'report.json');
    await mkdir(join(dir, 'out', 'images'), { recursive: true });
    const text = JSON.stringify(report({ after: 'images/card.png', before: 'images/card.before.png' }));
    await writeFile(at, text);
    await writeFile(join(dir, 'out', 'images', 'card.png'), PNG);

    const { entry, images, leftOut } = await reportEntryOf(at, AT);

    expect(entry).toMatchObject({ name: REPORT_ENTRY, commit: AT.commit, head: AT.head, images: [sha(PNG)] });
    expect(images).toEqual([{ digest: sha(PNG), path: join(dir, 'out', 'images', 'card.png') }]);
    expect(leftOut).toEqual([join(dir, 'out', 'images', 'card.before.png')]);
    const read = readReportEntry(entry.bytes);
    if (typeof read === 'string') throw new Error(read);
    expect(new TextDecoder().decode(read.report)).toBe(text);
    // The baseline the disk does not hold is left out, not guessed at.
    expect(read.images).toEqual({ 'images/card.png': sha(PNG) });
  });
});

describe('a suite as a `suite-v1/<suite>` entry', () => {
  async function recorded(name: string, commit?: string): Promise<{ readonly root: string; readonly coverage: string }> {
    const root = join(dir, name);
    await mkdir(root, { recursive: true });
    execFileSync('git', ['init', '--quiet', root]);
    await writeFile(join(root, 'variance.config.json'), JSON.stringify({ suites: { unit: { kind: 'unit' } } }));
    const coverage = testCoverageFile(root, { suite: 'unit' });
    await mkdir(dirname(coverage), { recursive: true });
    await writeTestCoverage(coverage, { version: 3, instrumentation: 'fixture', ...(commit === undefined ? {} : { commit }), tests: [], modules: [] });

    return { root, coverage };
  }

  it('holds the coverage record and its per-case index, and no names table', async () => {
    const { root, coverage } = await recorded('repo', AT.commit);
    await writeFile(`${coverage}.cases.bin`, 'cases');

    const entry = await suiteEntryOf(root, 'unit', { commit: AT.commit });

    if (entry === undefined || 'unpublished' in entry) throw new Error(`not published: ${JSON.stringify(entry)}`);
    expect(entry).toMatchObject({ name: 'suite-v1/unit', commit: AT.commit });
    const parts = unframe(entry.bytes);
    expect(typeof parts === 'string' ? parts : [...parts.keys()]).toEqual(['coverage.bin', 'coverage.bin.cases.bin']);
    const read = readSuiteEntry(entry.bytes);
    if (typeof read === 'string') throw new Error(read);
    expect(Buffer.from(read.coverage).equals(await readFile(coverage))).toBe(true);
    expect(new TextDecoder().decode(read.cases)).toBe('cases');
  });

  it('is not published under a commit other than the one the record names, and says which it names', async () => {
    const { root, coverage } = await recorded('stale', 'c'.repeat(40));

    expect(await suiteEntryOf(root, 'unit', { commit: AT.commit })).toEqual({
      unpublished: `its record at ${coverage} was recorded at ${'c'.repeat(40)}, not at ${AT.commit}`,
    });
  });

  it('is not published when the record names no commit', async () => {
    const { root, coverage } = await recorded('nowhere');

    expect(await suiteEntryOf(root, 'unit', { commit: AT.commit })).toEqual({ unpublished: `its record at ${coverage} names no commit` });
  });

  it('is not published when the record does not read, and says why', async () => {
    const { root, coverage } = await recorded('torn', AT.commit);
    await writeFile(coverage, 'rows');

    const entry = await suiteEntryOf(root, 'unit', { commit: AT.commit });

    const why = entry !== undefined && 'unpublished' in entry ? entry.unpublished : JSON.stringify(entry);
    expect(why).toContain(`its record at ${coverage} does not read: `);
  });

  it('is absent for a suite that has recorded nothing here, never empty', async () => {
    const root = join(dir, 'bare');
    await mkdir(root, { recursive: true });
    execFileSync('git', ['init', '--quiet', root]);
    await writeFile(join(root, 'variance.config.json'), JSON.stringify({ suites: { unit: { kind: 'unit' } } }));

    expect(await suiteEntryOf(root, 'unit', { commit: AT.commit })).toBeUndefined();
  });
});

describe('a mainline\'s `suite-v1/<suite>` entry', () => {
  /** A commit that holds `test/kept.test.ts`, the record a run made there, and the runs record `runs` beside it when one is given. */
  async function ranAt(name: string, runs?: (commit: string) => object): Promise<{ root: string; coverage: string; commit: string }> {
    const root = join(dir, name);
    await mkdir(join(root, 'test'), { recursive: true });
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    git('init', '--quiet');
    await writeFile(join(root, 'variance.config.json'), JSON.stringify({ suites: { unit: { kind: 'unit' } } }));
    await writeFile(join(root, 'test/kept.test.ts'), '');
    git('add', '-A');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--quiet', '-m', 'first');
    const commit = git('rev-parse', 'HEAD');
    const coverage = testCoverageFile(root, { suite: 'unit' });
    await mkdir(dirname(coverage), { recursive: true });
    await writeTestCoverage(coverage, { version: 3, instrumentation: 'fixture', commit, tests: [], modules: [] });
    if (runs !== undefined) await writeFile(commitRunsFile(coverage), JSON.stringify(runs(commit)));
    return { root, coverage, commit };
  }
  const at = '2026-01-01T00:00:00.000Z';
  const ran = (commit: string, standing?: readonly { commit: string; files: string[] }[]) => ({
    commit, first: at, latest: at, runs: 1, files: ['test/kept.test.ts'], ...(standing === undefined ? {} : { standing }),
  });

  it('carries the runs record of a run of the whole suite, and a reader reads it back', async () => {
    const { root, coverage, commit } = await ranAt('whole', (at) => ran(at, []));

    const entry = await suiteEntryOf(root, 'unit', { commit }, { whole: true });

    if (entry === undefined || 'unpublished' in entry) throw new Error(`not published: ${JSON.stringify(entry)}`);
    const read = readSuiteEntry(entry.bytes);
    if (typeof read === 'string') throw new Error(read);
    expect(Buffer.from(read.runs ?? []).equals(await readFile(commitRunsFile(coverage)))).toBe(true);
  });

  it('counts a test that last ran before the commit as run when the commit no longer has it', async () => {
    const { root, commit } = await ranAt('deleted', (at) => ran(at, [{ commit: 'c'.repeat(40), files: ['test/gone.test.ts'] }]));

    expect(await suiteEntryOf(root, 'unit', { commit }, { whole: true })).toMatchObject({ name: 'suite-v1/unit', commit });
  });

  it('is not published for a mainline when a test the commit still has last ran before it, and names one', async () => {
    const { root, coverage, commit } = await ranAt('partial', (at) => ran(at, [{ commit: 'c'.repeat(40), files: ['test/kept.test.ts'] }]));

    expect(await suiteEntryOf(root, 'unit', { commit }, { whole: true })).toEqual({
      unpublished: `its record at ${coverage} is not a whole run: 1 test file(s) git holds at ${commit} last ran before it, test/kept.test.ts among them; ` +
        'the runner was not asked which files it collects, so each one git holds counts: pass `--collected`',
    });
  });

  it('is not published for a mainline when a test file the runner collects is in no run the record lists, and names it', async () => {
    const { root, coverage, commit } = await ranAt('unlisted', (at) => ran(at, []));
    const collected = new Set(['test/kept.test.ts', 'test/new.test.ts']);

    expect(await suiteEntryOf(root, 'unit', { commit }, { whole: true, collected })).toEqual({
      unpublished: `its record at ${coverage} is not a whole run: 1 test file(s) the suite collects are listed nowhere in the runs record: test/new.test.ts`,
    });
    expect(await suiteEntryOf(root, 'unit', { commit }, { whole: true, collected: new Set(['test/kept.test.ts']) })).toMatchObject({
      name: 'suite-v1/unit',
    });
  });

  it('is not published for a mainline when nothing says the whole suite ran, and says what was missing', async () => {
    const bare = await ranAt('runless');
    const vague = await ranAt('vague', (at) => ran(at));
    const other = await ranAt('other', () => ran('c'.repeat(40), []));

    const why = async (one: { root: string; commit: string }) => {
      const entry = await suiteEntryOf(one.root, 'unit', { commit: one.commit }, { whole: true });
      return entry !== undefined && 'unpublished' in entry ? entry.unpublished : JSON.stringify(entry);
    };
    expect(await why(bare)).toBe(`its record at ${bare.coverage} is not a whole run: no runs record lies beside it, so nothing says which tests ran at this commit`);
    expect(await why(vague)).toBe(`its record at ${vague.coverage} is not a whole run: the runs record beside it does not say where every test it did not run last ran`);
    expect(await why(other)).toBe(`its record at ${other.coverage} is not a whole run: the runs record beside it is ${'c'.repeat(40)}'s, not ${other.commit}'s`);
    // A branch's line asks for no whole run: its record is what its run selected.
    expect(await suiteEntryOf(bare.root, 'unit', { commit: bare.commit })).toMatchObject({ name: 'suite-v1/unit' });
  });
});

describe('the frame both entries share', () => {
  it('refuses bytes whose length disagrees with the header, rather than reading a part short', () => {
    const framed = frame([['a', new Uint8Array([1, 2, 3])]]);

    expect(unframe(framed.subarray(0, framed.byteLength - 1))).toBe('the entry is shorter than its header says, at a');
    expect(unframe(new Uint8Array([...framed, 9]))).toBe('the entry is longer than its header says');
    expect(unframe(new Uint8Array([1, 2]))).toBe('the entry has no header line');
  });

  it('hands each part back at the start of its own buffer, wherever the header left it', () => {
    const parts = unframe(frame([['odd', new Uint8Array([1])], ['words', new Uint8Array(8)]]));
    if (typeof parts === 'string') throw new Error(parts);

    expect(parts.get('words')?.byteOffset).toBe(0);
    expect(new Uint32Array(parts.get('words')!.buffer)).toHaveLength(2);
  });
});
