import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeExecutionIndex, testCoverageFile } from '@variance-authority/sense/test-selection';
import { main } from '../bin.js';

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

let cache: string;
let root: string;
let previous: string | undefined;

// Three suites, three roles: the unit suite loaded the payment module, the
// visual one ran and never loaded it, and the end-to-end one has not run.
beforeAll(async () => {
  cache = await mkdtemp(join(tmpdir(), 'variance-covering-suites-cache-'));
  previous = process.env['XDG_CACHE_HOME'];
  process.env['XDG_CACHE_HOME'] = cache;
  root = await mkdtemp(join(tmpdir(), 'variance-covering-suites-'));
  execFileSync('git', ['init', '--quiet', root]);
  await writeFile(join(root, 'variance.config.json'), JSON.stringify(SUITES));
  const record = async (suite: string, index: unknown) => {
    const at = `${testCoverageFile(root, { suite })}.cases.bin`;
    await mkdir(dirname(at), { recursive: true });
    await writeFile(at, encodeExecutionIndex(index as Parameters<typeof encodeExecutionIndex>[0]));
  };
  await record('unit', indexOf('src/pay.ts', { id: 'u', file: 'src/pay.test.ts', name: 'charges once' }));
  await record('stories', indexOf('src/Button.tsx', { id: 's', file: 'src/Button.stories.tsx', name: 'Primary' }));
});

afterAll(async () => {
  if (previous === undefined) delete process.env['XDG_CACHE_HOME'];
  else process.env['XDG_CACHE_HOME'] = previous;
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
    expect(answer.out).toMatch(/^stories \(visual\): `src\/pay\.ts` is not in the index at/mu);
    expect(answer.out).toMatch(/^checkout \(e2e\): nothing is recorded in/mu);
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
