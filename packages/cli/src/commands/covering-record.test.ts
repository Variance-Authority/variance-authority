import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { commitRunsFile, encodeExecutionIndex, testCoverageFile, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { updateSourceIndex } from '@variance-authority/sense';
import { INSTRUMENTATION_ID } from '@variance-authority/sense/instrument';
import { digestString } from '@variance-authority/core/format';
import { main } from '../bin.js';

/**
 * Every `covering` answer about a file says how fresh it is for the question:
 * whether the asked text is the one the suite ran over, and where and when the
 * test files it names last ran.
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
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();

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
  /** How the record holds `src/pay.ts`: an instrumented row unless given, `loaded` for a row the build did not instrument, `false` for none. */
  readonly row?: 'loaded' | false;
  /** The text of `src/setup.ts`, committed and loaded by `src/pay.test.ts` without instrumenting it, when given. */
  readonly setup?: string;
  /**
   * A second commit, at `committed` ms, that the record names: it writes `pay`
   * to `src/pay.ts` when given, and `src/other.ts` otherwise.
   */
  readonly second?: { readonly committed: number; readonly pay?: string };
  /** The runs record written beside the snapshot, given the first commit and the record's. */
  readonly runs?: (first: string, recorded: string | undefined) => unknown;
}

/** A checkout whose `unit` record ran `src/pay.ts` at its first commit, or at the second when there is one. */
async function checkout(options: Fixture = {}): Promise<{ readonly at: string; readonly commit: string | undefined; readonly first: string }> {
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
  if (options.setup !== undefined) await write('src/setup.ts', options.setup);
  git(['add', '.']);
  git(['commit', '--quiet', '-m', 'pay'], options.committed ?? Date.now() - (3 * DAY + HOUR));
  const first = git(['rev-parse', 'HEAD']);
  if (options.second !== undefined) {
    await (options.second.pay === undefined ? write('src/other.ts', 'export const other = 1;\n') : write('src/pay.ts', options.second.pay));
    git(['add', '.']);
    git(['commit', '--quiet', '-m', 'second'], options.second.committed);
  }
  const commit = options.recordedAt === null ? undefined : options.recordedAt ?? git(['rev-parse', 'HEAD']);

  // Under CI nothing builds the source index implicitly; the fixture publishes it, as the pipeline's `variance index` step does.
  await updateSourceIndex(at);

  const file = testCoverageFile(at, { suite: 'unit' });
  await mkdir(dirname(file), { recursive: true });
  const pay = {
    file: 'src/pay.ts',
    sourceDigest: digestString(options.ranOver ?? options.second?.pay ?? PAY),
    instrumented: options.row === undefined,
    // A module has regions exactly when the build instrumented it.
    blocks: options.row !== undefined ? [] : [{
      ordinal: 0, kind: 'module' as const, digest: digestString('module src/pay.ts'), name: 'src/pay.ts', path: 'module',
      startLine: 1, endLine: 6, source: true, testFiles: ['src/pay.test.ts'],
    }],
  };
  await writeTestCoverage(file, {
    version: 3,
    instrumentation: INSTRUMENTATION_ID,
    ...(commit === undefined ? {} : { commit }),
    tests: [{
      file: 'src/pay.test.ts',
      complete: true,
      // A module the run loaded without instrumenting it is a precondition of the test file that loaded it.
      preconditions: options.setup === undefined ? [] : [{ name: 'src/setup.ts', digest: digestString(options.setup) }],
    }],
    modules: [
      ...(options.row === false ? [] : [pay]),
      ...(options.setup === undefined ? [] : [{ file: 'src/setup.ts', sourceDigest: digestString(options.setup), instrumented: false, blocks: [] }]),
    ],
  }, {
    index: encodeExecutionIndex(INDEX as Parameters<typeof encodeExecutionIndex>[0]),
  });
  const runs = options.runs?.(first, commit);
  if (runs !== undefined) await writeFile(commitRunsFile(file), typeof runs === 'string' ? runs : JSON.stringify(runs));
  return { at, commit, first };
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
/** What a record with no runs beside it says of where its tests ran. */
const unplaced = (commit: string | undefined) => `no runs record lies beside the snapshot, so every test is read as though it last ran at ${sha(commit)}`;

describe('a covering answer says whether the asked text is the one the suite ran over', () => {
  it('frames the file, a line and a function, and dates none of them by the record', async () => {
    const { at, commit } = await checkout();
    const file = await ask(at, '--file', 'src/pay.ts');
    const line = await ask(at, '--file', 'src/pay.ts', '--line', '1');
    const named = await ask(at, '--file', 'src/pay.ts', '--function', 'pay');

    expect(file.json).toMatchObject({ at: commit, frame: 'recorded' });
    expect(line.json).toMatchObject({ at: commit, frame: 'recorded' });
    expect(named.json).toMatchObject({ at: commit, frame: 'recorded', unrun: [{ kind: 'branch', startLine: 2, endLine: 4 }] });
    for (const { text, json } of [file, line, named]) {
      expect(json).not.toHaveProperty('committedAt');
      expect(text).toContain('src/pay.ts is the text the suite ran over.\n');
    }
  });

  it('says once that an edited file\'s lines are placed in the text as it is now', async () => {
    const { at, commit } = await checkout();
    await writeFile(join(at, 'src/pay.ts'), `// fees are charged by the caller\n${PAY}`);
    const { text, json } = await ask(at, '--file', 'src/pay.ts');

    expect(json).toMatchObject({ at: commit, frame: 'mapped' });
    expect(text).toContain('src/pay.ts differs from the text the suite ran over; its lines are placed in the text as it is now.\n');
    expect(text).not.toContain(', placed in the text as it is now');
  });

  it('says of an asked function in an edited file whether the edit touched it, and marks each part no case ran that it touched', async () => {
    const { at } = await checkout();
    await writeFile(join(at, 'src/pay.ts'), `// fees are charged by the caller\n${PAY}`);
    const untouched = await ask(at, '--file', 'src/pay.ts', '--function', 'pay');

    expect(untouched.json).toMatchObject({ frame: 'mapped', unrun: [{ kind: 'branch', startLine: 3, endLine: 5 }] });
    expect(untouched.json).not.toHaveProperty('moved');
    expect(untouched.json['unrun']).not.toMatchObject([{ moved: true }]);
    expect(untouched.text).toContain('its lines are placed in the text as it is now. No edit since the recording touched `pay`: its text is the one its cases ran.\n');
    expect(untouched.text).toContain('No case ran a part of it: the branch at lines 3-5.\n');

    await writeFile(join(at, 'src/pay.ts'), PAY.replace('return 0;', 'return -1;'));
    const edited = await ask(at, '--file', 'src/pay.ts', '--function', 'pay');
    let refs = '';
    await main(['covering', '--root', at, '--file', 'src/pay.ts', '--function', 'pay', '--format', 'refs'], { out: (said) => (refs += said), err: () => {} });

    expect(edited.json).toMatchObject({ frame: 'mapped', moved: true, unrun: [{ kind: 'branch', startLine: 2, endLine: 4, moved: true }] });
    expect(edited.text).toContain('its lines are placed in the text as it is now. An edit since the recording touched `pay`: its cases ran another text of it.\n');
    expect(edited.text).toContain('No case ran a part of it: the edited branch at lines 2-4.\n');
    expect(refs).toMatch(/src\/pay\.ts function pay( \w+)? edited: .*; no case ran 2-4 branch( \w+)? edited$/mu);
  });

  it('names the record a file\'s text could not be found for', async () => {
    const { at, commit } = await checkout({ ranOver: `// never committed\n${PAY}` });
    const { text, json } = await ask(at, '--file', 'src/pay.ts');

    expect(json).toMatchObject({ at: commit, frame: 'stale' });
    expect(text).toContain(`src/pay.ts is not the text the suite ran over at ${sha(commit)}, and that text could not be found, so no recorded line is a place in it.\n`);
  });

  it('frames a function in a file whose recorded text could not be found, lists its cases and says no part of it is placed', async () => {
    const { at, commit } = await checkout({ ranOver: `// never committed\n${PAY}` });
    const { text, json } = await ask(at, '--file', 'src/pay.ts', '--function', 'pay');

    expect(json).toMatchObject({ at: commit, frame: 'stale', target: { function: 'pay' }, tests: [{ id: 'p' }] });
    expect(json).not.toHaveProperty('unrun');
    expect(text).toContain('charges once [p]\n');
    expect(text).toContain(`src/pay.ts is not the text the suite ran over at ${sha(commit)}, and that text could not be found, so no recorded line is a place in it. Which parts of \`pay\` no case ran, and whether an edit touched it, are not said for that reason.\n`);
  });

  it('frames the file by the digest of a row the build did not instrument', async () => {
    const { at, commit } = await checkout({ row: 'loaded' });
    const { text, json } = await ask(at, '--file', 'src/pay.ts');

    expect(json).toMatchObject({ at: commit, frame: 'recorded' });
    expect(text).toContain('src/pay.ts is the text the suite ran over.\n');
  });

  it('says whether the text is the one the suite ran over is not known when the record holds no row of it', async () => {
    const { at, commit } = await checkout({ row: false });
    const { text, json } = await ask(at, '--file', 'src/pay.ts');

    expect(json).toMatchObject({ at: commit });
    expect(json).not.toHaveProperty('frame');
    expect(text).toContain('The record holds no digest of src/pay.ts, so whether it is the text the suite ran over is not known.\n');
  });

  it('frames a file the run loaded without instrumenting by the text the test files loading it ran over', async () => {
    const setup = 'export const ready = true;\n';
    const { at } = await checkout({ setup });
    const held = await ask(at, '--file', 'src/setup.ts');
    await writeFile(join(at, 'edited.ts'), `// ready once\n${setup}`);
    const edited = await ask(at, '--file', 'src/setup.ts', '--text', join(at, 'edited.ts'));
    await rm(join(at, 'src/setup.ts'));
    const gone = await ask(at, '--file', 'src/setup.ts');

    expect(held.json).toMatchObject({ preconditionOf: ['src/pay.test.ts'], held: 'loaded', frame: 'recorded' });
    expect(held.text).toContain('src/setup.ts is the text the suite ran over.\n');
    expect(edited.json).toMatchObject({ preconditionOf: ['src/pay.test.ts'], frame: 'differs' });
    expect(edited.text).toContain('src/setup.ts differs from the text the suite ran over.\n');
    expect(gone.json).toMatchObject({ preconditionOf: ['src/pay.test.ts'], unheld: true });
    expect(gone.json).not.toHaveProperty('frame');
    expect(gone.text).toContain('src/setup.ts is not on disk, so no text is held against the one the suite ran over.\n');
  });

  it('says a journey handed in by path holds no digest and names no commit', async () => {
    const { at } = await checkout();
    const journey = join(at, 'journey.json');
    await writeFile(journey, JSON.stringify(INDEX));
    const { text, json } = await ask(at, '--file', 'src/pay.ts', '--execution', journey);

    expect(json).not.toHaveProperty('frame');
    expect(json).not.toHaveProperty('at');
    expect(text).toContain('The record holds no digest of src/pay.ts, so whether it is the text the suite ran over is not known.\n');
    expect(text).toContain('Where and when the test file named here last ran is not known: the record names no commit.\n');
  });

  it('says the record\'s lines are its own when the file is not on disk', async () => {
    const { at, commit } = await checkout();
    await rm(join(at, 'src/pay.ts'));
    const { text, json } = await ask(at, '--file', 'src/pay.ts');

    expect(json).toMatchObject({ at: commit, unheld: true });
    expect(json).not.toHaveProperty('frame');
    expect(text).toContain('src/pay.ts is not on disk, so no text is held against the one the suite ran over; its lines are the record\'s.\n');
  });
});

describe('a covering answer says where and when the test files it names last ran', () => {
  it('dates the answer by where its test file last ran, not by the commit a later partial run stamped the record with', async () => {
    const now = Date.now();
    const { at, commit, first } = await checkout({
      committed: now - (9 * HOUR + 30 * MINUTE),
      second: { committed: now - (6 * MINUTE + 30_000) },
      runs: (base, recorded) => ({
        commit: recorded, over: base, first: iso(now - 6 * MINUTE), latest: iso(now - 6 * MINUTE), runs: 1,
        files: ['src/other.test.ts'], standing: [{ commit: base, files: ['src/pay.test.ts'] }],
      }),
    });
    const { text, json } = await ask(at, '--file', 'src/pay.ts');

    expect(json).toMatchObject({ at: commit, frame: 'recorded', ran: { stands: [{ commit: first, tests: ['src/pay.test.ts'] }] } });
    expect(json['ran']).not.toHaveProperty('assumed');
    expect(text).toContain(`The test file named here last ran at ${sha(first)}, a commit made 9 hours ago.\n`);
    expect(text).not.toContain('minute');
  });

  it('says the test file ran over another text of the asked file when it changed after that run', async () => {
    const now = Date.now();
    const edited = `// fees are charged by the caller\n${PAY}`;
    const { at, commit, first } = await checkout({
      committed: now - (9 * HOUR + 30 * MINUTE),
      second: { committed: now - (6 * MINUTE + 30_000), pay: edited },
      runs: (base, recorded) => ({
        commit: recorded, over: base, first: iso(now - 6 * MINUTE), latest: iso(now - 6 * MINUTE), runs: 1,
        files: ['src/other.test.ts'], standing: [{ commit: base, files: ['src/pay.test.ts'] }],
      }),
    });
    const { text, json } = await ask(at, '--file', 'src/pay.ts');

    expect(json).toMatchObject({ at: commit, frame: 'recorded', ran: { stands: [{ commit: first, otherText: ['src/pay.ts'] }] } });
    expect(text).toContain(
      `The test file named here last ran at ${sha(first)}, a commit made 9 hours ago, over another text of src/pay.ts, which changed between that commit and ${sha(commit)}.\n`,
    );
  });

  it('gives the time the runs at the record\'s commit landed, for a test file they ran', async () => {
    const now = Date.now();
    const { at, commit } = await checkout({
      runs: (_, recorded) => ({ commit: recorded, first: iso(now - (3 * HOUR + MINUTE)), latest: iso(now - (6 * MINUTE + 30_000)), runs: 2, files: ['src/pay.test.ts'] }),
    });
    const { text, json } = await ask(at, '--file', 'src/pay.ts', '--function', 'pay');

    expect(json).toMatchObject({ ran: { stands: [{ commit, landed: { runs: 2 } }] } });
    expect(text).toContain(`The test file named here last ran at ${sha(commit)}, in one of the 2 runs at it, which landed between 3 hours ago and 6 minutes ago.\n`);
  });

  it('dates a test file the runs at the record\'s commit did not observe by the commit, and says so', async () => {
    const now = Date.now();
    const { at, commit } = await checkout({
      runs: (_, recorded) => ({ commit: recorded, first: iso(now - 6 * MINUTE), latest: iso(now - 6 * MINUTE), runs: 1, files: ['src/other.test.ts'] }),
    });
    const { text, json } = await ask(at, '--file', 'src/pay.ts');

    expect(json).toMatchObject({ ran: { stands: [{ commit }] } });
    expect(text).toContain(
      `The test file named here last ran at ${sha(commit)}, a commit made 3 days ago; the runs record beside the snapshot does not say where 1 test(s) last ran, so they are read from ${sha(commit)}, where the snapshot was recorded.\n`,
    );
  });

  it('says where the test file was read as running when no runs record lies beside the snapshot', async () => {
    const { at, commit } = await checkout();
    const { text, json } = await ask(at, '--file', 'src/pay.ts');

    expect(json).toMatchObject({ ran: { stands: [{ commit, tests: ['src/pay.test.ts'] }], assumed: unplaced(commit) } });
    expect(text).toContain(`The test file named here last ran at ${sha(commit)}, a commit made 3 days ago; ${unplaced(commit)}.\n`);
  });

  it('names a commit this clone does not hold, and gives it no time', async () => {
    const foreign = 'f'.repeat(40);
    const { at } = await checkout({ recordedAt: foreign });
    const { text, json } = await ask(at, '--file', 'src/pay.ts');

    expect(json).toMatchObject({ at: foreign, frame: 'recorded', ran: { stands: [{ commit: foreign, held: false }] } });
    expect(text).toContain(`The test file named here last ran at ffffffffffff, a commit this clone does not hold; ${unplaced(foreign)}.\n`);
  });

  it('says where and when the test file last ran is not known when the record names no commit', async () => {
    const { at } = await checkout({ recordedAt: null });
    const { text, json } = await ask(at, '--file', 'src/pay.ts');

    expect(json).toMatchObject({ frame: 'recorded', ran: { tests: ['src/pay.test.ts'], unread: 'the record names no commit' } });
    expect(json).not.toHaveProperty('at');
    expect(text).toContain('Where and when the test file named here last ran is not known: the record names no commit.\n');
  });

  it('says why when the runs record beside the snapshot cannot be read', async () => {
    const { at } = await checkout({ runs: () => 'not json' });
    const { text } = await ask(at, '--file', 'src/pay.ts');

    expect(text).toContain(`Where and when the test file named here last ran is not known: the runs record at ${commitRunsFile(testCoverageFile(at, { suite: 'unit' }))} is not JSON`);
  });

  it('gives the commit time itself when the commit is later than this machine\'s clock', async () => {
    const committed = Date.now() + 2 * DAY;
    const { at, commit } = await checkout({ committed });
    const { text } = await ask(at, '--file', 'src/pay.ts');

    expect(text).toContain(`last ran at ${sha(commit)}, a commit made at ${iso(Math.floor(committed / 1000) * 1000)}, later than this machine's clock;`);
  });

  it('dates the review reading by where the test files of its regions last ran', async () => {
    const { at, commit } = await checkout();
    await writeFile(join(at, 'src/pay.ts'), PAY.replace('return amount;', 'return amount + 0;'));
    // `--since` reads its diff in the working directory, which is the checkout the record is of.
    const cwd = process.cwd();
    process.chdir(at);
    const { text, json } = await ask(at, '--since', 'HEAD').finally(() => process.chdir(cwd));

    expect(json).toMatchObject({ at: commit, ran: { stands: [{ commit }] } });
    expect(json).not.toHaveProperty('committedAt');
    expect(text).toContain(`Read from ${String(json['from'])}, recorded at ${commit!}.\n`);
    expect(text).toContain(`The test file named here last ran at ${sha(commit)}, a commit made 3 days ago; ${unplaced(commit)}.\n`);
  });

  it('says in the review reading\'s heading that the record names no commit', async () => {
    const { at } = await checkout({ recordedAt: null });
    await writeFile(join(at, 'src/pay.ts'), PAY.replace('return amount;', 'return amount + 0;'));
    const cwd = process.cwd();
    process.chdir(at);
    const { text, json } = await ask(at, '--since', 'HEAD').finally(() => process.chdir(cwd));

    expect(json).not.toHaveProperty('at');
    expect(text).toContain(`Read from ${String(json['from'])}; the record names no commit.\n`);
  });
});
