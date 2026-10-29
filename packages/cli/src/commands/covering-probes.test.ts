import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INSTRUMENTATION_ID } from '@variance-authority/sense/instrument';
import {
  cacheRootFor,
  encodeExecutionIndex,
  mainlineReadRoot,
  sourceCut,
  testCoverageFile,
  writeFetchedMainline,
  writeTestCoverage,
} from '@variance-authority/sense/test-selection';
import { main } from '../bin.js';
import { readFlags } from '../args.js';
import { parseCoveringArgs } from '../covering-args.js';
import { OperatorError } from '../exit.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { covering, formatCovering } from './covering.js';
import { changed } from './review-fixture.js';
import { indexPosition } from './since.js';

function parse(argv: readonly string[]) {
  return parseCoveringArgs(readFlags(argv, 'covering', flagsFor('covering'), synopsisFor('covering')));
}

/** Probes this build does not place: any identity but its own, whatever it is called. */
const RETIRED = 'sense:instrument/presence-v5';

const TESTS = ['a.test.ts', 'b.test.ts', 'c.test.ts'];

const TOTAL = 'export function total() {\n  return 1;\n}\n';

/**
 * No sentence of a note may send the reader to run or record a suite: a whole run is often impossible where the question is asked.
 * A perfect "have run it" says what ran, not what to do, so it is not one.
 */
const NO_RUN = /(?<!\bhave )\b(run|re-run|rerun|record) (the|it|this|that|again)\b|withTestSelection/i;

type Block = {
  readonly kind: string;
  readonly name: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly source?: boolean;
};

/** The regions this build cuts in {@link TOTAL}, at the lines it cuts them, as a record holds them. */
function cutHere(): Block[] {
  return sourceCut(TOTAL, 'src/total.ts', 'presence')!.rows.map((row) => ({
    kind: row.kind,
    name: row.name,
    path: row.path,
    startLine: row.startLine ?? 1,
    endLine: row.endLine ?? 1,
    source: row.source,
  }));
}

/** A record of one case per test file, cut under `instrumentation`, at `commit` when given, holding `blocks` of `src/total.ts`. */
async function recorded(
  instrumentation: string,
  options: { readonly at?: string; readonly commit?: string; readonly blocks?: readonly Block[] } = {},
): Promise<string> {
  const file = options.at ?? join(await mkdtemp(join(tmpdir(), 'variance-covering-probes-')), 'coverage.bin');
  const blocks = options.blocks ?? [{ kind: 'function', name: 'total', path: 'entry', startLine: 1, endLine: 3 }];
  await mkdir(join(file, '..'), { recursive: true });
  await writeTestCoverage(file, {
    version: 3,
    instrumentation,
    ...(options.commit === undefined ? {} : { commit: options.commit }),
    tests: TESTS.map((test) => ({ file: test, complete: true, preconditions: [] })),
    modules: [],
  }, {
    index: encodeExecutionIndex({
      tests: TESTS.map((test) => ({ id: `${test} > runs`, file: test, name: 'runs' })),
      modules: [{
        file: 'src/total.ts',
        blocks: blocks.map((block) => ({ source: true, ...block, crossings: [{ test: 0, distance: 1 }] })),
      }],
    }),
  });
  return file;
}

/** A checkout holding {@link TOTAL} at one commit, declaring `suites` when given. */
async function checkout(suites?: Record<string, object>): Promise<{ root: string; head: string }> {
  // The real path, as git names the top level: the cache a record is kept in is keyed by it.
  const root = await realpath(await mkdtemp(join(tmpdir(), 'variance-covering-probes-root-')));
  const git = (args: readonly string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src/total.ts'), TOTAL);
  if (suites !== undefined) await writeFile(join(root, 'variance.config.json'), JSON.stringify({ suites }));
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'first']);
  return { root, head: git(['rev-parse', 'HEAD']) };
}

describe('a record cut under probes this build does not place', () => {
  it('answers which cases ran the file, and names both probes and the question the difference leaves open', async () => {
    const execution = await recorded(RETIRED);

    const answer = await covering(parse(['--file', 'src/total.ts', '--execution', execution]));

    expect(answer.ranges?.map((range) => range.tests.map((test) => test.id))).toEqual([['a.test.ts > runs']]);
    expect(answer.probes).toMatchObject({ record: execution, recordedUnder: RETIRED, places: INSTRUMENTATION_ID });
    expect(answer.probes?.note).toContain(`was cut under the probes \`${RETIRED}\`, and this build places \`${INSTRUMENTATION_ID}\``);
    expect(answer.probes?.note).toContain('names no commit, so the text it was made over is not known');
    expect(answer.probes?.note).not.toMatch(NO_RUN);
    expect(formatCovering(answer, 'text', Date.now()).split('\n')[0]).toBe(answer.probes?.note);
  });

  it('says nothing of probes for a record this build cut', async () => {
    const answer = await covering(parse(['--file', 'src/total.ts', '--execution', await recorded(INSTRUMENTATION_ID)]));

    expect(answer.probes).toBeUndefined();
  });

  it('says this build cuts a file as the record does, and that what a hit means is not compared', async () => {
    const { root, head } = await checkout();
    const execution = await recorded(RETIRED, { commit: head, blocks: cutHere() });

    const answer = await covering(parse(['--file', 'src/total.ts', '--root', root, '--execution', execution]));

    expect(answer.probes?.cut).toEqual({ file: 'src/total.ts', same: 2 });
    expect(answer.probes?.note).toContain('in src/total.ts this build\'s presence walk cuts the same 2 regions, at the same lines, that the record holds; whether a hit means the same under both probes is not compared');
  });

  it('names the region this build cuts in a file that the record has none for', async () => {
    const { root, head } = await checkout();
    const execution = await recorded(RETIRED, { commit: head, blocks: cutHere().filter((block) => block.kind !== 'function') });

    const answer = await covering(parse(['--file', 'src/total.ts', '--root', root, '--execution', execution]));

    expect(answer.probes?.cut).toEqual({ file: 'src/total.ts', unrecorded: ['function `total` on lines 1-3'], uncut: [] });
    expect(answer.probes?.note).toContain('this build\'s presence walk cuts function `total` on lines 1-3 in src/total.ts, which the record has no region for, so whether it ran is not answered');
  });

  it('does not call a region the same when this build cuts it over other lines', async () => {
    const { root, head } = await checkout();
    const moved = cutHere().map((block) => (block.kind === 'function' ? { ...block, startLine: block.startLine + 1 } : block));
    const execution = await recorded(RETIRED, { commit: head, blocks: moved });

    const answer = await covering(parse(['--file', 'src/total.ts', '--root', root, '--execution', execution]));

    expect(answer.probes?.cut).not.toHaveProperty('same');
    expect(answer.probes?.note).toContain('which the record has no region for');
    expect(answer.probes?.note).toContain('which this build does not cut');
  });

  it('reads the suite into a handover, with the note beside it', async () => {
    const { root, first } = await changed({ suites: ['unit'], instrumentation: RETIRED });
    let out = '';
    const code = await main(['review', '--since', first, '--root', root, '--format', 'handover'], { out: (text) => (out += text), err: () => {} });

    expect(code).toBe(0);
    expect(out).toContain(`\`unit\`: \``);
    expect(out).toContain(`was cut under the probes \`${RETIRED}\``);
    expect(out).toContain('Read from the runs of `unit`');
    expect(out).not.toMatch(NO_RUN);
  });

  it.each(['text', 'markdown'])('puts the note beside the review in %s', async (format) => {
    const { root, first } = await changed({ instrumentation: RETIRED });
    let out = '';
    const code = await main(['review', '--since', first, '--root', root, '--format', format], { out: (text) => (out += text), err: () => {} });

    expect(code).toBe(0);
    expect(out).toContain(`was cut under the probes \`${RETIRED}\`, and this build places \`${INSTRUMENTATION_ID}\``);
    expect(out).not.toMatch(NO_RUN);
  });

  // The test cache is one per run and keeps a fetched pointer per suite, so this suite's name is its own.
  it('names where a current mainline record is on this machine, and how to read it', async () => {
    const { root, head } = await checkout({ fetched: { kind: 'unit', carry: 'share' } });
    await recorded(RETIRED, { at: testCoverageFile(root, { suite: 'fetched' }), commit: head });
    const cache = cacheRootFor(root);
    const published = join(mainlineReadRoot(cache, 'fetched'), head, 'coverage.bin');
    await recorded(INSTRUMENTATION_ID, { at: published, commit: head });
    await writeFetchedMainline(cache, 'fetched', { mainline: 'main', commit: head, fetched: new Date().toISOString() });

    const answer = await covering(parse(['--file', 'src/total.ts', '--root', root, '--suite', 'fetched']));

    expect(answer.probes?.current).toEqual({ commit: head, coverage: published });
    expect(answer.probes?.note).toContain(
      `The mainline's record published at ${head} is cut under this build's probes and is on this machine at \`${published}\`, ` +
        "beneath this checkout's own, which is read first; `--execution` with that path reads it.",
    );
    expect(answer.probes?.note).not.toMatch(NO_RUN);
  });

  it('names the gap and stops when no current record is known', async () => {
    const { root, head } = await checkout({ unit: { kind: 'unit', carry: 'share' } });
    await recorded(RETIRED, { at: testCoverageFile(root, { suite: 'unit' }), commit: head });

    const answer = await covering(parse(['--file', 'src/total.ts', '--root', root, '--suite', 'unit']));

    expect(answer.probes?.current).toBeUndefined();
    expect(answer.probes?.note).toMatch(/is not (answered|compared)[^.]*\.$/);
    expect(answer.probes?.note).not.toContain('mainline');
    expect(answer.probes?.note).not.toMatch(NO_RUN);
  });

  it('names the gap beside a refusal that the record holds nothing of the file, and keeps its kind', async () => {
    const execution = await recorded(RETIRED);

    const refusal = await covering(parse(['--file', 'src/other.ts', '--execution', execution])).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(OperatorError);
    expect((refusal as OperatorError).kind).toBe('unloaded');
    expect((refusal as OperatorError).message).toMatch(new RegExp(`was cut under the probes \`${RETIRED}\`.*\\.$`));
    expect((refusal as OperatorError).message).toContain('whether this build cuts src/other.ts as the record does is not answered: the record holds no region of it');
    expect((refusal as OperatorError).message).not.toContain('variance covering --file');
  });

  it('says nothing of probes beside a refusal the probes do not bear on', async () => {
    const execution = await recorded(RETIRED);

    const refusal = await covering(parse(['--file', 'src/total.ts', '--execution', execution, '--function', 'nowhere'])).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(OperatorError);
    expect((refusal as OperatorError).message).toContain('`nowhere` is not a recorded function or scope of `src/total.ts`');
    expect((refusal as OperatorError).message).not.toContain('was cut under the probes');
  });

  it('still gives `since` the commit it was recorded at, which the probes do not move', async () => {
    const { root, head } = await checkout();
    await recorded(RETIRED, { at: testCoverageFile(root), commit: head });

    expect(await indexPosition(root)).toEqual({ commit: head, changed: 0 });
  });
});

describe('a suite nothing is recorded for in this checkout', () => {
  it('says no case can be named, and names no run', async () => {
    const { root } = await checkout({ site: { kind: 'e2e' } });

    const refusal = await covering(parse(['--file', 'src/total.ts', '--root', root, '--suite', 'site'])).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(OperatorError);
    expect((refusal as OperatorError).kind).toBe('unrecorded');
    expect((refusal as OperatorError).message).toMatch(/, so no case can be named\.$/);
    expect((refusal as OperatorError).message).not.toMatch(NO_RUN);
  });

  it('names the fetch for a suite the share carries', async () => {
    const { root } = await checkout({ site: { kind: 'e2e', carry: 'share' } });

    await expect(covering(parse(['--file', 'src/total.ts', '--root', root, '--suite', 'site']))).rejects.toThrow(
      "so no case can be named. `variance share --suite site` fetches the mainline's record of it.",
    );
  });
});
