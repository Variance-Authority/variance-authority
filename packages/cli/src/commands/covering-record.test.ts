import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeExecutionIndex, testCoverageFile, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { updateSourceIndex } from '@variance-authority/sense';
import { INSTRUMENTATION_ID } from '@variance-authority/sense/instrument';
import { digestString } from '@variance-authority/core/format';
import { main } from '../bin.js';

/**
 * Every `covering` answer about a file says how fresh it is for the question:
 * whether the asked text is the one the suite ran over, and when the record's
 * commit was committed. Commits since the record are not counted, since a
 * commit touching other code says nothing about this file.
 */

let cache: string;
let previous: string | undefined;
const made: string[] = [];

beforeAll(async () => {
  cache = await mkdtemp(join(tmpdir(), 'variance-covering-record-cache-'));
  previous = process.env['VARIANCE_AUTHORITY_CACHE'];
  process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
});

afterAll(async () => {
  if (previous === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = previous;
  await Promise.all([cache, ...made].map((dir) => rm(dir, { recursive: true, force: true })));
});

const PAY = 'export function pay(amount: number): number {\n  if (amount < 0) {\n    return 0;\n  }\n  return amount;\n}\n';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const INDEX = {
  tests: [{ id: 'p', file: 'src/pay.test.ts', name: 'charges once' }],
  modules: [{
    file: 'src/pay.ts',
    blocks: [
      { kind: 'function', name: 'pay', path: 'entry', startLine: 1, endLine: 6, source: true, crossings: [{ test: 0, distance: 0 }] },
      { kind: 'branch', name: 'pay', path: 'if#0/then', startLine: 2, endLine: 4, source: true, crossings: [] },
    ],
  }],
};

interface Fixture {
  /** When the record's commit was committed, in ms; three days and an hour ago unless given. */
  readonly committed?: number;
  /** The commit the record names instead of the one it was made at; `null` for none. */
  readonly recordedAt?: string | null;
  /** The text whose digest the record holds for `src/pay.ts`, when not the committed one. */
  readonly ranOver?: string;
  /** Commits after the record's, each touching only `src/other.ts`. */
  readonly later?: number;
  /** Whether the record holds an instrumented row, so a digest, for `src/pay.ts`. */
  readonly instrumented?: boolean;
}

/** A checkout whose `unit` record ran `src/pay.ts` at its first commit. */
async function checkout(options: Fixture = {}): Promise<{ readonly at: string; readonly commit: string | undefined }> {
  const at = await mkdtemp(join(tmpdir(), 'variance-covering-record-'));
  made.push(at);
  const date = (ms: number) => `@${String(Math.floor(ms / 1000))} +0000`;
  const git = (args: readonly string[], when?: number) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd: at,
      encoding: 'utf8',
      ...(when === undefined ? {} : { env: { ...process.env, GIT_COMMITTER_DATE: date(when), GIT_AUTHOR_DATE: date(when) } }),
    }).trim();
  const write = async (file: string, text: string) => {
    await mkdir(dirname(join(at, file)), { recursive: true });
    await writeFile(join(at, file), text);
  };
  git(['init', '--quiet', '--initial-branch', 'main']);
  await write('package.json', '{"name":"covering-record-fixture","private":true}\n');
  await write('variance.config.json', JSON.stringify({ suites: { unit: { kind: 'unit' } } }));
  await write('src/pay.ts', PAY);
  await write('src/pay.test.ts', "import { pay } from './pay';\nexport const paid = pay(1);\n");
  git(['add', '.']);
  git(['commit', '--quiet', '-m', 'pay'], options.committed ?? Date.now() - (3 * DAY + HOUR));
  const commit = options.recordedAt === null ? undefined : options.recordedAt ?? git(['rev-parse', 'HEAD']);
  for (let one = 0; one < (options.later ?? 0); one += 1) {
    await write('src/other.ts', `export const other = ${String(one)};\n`);
    git(['add', '.']);
    git(['commit', '--quiet', '-m', `other ${String(one)}`]);
  }

  // Under CI nothing builds the source index implicitly; the fixture publishes it, as the pipeline's `variance index` step does.
  await updateSourceIndex(at);

  const file = testCoverageFile(at, { suite: 'unit' });
  await mkdir(dirname(file), { recursive: true });
  const pay = {
    file: 'src/pay.ts',
    sourceDigest: digestString(options.ranOver ?? PAY),
    instrumented: options.instrumented ?? true,
    // A module has regions exactly when the build instrumented it.
    blocks: options.instrumented === false ? [] : [{
      ordinal: 0, kind: 'module' as const, digest: digestString('module src/pay.ts'), name: 'src/pay.ts', path: 'module',
      startLine: 1, endLine: 6, source: true, testFiles: ['src/pay.test.ts'],
    }],
  };
  await writeTestCoverage(file, {
    version: 3,
    instrumentation: INSTRUMENTATION_ID,
    ...(commit === undefined ? {} : { commit }),
    tests: [{ file: 'src/pay.test.ts', complete: true, preconditions: [] }],
    modules: [pay],
  }, {
    index: encodeExecutionIndex(INDEX as Parameters<typeof encodeExecutionIndex>[0]),
  });
  return { at, commit };
}

async function ask(root: string, ...argv: string[]): Promise<{ readonly text: string; readonly json: Record<string, unknown> }> {
  const run = async (format: string[]) => {
    let out = '';
    let err = '';
    await main(['covering', '--root', root, ...argv, ...format], { out: (text) => (out += text), err: (text) => (err += text) });
    return out + err;
  };
  const raw = await run(['--format', 'json']);
  if (!raw.startsWith('{')) throw new Error(raw);
  const said = JSON.parse(raw) as { readonly suites?: readonly Record<string, unknown>[] } & Record<string, unknown>;
  return { text: await run([]), json: said.suites?.[0] ?? said };
}

const sha = (commit: string | undefined) => commit!.slice(0, 12);

describe('a covering answer says whether the asked text is the one the suite ran over, and when its record was committed', () => {
  it('dates the record of a file by its commit, and counts no commits', async () => {
    const { at, commit } = await checkout();
    const { text, json } = await ask(at, '--file', 'src/pay.ts');

    expect(json).toMatchObject({ at: commit, frame: 'recorded' });
    expect(json['committedAt']).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z$/u);
    expect(Date.parse(json['committedAt'] as string)).toBeLessThan(Date.now() - 3 * DAY);
    expect(json).not.toHaveProperty('behind');
    expect(json).not.toHaveProperty('ahead');
    expect(text).toContain(`src/pay.ts is the text the suite ran over at ${sha(commit)}, committed 3 days ago.\n`);
    expect(text).not.toContain('commit(s)');
  });

  it('dates the answer about a line and a function the same way, and frames the function', async () => {
    const { at, commit } = await checkout();
    const line = await ask(at, '--file', 'src/pay.ts', '--line', '1');
    const named = await ask(at, '--file', 'src/pay.ts', '--function', 'pay');

    expect(line.json).toMatchObject({ at: commit, frame: 'recorded' });
    expect(line.json['committedAt']).toBe(named.json['committedAt']);
    expect(named.json).toMatchObject({ at: commit, frame: 'recorded', unrun: [{ kind: 'branch', startLine: 2, endLine: 4 }] });
    expect(line.text).toContain(`src/pay.ts is the text the suite ran over at ${sha(commit)}, committed 3 days ago.\n`);
    expect(named.text).toContain(`src/pay.ts is the text the suite ran over at ${sha(commit)}, committed 3 days ago.\n`);
  });

  it('says the same of a record commits to other files have passed', async () => {
    const { at, commit } = await checkout({ later: 5 });
    const { text, json } = await ask(at, '--file', 'src/pay.ts');

    expect(json).toMatchObject({ at: commit, frame: 'recorded' });
    expect(json).not.toHaveProperty('behind');
    expect(json).not.toHaveProperty('ahead');
    expect(text).toContain(`src/pay.ts is the text the suite ran over at ${sha(commit)}, committed 3 days ago.\n`);
  });

  it('says once that an edited file\'s lines are placed in the text as it is now', async () => {
    const { at, commit } = await checkout();
    await writeFile(join(at, 'src/pay.ts'), `// fees are charged by the caller\n${PAY}`);
    const { text, json } = await ask(at, '--file', 'src/pay.ts');

    expect(json).toMatchObject({ at: commit, frame: 'mapped' });
    expect(text).toContain(`src/pay.ts differs from the text the suite ran over at ${sha(commit)}, committed 3 days ago; its lines are placed in the text as it is now.\n`);
    expect(text).not.toContain(', placed in the text as it is now');
  });

  it('dates a record whose text could not be found', async () => {
    const { at, commit } = await checkout({ ranOver: `// never committed\n${PAY}` });
    const { text, json } = await ask(at, '--file', 'src/pay.ts');

    expect(json).toMatchObject({ at: commit, frame: 'stale' });
    expect(text).toContain(`src/pay.ts is not the text the suite ran over at ${sha(commit)}, committed 3 days ago, and that text could not be found, so no recorded line is a place in it.\n`);
  });

  it('frames a function in a file whose recorded text could not be found, lists its cases and says no part of it is placed', async () => {
    const { at, commit } = await checkout({ ranOver: `// never committed\n${PAY}` });
    const { text, json } = await ask(at, '--file', 'src/pay.ts', '--function', 'pay');

    expect(json).toMatchObject({ at: commit, frame: 'stale', target: { function: 'pay' }, tests: [{ id: 'p' }] });
    expect(json).not.toHaveProperty('unrun');
    expect(text).toContain('charges once [p]\n');
    expect(text).toContain(`src/pay.ts is not the text the suite ran over at ${sha(commit)}, committed 3 days ago, and that text could not be found, so no recorded line is a place in it. Which parts of \`pay\` no case ran is not said for that reason.\n`);
  });

  it('names a commit this clone does not hold, and gives it no time', async () => {
    const foreign = 'f'.repeat(40);
    const { at } = await checkout({ recordedAt: foreign });
    const { text, json } = await ask(at, '--file', 'src/pay.ts');

    expect(json).toMatchObject({ at: foreign, frame: 'recorded' });
    expect(json).not.toHaveProperty('committedAt');
    expect(text).toContain('src/pay.ts is the text the suite ran over at ffffffffffff, which this clone does not hold.\n');
  });

  it('says a record that names no commit has no age', async () => {
    const { at } = await checkout({ recordedAt: null });
    const { text, json } = await ask(at, '--file', 'src/pay.ts');

    expect(json).toMatchObject({ frame: 'recorded' });
    expect(json).not.toHaveProperty('at');
    expect(json).not.toHaveProperty('committedAt');
    expect(text).toContain('src/pay.ts is the text the suite ran over; the record names no commit, so its age is not known.\n');
  });

  it('gives the commit time itself when the commit is later than this machine\'s clock', async () => {
    const committed = Date.now() + 2 * DAY;
    const { at, commit } = await checkout({ committed });
    const { text, json } = await ask(at, '--file', 'src/pay.ts');
    const iso = new Date(Math.floor(committed / 1000) * 1000).toISOString();

    expect(json).toMatchObject({ at: commit, committedAt: iso });
    expect(text).toContain(`src/pay.ts is the text the suite ran over at ${sha(commit)}, committed ${iso}, later than this machine's clock.\n`);
  });

  it('says whether the text is the one the suite ran over is not known when the record holds no digest of it', async () => {
    const { at, commit } = await checkout({ instrumented: false });
    const { text, json } = await ask(at, '--file', 'src/pay.ts');

    expect(json).toMatchObject({ at: commit });
    expect(json).not.toHaveProperty('frame');
    expect(text).toContain(`The record holds no digest of src/pay.ts, so whether it is the text the suite ran over at ${sha(commit)}, committed 3 days ago, is not known.\n`);
  });

  it('says a journey handed in by path holds no digest and names no commit', async () => {
    const { at } = await checkout();
    const journey = join(at, 'journey.json');
    await writeFile(journey, JSON.stringify(INDEX));
    const { text, json } = await ask(at, '--file', 'src/pay.ts', '--execution', journey);

    expect(json).not.toHaveProperty('frame');
    expect(json).not.toHaveProperty('at');
    expect(text).toContain('The record holds no digest of src/pay.ts, so whether it is the text the suite ran over is not known; the record names no commit, so its age is not known.\n');
  });

  it('says the record\'s lines are its own when the file is not on disk', async () => {
    const { at, commit } = await checkout();
    await rm(join(at, 'src/pay.ts'));
    const { text, json } = await ask(at, '--file', 'src/pay.ts');

    expect(json).toMatchObject({ at: commit, unheld: true });
    expect(json).not.toHaveProperty('frame');
    expect(text).toContain(`src/pay.ts is not on disk, so no text is held against the one the suite ran over at ${sha(commit)}, committed 3 days ago; its lines are the record's.\n`);
  });

  it('dates the record the review reading was read from', async () => {
    const { at, commit } = await checkout();
    await writeFile(join(at, 'src/pay.ts'), PAY.replace('return 0;', 'return -0;'));
    // `--since` reads its diff in the working directory, which is the checkout the record is of.
    const cwd = process.cwd();
    process.chdir(at);
    const { text, json } = await ask(at, '--since', 'HEAD').finally(() => process.chdir(cwd));

    expect(json).toMatchObject({ at: commit });
    expect(json['committedAt']).toMatch(/Z$/u);
    expect(text).toContain(`Read from ${String(json['from'])}, recorded at ${commit!}, committed 3 days ago.\n`);
  });
});
