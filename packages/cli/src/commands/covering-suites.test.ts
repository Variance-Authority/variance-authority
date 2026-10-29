import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeExecutionIndex, testCoverageFile, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { updateSourceIndex } from '@variance-authority/sense';
import { main } from '../bin.js';
import { formatCoveringAnswer } from './covering-suites.js';
import { INSTRUMENTATION_ID } from '@variance-authority/sense/instrument';

const SUITES = {
  suites: { unit: { kind: 'unit' }, stories: { kind: 'visual' }, checkout: { kind: 'e2e' } },
};

/** One module, entered by whichever case the suite ran. */
function indexOf(file: string, test: { id: string; file: string; name: string }) {
  return {
    tests: [test],
    modules: [{
      file,
      blocks: [{
        kind: 'function', name: 'charge', path: 'entry', startLine: 10, endLine: 20,
        source: true, crossings: [{ test: 0, distance: 1 }],
      }],
    }],
  };
}

/** The one line a suite that never loaded the file costs, once any suite answered. */
const NOT_LOADED = (suites: string) =>
  `Not loaded by ${suites}: a run that never loaded the file has no answer about it, ` +
  'which is not the same as no test covering it.';

let cache: string;
let root: string;
let previous: string | undefined;

// Three suites, three roles: the unit suite loaded the payment module, the
// visual one ran and never loaded it, and the end-to-end one has not run.
beforeAll(async () => {
  cache = await mkdtemp(join(tmpdir(), 'variance-covering-suites-cache-'));
  previous = process.env['VARIANCE_AUTHORITY_CACHE'];
  process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
  root = await mkdtemp(join(tmpdir(), 'variance-covering-suites-'));
  execFileSync('git', ['init', '--quiet', root]);
  await writeFile(join(root, 'variance.config.json'), JSON.stringify(SUITES));
  const record = (suite: string, index: unknown) => recordIn(root, suite, index);
  await record('unit', indexOf('src/pay.ts', { id: 'u', file: 'src/pay.test.ts', name: 'charges once' }));
  await record('stories', indexOf('src/Button.tsx', { id: 's', file: 'src/Button.stories.tsx', name: 'Primary' }));
});

/**
 * Lay one suite's record of a run, as the runner would have left it, made at
 * `commit` when one is given. Every test file of the index ran whole, so
 * selection reads the record as a run it can answer from.
 */
async function recordIn(at: string, suite: string, index: unknown, commit?: string) {
  const file = testCoverageFile(at, { suite });
  await mkdir(dirname(file), { recursive: true });
  const made = commit === undefined ? {} : { commit };
  const files = [...new Set((index as { tests: readonly { file: string }[] }).tests.map((test) => test.file))];
  const tests = files.map((test) => ({ file: test, complete: true, preconditions: [] }));
  await writeTestCoverage(file, { version: 3, instrumentation: INSTRUMENTATION_ID, ...made, tests, modules: [] }, {
    index: encodeExecutionIndex(index as Parameters<typeof encodeExecutionIndex>[0]),
  });
}

afterAll(async () => {
  if (previous === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = previous;
  await rm(cache, { recursive: true, force: true });
});

async function ask(argv: readonly string[]) {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (text) => (out += text), err: (text) => (err += text) });
  return { code, out, err };
}

describe('a file asked of a repository that declares suites', () => {
  it('carries the one mark each run of lines takes, read across the suites that ran it', async () => {
    const answer = await ask(['covering', '--file', 'src/pay.ts', '--root', root, '--format', 'json']);

    expect(answer.code).toBe(0);
    const said = JSON.parse(answer.out) as { marks?: { startLine: number; endLine: number; suites: string[] }[] };
    expect(said.marks?.length).toBeGreaterThan(0);
    expect(said.marks?.every((mark) => mark.suites.join() === 'unit')).toBe(true);
    expect(said.marks?.some((mark) => mark.startLine <= 12 && 12 <= mark.endLine)).toBe(true);
  });

  it('carries no marks under a question about one line', async () => {
    const answer = await ask(['covering', '--file', 'src/pay.ts', '--line', '12', '--root', root, '--format', 'json']);
    expect(JSON.parse(answer.out)).not.toHaveProperty('marks');
  });
});

describe('a line asked of a repository that declares suites', () => {
  it('is answered by every suite, each by its role, with the one that never loaded it and the one that never ran said apart', async () => {
    const answer = await ask(['covering', '--file', 'src/pay.ts', '--line', '12', '--root', root, '--format', 'json']);

    expect(answer.code).toBe(0);
    const said = JSON.parse(answer.out) as { file: string; suites: Record<string, unknown>[] };
    expect(said.file).toBe('src/pay.ts');
    expect(said.suites.map((one) => [one['suite'], one['kind'], one['refused']])).toEqual([
      ['unit', 'unit', undefined],
      ['checkout', 'e2e', 'unrecorded'],
      ['stories', 'visual', 'unloaded'],
    ]);
    expect((said.suites[0]!['tests'] as { id: string }[]).map((test) => test.id)).toEqual(['u']);
  });

  it('asks the nearest kind first, whatever the suites are named, so the unit tests lead the answer', async () => {
    const at = await mkdtemp(join(tmpdir(), 'variance-covering-suites-kinds-'));
    execFileSync('git', ['init', '--quiet', at]);
    await writeFile(join(at, 'variance.config.json'), JSON.stringify({
      suites: { chromium: { kind: 'e2e' }, integration: { kind: 'integration' }, unit: { kind: 'unit' } },
    }));
    for (const suite of ['chromium', 'integration', 'unit']) {
      await recordIn(at, suite, indexOf('src/pay.ts', { id: suite, file: `src/pay.${suite}.test.ts`, name: 'charges once' }));
    }

    const answer = await ask(['covering', '--file', 'src/pay.ts', '--line', '12', '--root', at]);
    await rm(at, { recursive: true, force: true });

    expect(answer.out.match(/^\S.*:$/gmu)).toEqual(['unit (unit):', 'integration (integration):', 'chromium (e2e):']);
  });

  it('prints each suite under its name and kind for a person', async () => {
    const answer = await ask(['covering', '--file', 'src/pay.ts', '--line', '12', '--root', root]);

    expect(answer.out).toContain('unit (unit):\n  1 named test covered line 12 of src/pay.ts');
  });

  it('names the suites that never loaded the file once, after every answer, without their records', async () => {
    const answer = await ask(['covering', '--file', 'src/pay.ts', '--line', '12', '--root', root]);

    expect(answer.out.endsWith(`\n${NOT_LOADED('stories (visual)')}\n`)).toBe(true);
    expect(answer.out.indexOf('unit (unit):')).toBeLessThan(answer.out.indexOf('Not loaded by'));
    expect(answer.out).not.toContain('is not in the index');
    expect(answer.out).not.toContain('/suites/stories/');
  });

  it('names them the same way in the answer for an agent', async () => {
    const answer = await ask(['covering', '--file', 'src/pay.ts', '--line', '12', '--root', root, '--format', 'refs']);

    expect(answer.out.endsWith(`\n${NOT_LOADED('stories (visual)')}\n`)).toBe(true);
    expect(answer.out).not.toContain('is not in the index');
  });

  it('says a suite that has never run after every answer, since it is no answer about the file', async () => {
    const answer = await ask(['covering', '--file', 'src/pay.ts', '--line', '12', '--root', root]);

    expect(answer.out.startsWith('unit (unit):\n')).toBe(true);
    expect(answer.out.indexOf('checkout (e2e): nothing is recorded')).toBeGreaterThan(answer.out.indexOf('unit (unit):'));
    expect(answer.out.indexOf('checkout (e2e): nothing is recorded')).toBeLessThan(answer.out.indexOf('Not loaded by'));
  });

  it('answers a line the only suite holding the file has no region for, and gathers the rest', async () => {
    const answer = await ask(['covering', '--file', 'src/pay.ts', '--line', '3', '--root', root]);

    expect(answer.out.startsWith('unit (unit):\n  No named test covered line 3 of src/pay.ts.\n'
      + '  Line 3 is outside every recorded region, so no case can be said to have run it.\n')).toBe(true);
    expect(answer.out.endsWith(`\n${NOT_LOADED('stories (visual)')}\n`)).toBe(true);
  });

  it('explains every suite in full when none of them loaded the file, since that is the whole answer', async () => {
    const answer = await ask(['covering', '--file', 'src/charge.ts', '--root', root]);

    expect(answer.code).toBe(0);
    expect(answer.out).toMatch(/^stories \(visual\): `src\/charge\.ts` is not in the index at `[^`]+\/suites\/stories\/[^`]+`, which holds 1 file, each named from the repository root\./mu);
    expect(answer.out).toMatch(/^unit \(unit\): `src\/charge\.ts` is not in the index at .* no test covering it\.$/mu);
    expect(answer.out).not.toContain('Not loaded by');
  });

  it('reads one suite alone under `--suite`, in the shape a repository with one record answers', async () => {
    const answer = await ask(['covering', '--file', 'src/pay.ts', '--line', '12', '--suite', 'unit', '--root', root, '--format', 'json']);

    const said = JSON.parse(answer.out) as { suites?: unknown; tests: { id: string }[]; from: string };
    expect(said.suites).toBeUndefined();
    expect(said.tests.map((test) => test.id)).toEqual(['u']);
    expect(said.from).toContain('/suites/unit/');
  });

  it('refuses a suite the root config does not declare, by name', async () => {
    const answer = await ask(['covering', '--file', 'src/pay.ts', '--suite', 'smoke', '--root', root]);

    expect(answer.code).toBe(2);
    expect(answer.err).toContain('the suite "smoke" is not declared in');
  });

  it('refuses `--suite` beside `--execution`, because both name the record', async () => {
    const answer = await ask(['covering', '--file', 'src/pay.ts', '--suite', 'unit', '--execution', 'x.bin']);

    expect(answer.code).toBe(2);
    expect(answer.err).toContain('`--suite` and `--execution` both name the record; pass one');
  });
});

describe('a suite that recorded another path of the same name', () => {
  // Each repository records the payment module's case in the unit suite unless
  // told otherwise, and the visual suite records the path it is given.
  const made: string[] = [];
  async function repository(stories: string, unit = 'src/pay.ts') {
    const at = await mkdtemp(join(tmpdir(), 'variance-covering-suites-rooted-'));
    made.push(at);
    execFileSync('git', ['init', '--quiet', at]);
    await writeFile(join(at, 'variance.config.json'), JSON.stringify(SUITES));
    await recordIn(at, 'unit', indexOf(unit, { id: 'u', file: 'src/pay.test.ts', name: 'charges once' }));
    await recordIn(at, 'stories', indexOf(stories, { id: 's', file: 'src/Pay.stories.tsx', name: 'Paid' }));
    return at;
  }
  afterAll(() => Promise.all(made.map((at) => rm(at, { recursive: true, force: true }))));

  it('is a suite that never loaded the file when it holds a longer path ending in the asked one', async () => {
    const at = await repository('packages/shop/src/pay.ts');
    const answer = await ask(['covering', '--file', 'src/pay.ts', '--line', '12', '--root', at]);

    expect(answer.out.endsWith(`\n${NOT_LOADED('stories (visual)')}\n`)).toBe(true);
    expect(answer.out).not.toContain('packages/shop/src/pay.ts');
  });

  it('carries no other path for a program, beside the refusal', async () => {
    const at = await repository('packages/shop/src/pay.ts');
    const answer = await ask(['covering', '--file', 'src/pay.ts', '--line', '12', '--root', at, '--format', 'json']);

    const said = JSON.parse(answer.out) as { suites: Record<string, unknown>[] };
    expect(Object.keys(said.suites.find((one) => one['suite'] === 'stories') ?? {}).sort()).toEqual(['kind', 'reason', 'refused', 'suite']);
    expect(answer.out).not.toContain('packages/shop/src/pay.ts');
  });

  it('is a suite that tests other code when only the file name matches', async () => {
    const at = await repository('lib/pay.ts');
    const answer = await ask(['covering', '--file', 'src/pay.ts', '--line', '12', '--root', at]);

    expect(answer.out.endsWith(`\n${NOT_LOADED('stories (visual)')}\n`)).toBe(true);
  });

  it('is a suite that never loaded the file when it holds a shorter path the asked one ends in', async () => {
    const at = await repository('src/pay.ts', 'packages/shop/src/pay.ts');
    const answer = await ask(['covering', '--file', 'packages/shop/src/pay.ts', '--line', '12', '--root', at]);

    expect(answer.out.endsWith(`\n${NOT_LOADED('stories (visual)')}\n`)).toBe(true);
  });

  it('is a suite that tests other code when it holds the file name at its root', async () => {
    const at = await repository('pay.ts', 'packages/shop/src/pay.ts');
    const answer = await ask(['covering', '--file', 'packages/shop/src/pay.ts', '--line', '12', '--root', at]);

    expect(answer.out.endsWith(`\n${NOT_LOADED('stories (visual)')}\n`)).toBe(true);
  });

  it('is a suite that tests other code when the asked path is a bare file name', async () => {
    const at = await repository('lib/pay.ts', 'pay.ts');
    const answer = await ask(['covering', '--file', 'pay.ts', '--line', '12', '--root', at]);

    expect(answer.out.endsWith(`\n${NOT_LOADED('stories (visual)')}\n`)).toBe(true);
  });

  it('explains every suite in full when none answered, since a wrong path is then the likely cause', async () => {
    const at = await repository('packages/shop/src/pay.ts', 'src/Button.tsx');
    const answer = await ask(['covering', '--file', 'src/pay.ts', '--line', '12', '--root', at]);

    expect(answer.out).toMatch(/^unit \(unit\): `src\/pay\.ts` is not in the index at .* no test covering it\.$/mu);
    expect(answer.out).not.toContain('Not loaded by');
  });
});

describe('several suites that never loaded the file', () => {
  it('cost one line between them, in the order they were asked', () => {
    const unloaded = (suite: string, kind: 'e2e' | 'visual') =>
      ({ suite, kind, refused: 'unloaded' as const, reason: '`src/pay.ts` is not in the index at `/cache/coverage.bin`.' });
    const said = formatCoveringAnswer({
      file: 'src/pay.ts',
      suites: [
        unloaded('checkout', 'e2e'),
        unloaded('stories', 'visual'),
        { suite: 'unit', kind: 'unit', file: 'src/pay.ts', target: { line: 12 }, tests: [], from: '/cache/unit.bin' },
      ],
    }, 'text');

    expect(said.startsWith('unit (unit):\n')).toBe(true);
    expect(said.endsWith(`\n${NOT_LOADED('checkout (e2e), stories (visual)')}\n`)).toBe(true);
    expect(said).not.toContain('/cache/coverage.bin');
  });
});

const UNFETCHED = 'f'.repeat(40);

describe('a file added after the commit a suite recorded at', () => {
  // The unit suite last ran before src/refund.ts existed; the visual suite ran
  // after, and loaded it. The e2e suite names a commit this clone never fetched.
  let at: string;
  let then: string;
  beforeAll(async () => {
    at = await mkdtemp(join(tmpdir(), 'variance-covering-suites-added-'));
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: at, encoding: 'utf8' }).trim();
    git('init', '--quiet');
    await writeFile(join(at, 'variance.config.json'), JSON.stringify(SUITES));
    await mkdir(join(at, 'src'));
    await writeFile(join(at, 'src/pay.ts'), 'export const pay = 1;\n');
    git('add', '.');
    git('commit', '--quiet', '-m', 'pay');
    then = git('rev-parse', 'HEAD');
    await writeFile(join(at, 'src/refund.ts'), 'export const refund = 1;\n');
    git('add', '.');
    git('commit', '--quiet', '-m', 'refund');
    // Under CI nothing builds the source index implicitly; the fixture publishes it, as the pipeline's `variance index` step does.
    await updateSourceIndex(at);
    await recordIn(at, 'unit', indexOf('src/pay.ts', { id: 'u', file: 'src/pay.test.ts', name: 'charges once' }), then);
    await recordIn(at, 'checkout', indexOf('src/pay.ts', { id: 'c', file: 'e2e/pay.spec.ts', name: 'pays' }), UNFETCHED);
    await recordIn(at, 'stories', indexOf('src/refund.ts', { id: 's', file: 'src/Refund.stories.tsx', name: 'Refunded' }), git('rev-parse', 'HEAD'));
  });
  afterAll(() => rm(at, { recursive: true, force: true }));

  it('is said in full as a record older than the file, with the commit, and ends with a gap that names no run when selection names none, and reach takes the diff', async () => {
    const answer = await ask(['covering', '--file', 'src/refund.ts', '--line', '12', '--root', at]);

    expect(answer.out).toMatch(new RegExp(
      `^unit \\(unit\\): \`src/refund\\.ts\` did not exist at ${then.slice(0, 12)}, the commit the record at \`[^\`]+/suites/unit/[^\`]+\` was made at, ` +
        'so that record has no answer for it\\.\\n' +
        '  Gap \\(stale\\) on line 12 of src/refund\\.ts: which tests run it\\. ' +
        'Known: the record predates the file, and selection runs no recorded test file for it\\.\\n' +
        '  Next, Record:\\n' +
        `    variance reach --since ${then.slice(0, 12)}$`,
      'mu',
    ));
    expect(answer.out).not.toContain('Not loaded by');
  });

  it('is refused as `older` for a program, not `unloaded`, since the run never had the file to load', async () => {
    const answer = await ask(['covering', '--file', 'src/refund.ts', '--line', '12', '--root', at, '--format', 'json']);

    const said = JSON.parse(answer.out) as { suites: Record<string, unknown>[] };
    const unit = said.suites.find((one) => one['suite'] === 'unit');
    expect(unit?.['refused']).toBe('older');
    expect(unit?.['gap']).toEqual({
      question: 'which tests run it',
      scope: 'line 12 of src/refund.ts',
      known: 'the record predates the file, and selection runs no recorded test file for it',
      reason: 'stale',
      remedy: 'record',
      next: [`variance reach --since ${then.slice(0, 12)}`],
    });
  });

  it('says the commit could not be read, not that no test loaded the file, when git cannot list it', async () => {
    const answer = await ask(['covering', '--file', 'src/refund.ts', '--suite', 'checkout', '--root', at]);

    expect(answer.code).toBe(2);
    expect(answer.err).toContain(`git could not read ${UNFETCHED.slice(0, 12)}, the commit that record was made at`);
    expect(answer.err).not.toContain('is not in the index');
  });

  it('is said the same way when the suite is named', async () => {
    const answer = await ask(['covering', '--file', 'src/refund.ts', '--suite', 'unit', '--root', at]);

    expect(answer.code).toBe(2);
    expect(answer.err).toContain(`\`src/refund.ts\` did not exist at ${then.slice(0, 12)}`);
  });

  it('is a suite that never loaded the file when the file existed at the commit it recorded at', async () => {
    const answer = await ask(['covering', '--file', 'src/pay.ts', '--line', '12', '--root', at]);

    expect(answer.out.endsWith(`\n${NOT_LOADED('stories (visual)')}\n`)).toBe(true);
  });
});

describe('a repository whose declared suites have none of them run', () => {
  it('is refused as `unrecorded` on the stream a program parses, so an editor stops asking', async () => {
    const bare = await mkdtemp(join(tmpdir(), 'variance-covering-suites-bare-'));
    execFileSync('git', ['init', '--quiet', bare]);
    await writeFile(join(bare, 'variance.config.json'), JSON.stringify(SUITES));

    const answer = await ask(['covering', '--file', 'src/pay.ts', '--root', bare, '--format', 'json']);

    expect(answer.code).toBe(2);
    expect(JSON.parse(answer.out)).toEqual({
      refused: 'unrecorded',
      gap: {
        question: 'which tests ran it',
        scope: 'src/pay.ts',
        known: 'no run is recorded',
        reason: 'absent',
        remedy: 'record',
        run: { suites: ['unit', 'checkout', 'stories'] },
        next: [],
      },
    });
    expect(answer.err).toContain('none of the suites it declares, "checkout", "stories", "unit", has a per-case index');
    // No record counts the suite, so the gap names no cost rather than a zero.
    expect(answer.err).toContain('Gap (absent) on src/pay.ts: which tests ran it. Known: no run is recorded.\nNext, Record, at a cost no record counts:\n  Wire the producers of `unit`, `checkout` and `stories` and record one run of each: that first run is the record.');
  });
});
