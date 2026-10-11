import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeExecutionIndex, testCoverageFile, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { main } from '../bin.js';
import { formatCoveringAnswer } from './covering-suites.js';

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

/** Lay one suite's record of a run, as the runner would have left it. */
async function recordIn(at: string, suite: string, index: unknown) {
  const file = testCoverageFile(at, { suite });
  await mkdir(dirname(file), { recursive: true });
  await writeTestCoverage(file, { version: 3, instrumentation: 'fixture-instrumentation', tests: [], modules: [] }, {
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

describe('a line asked of a repository that declares suites', () => {
  it('is answered by every suite, each by its role, with the one that never loaded it and the one that never ran said apart', async () => {
    const answer = await ask(['covering', '--file', 'src/pay.ts', '--line', '12', '--root', root, '--format', 'json']);

    expect(answer.code).toBe(0);
    const said = JSON.parse(answer.out) as { file: string; suites: Record<string, unknown>[] };
    expect(said.file).toBe('src/pay.ts');
    expect(said.suites.map((one) => [one['suite'], one['kind'], one['refused']])).toEqual([
      ['checkout', 'e2e', 'unrecorded'],
      ['stories', 'visual', 'unloaded'],
      ['unit', 'unit', undefined],
    ]);
    expect((said.suites[2]!['tests'] as { id: string }[]).map((test) => test.id)).toEqual(['u']);
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

  it('explains every suite in full when the only one holding the file refuses the line, since none answered', async () => {
    const answer = await ask(['covering', '--file', 'src/pay.ts', '--line', '3', '--root', root]);

    expect(answer.out).toMatch(/^unit \(unit\): line 3 of `src\/pay\.ts` is outside every recorded region/mu);
    expect(answer.out).toMatch(/^stories \(visual\): `src\/pay\.ts` is not in the index at/mu);
    expect(answer.out).not.toContain('Not loaded by');
  });

  it('explains every suite in full when none of them loaded the file, since that is the whole answer', async () => {
    const answer = await ask(['covering', '--file', 'src/charge.ts', '--root', root]);

    expect(answer.code).toBe(0);
    expect(answer.out).toMatch(/^stories \(visual\): `src\/charge\.ts` is not in the index at `[^`]+\/suites\/stories\/[^`]+`, which holds 1 file\./mu);
    expect(answer.out).toMatch(/^unit \(unit\): `src\/charge\.ts` is not in the index at .* Nothing recorded ends in `charge\.ts`\.$/mu);
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

describe('a suite that recorded the file under another root', () => {
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

  it('keeps its refusal whole beside a suite that answered, since it most likely ran the file', async () => {
    const at = await repository('packages/shop/src/pay.ts');
    const answer = await ask(['covering', '--file', 'src/pay.ts', '--line', '12', '--root', at]);

    expect(answer.out).toMatch(/^stories \(visual\): `src\/pay\.ts` is not in the index at .* The record spells it `packages\/shop\/src\/pay\.ts`\.$/mu);
    expect(answer.out).not.toContain('Not loaded by');
  });

  it('carries that path for a program, beside the refusal', async () => {
    const at = await repository('packages/shop/src/pay.ts');
    const answer = await ask(['covering', '--file', 'src/pay.ts', '--line', '12', '--root', at, '--format', 'json']);

    const said = JSON.parse(answer.out) as { suites: Record<string, unknown>[] };
    expect(said.suites.find((one) => one['suite'] === 'stories')).toMatchObject({ refused: 'unloaded', spelled: ['packages/shop/src/pay.ts'] });
    expect(said.suites.find((one) => one['suite'] === 'checkout')).not.toHaveProperty('spelled');
  });

  it('is a suite that tests other code when only the file name matches', async () => {
    const at = await repository('lib/pay.ts');
    const answer = await ask(['covering', '--file', 'src/pay.ts', '--line', '12', '--root', at, '--format', 'json']);
    const text = await ask(['covering', '--file', 'src/pay.ts', '--line', '12', '--root', at]);

    const said = JSON.parse(answer.out) as { suites: Record<string, unknown>[] };
    expect(said.suites.find((one) => one['suite'] === 'stories')).not.toHaveProperty('spelled');
    expect(text.out.endsWith(`\n${NOT_LOADED('stories (visual)')}\n`)).toBe(true);
  });

  it('carries a shorter recorded path the asked one ends in, a record rooted deeper', async () => {
    const at = await repository('src/pay.ts', 'packages/shop/src/pay.ts');
    const answer = await ask(['covering', '--file', 'packages/shop/src/pay.ts', '--line', '12', '--root', at, '--format', 'json']);

    const said = JSON.parse(answer.out) as { suites: Record<string, unknown>[] };
    expect(said.suites.find((one) => one['suite'] === 'stories')).toMatchObject({ spelled: ['src/pay.ts'] });
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

    expect(answer.out).toMatch(/^unit \(unit\): `src\/pay\.ts` is not in the index at .* Nothing recorded ends in `pay\.ts`\.$/mu);
    expect(answer.out).not.toContain('Not loaded by');
  });
});

describe('several suites that never loaded the file', () => {
  it('cost one line between them, in declaration order', () => {
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

describe('a repository whose declared suites have none of them run', () => {
  it('is refused as `unrecorded` on the stream a program parses, so an editor stops asking', async () => {
    const bare = await mkdtemp(join(tmpdir(), 'variance-covering-suites-bare-'));
    execFileSync('git', ['init', '--quiet', bare]);
    await writeFile(join(bare, 'variance.config.json'), JSON.stringify(SUITES));

    const answer = await ask(['covering', '--file', 'src/pay.ts', '--root', bare, '--format', 'json']);

    expect(answer.code).toBe(2);
    expect(JSON.parse(answer.out)).toEqual({ refused: 'unrecorded' });
    expect(answer.err).toContain('none of the suites it declares, "checkout", "stories", "unit", has a per-case index');
  });
});
