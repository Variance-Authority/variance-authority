import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeExecutionIndex, landCaseIndexes, testCoverageFile, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../bin.js';
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';

/** `variance ask journey-map`, through the command a person types: it refuses by naming what is missing. */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-journey-map-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

function checkout(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-journey-map-')));
  execFileSync('git', ['init', '--quiet', '--initial-branch', 'main'], { cwd: root, stdio: 'pipe' });
  process.chdir(root);
  return root;
}

async function run(argv: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (text) => { out += text; }, err: (text) => { err += text; } });
  return { code, out, err };
}

describe('variance ask journey-map', () => {
  it('asks for the file when none is named', async () => {
    checkout();
    const answered = await run(['ask', 'journey-map']);
    expect(answered.code).toBe(EXIT_OPERATOR);
    expect(answered.err).toContain('--file');
  });

  it('says the checkout has no recording to read when nothing was recorded', async () => {
    checkout();
    const answered = await run(['ask', 'journey-map', '--file', 'src/a.ts', '--query', 'pay']);
    expect(answered.code).toBe(EXIT_OPERATOR);
    expect(answered.err).toContain('holds no suite to read');
  });

  it('refuses a mistyped path as not in the checkout, rather than as a file no test ran, and names the path one typo away', async () => {
    const root = await recorded();

    const answered = await run(['ask', 'journey-map', '--file', 'src/comands/since.ts']);

    expect(answered.code).toBe(EXIT_OPERATOR);
    expect(answered.err).toContain(
      `\`src/comands/since.ts\` is in neither the recording nor the files git lists under ${root}.\nDid you mean \`src/commands/since.ts\`?`,
    );
    expect(answered.err).not.toContain('No recorded test');
  });

  it('refuses a path under the wrong directory as not in the checkout, and names the recorded files of the same name', async () => {
    const root = await recorded();

    const answered = await run(['ask', 'journey-map', '--file', 'src/test-selection/since.ts']);

    expect(answered.code).toBe(EXIT_OPERATOR);
    expect(answered.err).toContain(
      `\`src/test-selection/since.ts\` is in neither the recording nor the files git lists under ${root}.\n` +
        'The recording holds `since.ts` at `src/commands/since.ts`.',
    );
    expect(answered.err).not.toContain('Did you mean');
  });

  it('maps a file asked through `..` or from the root of the file system as the file in the checkout', async () => {
    const { root } = await committed();

    for (const asked of ['src/commands/../commands/since.ts', join(root, 'src/commands/since.ts')]) {
      const answered = await run(['ask', 'journey-map', '--file', asked]);
      expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
      expect(answered.out).toContain('src/commands/since.ts: 0 of 1 recorded tests entered it');
    }
  });

  it('refuses a path outside the checkout by saying so', async () => {
    const { root } = await committed();

    const answered = await run(['ask', 'journey-map', '--file', '../elsewhere.ts']);

    expect(answered.code).toBe(EXIT_OPERATOR);
    expect(answered.err).toContain(`../elsewhere.ts is outside the checkout at ${root}, and the recording holds only paths inside it.`);
  });

  it('says a directory is one, since the map is drawn around a file', async () => {
    await committed();

    const answered = await run(['ask', 'journey-map', '--file', 'src/commands/']);

    expect(answered.code).toBe(EXIT_OPERATOR);
    expect(answered.err).toContain('src/commands is a directory, and journey-map draws its map around one file: ask about one of the files in it.');
  });

  it('says a file deleted since the recording existed at its commit, as the API does, rather than refusing it as a typo', async () => {
    const { at } = await committed();

    const answered = await run(['ask', 'journey-map', '--file', 'src/commands/old.ts']);

    expect(answered.code).toBe(EXIT_OPERATOR);
    expect(answered.err).toContain(`src/commands/old.ts existed at ${at}, where the recording was made, and is not in the checkout now.`);
    expect(answered.err).not.toContain('in neither the recording');
  });
});

/**
 * {@link recorded}, made at a commit that holds `src/commands/since.ts` and
 * `src/commands/old.ts`, after which `old.ts` is deleted. `at` is that commit's
 * first twelve digits.
 */
async function committed(): Promise<{ root: string; at: string }> {
  const root = checkout();
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  const commit = () => git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'fixture');
  mkdirSync(join(root, 'src/commands'), { recursive: true });
  for (const file of ['since.ts', 'old.ts']) writeFileSync(join(root, 'src/commands', file), 'export const held = 1;\n');
  git('add', '.');
  commit();
  const made = git('rev-parse', 'HEAD').trim();
  git('rm', '--quiet', 'src/commands/old.ts');
  commit();
  await recorded(made);
  return { root, at: made.slice(0, 12) };
}

/** A recording in which `test/since.test.ts` entered `src/commands/since.ts`, made at `made` or at no commit, in the checkout `process.cwd()` or a new one that holds neither file. */
async function recorded(made?: string): Promise<string> {
  const root = made === undefined ? checkout() : process.cwd();
  const at = testCoverageFile(root);
  await writeTestCoverage(at, {
    version: 3,
    instrumentation: 'fixture-instrumentation',
    ...(made === undefined ? {} : { commit: made }),
    tests: [{ file: 'test/since.test.ts', complete: true, preconditions: [] }],
    modules: [{
      file: 'src/commands/since.ts',
      sourceDigest: 'digest:since',
      instrumented: true,
      blocks: [{
        ordinal: 0, kind: 'module', digest: 'block:since', name: '', path: 'entry', source: true,
        startLine: 1, endLine: 5, testFiles: ['test/since.test.ts'],
      }],
    }],
  });
  // A run's own index, laid beside the snapshot the way a landing lays it, which is the spelling the reader takes.
  const shard = join(mkdtempSync(join(tmpdir(), 'va-journey-map-shard-')), 'run.bin');
  writeFileSync(`${shard}.cases.bin`, encodeExecutionIndex({
    tests: [{ id: 's1', file: 'test/since.test.ts', name: 'reads' }],
    modules: [{
      file: 'src/commands/since.ts',
      blocks: [{ kind: 'module', name: '', path: 'entry', startLine: 1, endLine: 5, source: true, crossings: [{ test: 0, distance: 0 }] }],
    }],
  }));
  const tests = [{ file: 'test/since.test.ts', complete: true }];
  await landCaseIndexes(at, root, [{ path: shard, coverage: { tests, ...(made === undefined ? {} : { commit: made }) } }]);
  return root;
}
