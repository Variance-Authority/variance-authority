/// <depends path="../bin.ts" />
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digestString } from '@variance-authority/core/format';
import { sourceIndexPath } from '@variance-authority/sense';
import { INSTRUMENTATION_ID } from '@variance-authority/sense/instrument';
import { encodeAsSetExecutionIndex, testCoverageFile, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { expect, it } from 'vitest';
import { checkout } from './ask-packages.fixture.js';

const manifest = new URL('../../package.json', import.meta.url);
const { bin } = JSON.parse(readFileSync(manifest, 'utf8')) as { bin: { variance: string } };
const executable = fileURLToPath(new URL(bin.variance, manifest));
const nodeEntry = fileURLToPath(new URL('../../dist/bin.js', import.meta.url));

it('builds, uses, and refreshes a published index from the package bin without Node on PATH', () => {
  const previous = process.cwd();
  const root = checkout();
  try {
    const { run, oracle } = commands(root);
    const built = run('index', '--wait');
    expect(built.status, built.stderr).toBe(0);
    expect(built.stdout).toContain('source index built');
    expect(built.stdout).toContain('code map:');
    expect(built.stdout).toContain('dependency lexicon:');
    expect(built.stdout).toContain('questions: published');
    const before = run('ask', 'symbol', '--name', 'greet', '--package', '@acme/lib');
    expect(before.status, before.stderr).toBe(0);
    expect(before.stdout).toContain("import { greet } from '@acme/lib';");
    const kept = run('index', '--wait');
    expect(kept.status, kept.stderr).toBe(0);
    expect(kept.stdout).toContain('questions: kept');
    const nodeKept = oracle('index', '--wait');
    expect(nodeKept.status, nodeKept.stderr).toBe(0);
    expect(nodeKept.stdout).toContain('questions: kept');
    const nodeAnswer = oracle('ask', 'symbol', '--name', 'greet', '--package', '@acme/lib');
    expect(nodeAnswer.status, nodeAnswer.stderr).toBe(0);
    expect(nodeAnswer.stdout).toBe(before.stdout);
    writeFileSync(join(root, 'packages/lib/src/greet.ts'),
      '/** The refreshed greeting. */\nexport function greet(name: string) { return name; }\n');
    const updated = run('index', '--wait', '--no-git');
    expect(updated.status, updated.stderr).toBe(0);
    expect(updated.stdout).toContain('source index updated');
    expect(updated.stdout).toContain('questions: published');
    const after = run('ask', 'symbol', '--name', 'greet', '--package', '@acme/lib');
    expect(after.status, after.stderr).toBe(0);
    expect(after.stdout).toContain('The refreshed greeting.');
  } finally {
    process.chdir(previous);
    rmSync(root, { recursive: true, force: true });
  }
});


function commands(root: string) {
  const gitPath = join(root, 'node_modules', 'native-git-path');
  mkdirSync(gitPath, { recursive: true });
  const windows = process.platform === 'win32';
  const git = execFileSync(windows ? 'where.exe' : 'which', ['git'], { encoding: 'utf8' }).split(/\r?\n/u)[0]!;
  if (windows) copyFileSync(git, join(gitPath, 'git.exe'));
  else symlinkSync(git, join(gitPath, 'git'));
  const env = { ...process.env, CI: 'false', npm_config_user_agent: '' };
  return {
    run: (...args: string[]) => spawnSync(executable, args, {
      cwd: root, env: { ...env, PATH: gitPath }, encoding: 'utf8',
    }),
    oracle: (...args: string[]) => spawnSync(process.execPath, [nodeEntry, ...args], { cwd: root, env, encoding: 'utf8' }),
  };
}

it('publishes and keeps the journeys of a recorded suite without Node on PATH', async () => {
  const previous = process.cwd();
  const file = 'packages/lib/src/greet.ts';
  const test = 'packages/lib/src/greet.test.ts';
  const root = checkout({
    'variance.config.json': JSON.stringify({ suites: { unit: { kind: 'unit' }, integration: { kind: 'integration' } } }),
    [test]: "import { greet } from './greet.js';\ngreet('a');\n",
  });
  try {
    const recording = testCoverageFile(root, { suite: 'unit' });
    mkdirSync(dirname(recording), { recursive: true });
    await writeTestCoverage(recording, {
      version: 3,
      instrumentation: INSTRUMENTATION_ID,
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      tests: [{ file: test, complete: true, preconditions: [] }],
      modules: [{ file, instrumented: true, sourceDigest: digestString(readFileSync(file, 'utf8')), blocks: [
        { ordinal: 0, kind: 'module', name: file, path: 'module', digest: digestString(file), startLine: 1, endLine: 3, source: true, testFiles: [test] },
      ] }],
    }, {
      index: encodeAsSetExecutionIndex({
        tests: [{ id: test, name: 'greets', file: test, stopped: false }],
        modules: [{ file, blocks: [
          { kind: 'function', name: 'greet', path: 'entry', startLine: 1, endLine: 3, source: true, crossings: [{ test: 0, distance: 0 }] },
        ] }],
      }),
    });
    const { run, oracle } = commands(root);
    const made = run('index', '--wait');
    expect(made.status, made.stderr).toBe(0);
    expect(made.stdout).toContain('journeys, suite unit: 1 case walked');
    expect(made.stdout).toContain('journeys, suite integration: not prepared: nothing is recorded at');
    const kept = run('index', '--wait');
    const expected = oracle('index', '--wait');
    expect(kept.status, kept.stderr).toBe(0);
    expect(expected.status, expected.stderr).toBe(0);
    const journeys = (out: string) => out.split('\n').filter((line) => line.startsWith('journeys'));
    expect(journeys(kept.stdout)).toEqual(journeys(expected.stdout));
    expect(kept.stdout).toContain('kept, because the recording, the index and the walk are the ones they were made from');
  } finally {
    process.chdir(previous);
    rmSync(root, { recursive: true, force: true });
  }
});

it('hands default indexing to a native worker that a following question can wait for', () => {
  const previous = process.cwd();
  const root = checkout();
  try {
    const { run } = commands(root);
    const indexed = run('index');
    expect(indexed.status, indexed.stderr).toBe(0);
    expect(indexed.stdout).toContain('source index built');
    expect(indexed.stdout).toMatch(/follow-ups: nothing has failed; process \d+ is still making/u);
    const answer = run('ask', 'symbol', '--name', 'greet', '--package', '@acme/lib');
    expect(answer.status, answer.stderr).toBe(0);
    expect(answer.stdout).toContain("import { greet } from '@acme/lib';");
  } finally {
    process.chdir(previous);
    rmSync(root, { recursive: true, force: true });
  }
});


it('seeds a linked worktree index from the primary checkout without Node on PATH', () => {
  const previous = process.cwd();
  const root = checkout();
  const worktree = join(root, '.git', 'linked');
  try {
    const primary = commands(root).run('index', '--wait');
    expect(primary.status, primary.stderr).toBe(0);
    execFileSync('git', ['worktree', 'add', '--detach', worktree], { stdio: 'pipe' });
    const { run } = commands(worktree);
    const indexed = run('index', '--wait');
    expect(indexed.status, indexed.stderr).toBe(0);
    expect(indexed.stdout).toContain(`source index built from the one at ${sourceIndexPath(root)}:`);
    expect(indexed.stdout).toContain(`0 read again, at ${sourceIndexPath(worktree)}`);
    const answer = run('ask', 'symbol', '--name', 'greet', '--package', '@acme/lib');
    expect(answer.status, answer.stderr).toBe(0);
    expect(answer.stdout).toContain("import { greet } from '@acme/lib';");
  } finally {
    process.chdir(previous);
    rmSync(root, { recursive: true, force: true });
  }
});

it('publishes a pnpm workspace with recursive member globs and a YAML package manifest without Node on PATH', () => {
  const previous = process.cwd();
  const root = checkout({
    'package.json': JSON.stringify({ private: true }),
    'pnpm-workspace.yaml': '"packages": [apps/**, "!apps/excluded"]\n',
    'apps/tools/inventory/package.yaml': 'name: "@acme/inventory"\nexports:\n  ".": "./src/index.ts"\n',
    'apps/tools/inventory/src/index.ts': 'export const inventory = 1;\n',
    'apps/excluded/package.json': JSON.stringify({ name: '@acme/excluded', main: 'src/index.ts' }),
    'apps/excluded/src/index.ts': 'export const excluded = 1;\n',
  });
  try {
    const { run, oracle } = commands(root);
    const indexed = run('index', '--wait');
    expect(indexed.status, indexed.stderr).toBe(0);
    expect(indexed.stdout).toContain('questions: published');
    const nodeKept = oracle('index', '--wait');
    expect(nodeKept.status, nodeKept.stderr).toBe(0);
    expect(nodeKept.stdout).toContain('questions: kept');
    const answer = run('ask', 'packages');
    expect(answer.status, answer.stderr).toBe(0);
    expect(answer.stdout).toContain('@acme/inventory');
    expect(answer.stdout).not.toContain('@acme/excluded');
  } finally {
    process.chdir(previous);
    rmSync(root, { recursive: true, force: true });
  }
});
