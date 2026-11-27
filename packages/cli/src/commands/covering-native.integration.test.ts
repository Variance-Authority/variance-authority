/// <depends path="../bin.ts" />
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digestString } from '@variance-authority/core/format';
import { INSTRUMENTATION_ID } from '@variance-authority/sense/instrument';
import { encodeAsSetExecutionIndex, testCoverageFile, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { expect, it } from 'vitest';
import { checkout, run } from './ask-packages.fixture.js';

const manifest = new URL('../../package.json', import.meta.url);
const { bin } = JSON.parse(readFileSync(manifest, 'utf8')) as { bin: { variance: string } };
const executable = fileURLToPath(new URL(bin.variance, manifest));
const nodeEntry = fileURLToPath(new URL('../../dist/bin.js', import.meta.url));

it.each([
  { flags: ['--format', 'refs'], contains: 'recorded ranges' },
  { flags: ['--line', '2', '--format', 'refs'], contains: 'line 2' },
  { flags: ['--line', '1-3', '--format', 'refs'], contains: 'lines 1-3' },
  { flags: ['--function', 'greet', '--format', 'refs'], contains: 'function greet' },
  { flags: ['--format', 'json'], contains: '"ranges": [' },
  { flags: [], contains: 'named tests in 2 test files' },
  { flags: ['--limit', '1'], contains: 'the next 1:' },
  { flags: ['--format', 'refs'], recording: 'local', contains: 'recorded ranges' },
  { flags: ['--suite', 'unit', '--line', '2', '--format', 'refs'], recording: 'suite', contains: 'line 2' },
  { flags: ['--line', '5', '--format', 'refs'], runState: true, contains: 'inside only while the module evaluated' },
  { flags: ['--function', 'greet', '--format', 'refs'], runState: true, contains: 'stopped first' },
  { flags: ['--format', 'refs'], runState: true, contains: 'hole, stopped first' },
  { flags: ['--line', '5', '--format', 'json'], runState: true, contains: '"state": "loaded"' },
  { flags: ['--format', 'json'], runState: true, contains: '"loaded": true' },
  { flags: ['--line', '5'], runState: true, contains: 'ran only while the module evaluated' },
  { flags: ['--function', 'greet'], runState: true, contains: 'No case ran a part' },
  { flags: [], runState: true, contains: 'ran it only while their file imported it' },
  { flags: ['--line', '5', '--format', 'refs'], runState: true, mocks: 'one', contains: 'line 5 loaded: 1*' },
  { flags: ['--line', '5', '--format', 'refs'], runState: true, mocks: 'both', contains: 'line 5: none' },
  { flags: ['--offset', '1'], runState: true, mocks: 'one', contains: '`--offset` 1 is past the last of 1 row.' },
])('covers $flags from $recording with run state $runState and mocks $mocks through the package bin with Node absent from PATH', async ({ flags, contains, recording: kind, runState, mocks }) => {
  const previous = process.cwd();
  const file = 'packages/lib/src/greet.ts';
  const a = 'packages/lib/src/greet.test.ts';
  const b = 'apps/app/src/hello.test.ts';
  const c = 'packages/lib/src/type-only.test.ts';
  const root = checkout({
    ...(kind === 'suite' ? { 'variance.config.json': JSON.stringify({ suites: { unit: { kind: 'unit' } } }) } : {}),
    ...(runState ? {
      [a]: "import { greet } from './greet.js';\nexport const message = greet('a');\n" + (mocks === 'both' ? "vi.mock('./greet.js');\n" : ''),
      [b]: "import { greet } from '@acme/lib';\nexport const message = greet('b');\n" + (mocks === undefined ? '' : "vi.mock('@acme/lib');\n"),
      [c]: "import type { greet } from './greet.js';\nexport type Greeting = typeof greet;\n",
    } : {}),
  });
  try {
    const recording = kind === undefined ? join(root, 'record.bin') : testCoverageFile(root, kind === 'suite' ? { suite: 'unit' } : {});
    if (runState) expect((await run(['index', '--wait'])).code).toBe(0);
    const index = encodeAsSetExecutionIndex({
      tests: [
        { id: `${a} > greets by name`, file: a, name: 'greets by name', stopped: false },
        { id: 'other', file: b, name: 'says hello', stopped: runState === true },
        ...(runState ? [{ id: 'typed', file: c, name: 'only uses the type', stopped: true }] : []),
      ],
      modules: [{ file, blocks: [
        { kind: 'function', name: 'greet', path: 'entry', startLine: 1, endLine: 3, source: true, crossings: [
          { test: 0, distance: 0 }, ...(runState ? [] : [{ test: 1, distance: 0 }]),
        ] },
        { kind: 'branch', name: 'greet', path: 'if#0/then', startLine: 2, endLine: 2, source: true, crossings: [] },
        ...(runState ? [{ kind: 'branch' as const, name: 'load', path: 'load', startLine: 5, endLine: 5, source: true, loaded: true, crossings: [] }] : []),
      ] }],
    });
    if (kind === undefined) writeFileSync(recording, index);
    else {
      mkdirSync(dirname(recording), { recursive: true });
      await writeTestCoverage(recording, {
        version: 3,
        instrumentation: INSTRUMENTATION_ID,
        commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        tests: [a, b].map((file) => ({ file, complete: true, preconditions: [] })),
        modules: [{ file, instrumented: true, sourceDigest: digestString(readFileSync(file, 'utf8')), blocks: [
          { ordinal: 0, kind: 'module', name: file, path: 'module', digest: digestString(file), startLine: 1, endLine: 3, source: true, testFiles: [a, b] },
        ] }],
      }, { index });
    }
    const empty = join(root, 'empty-path');
    mkdirSync(empty);
    const env = { ...process.env, npm_config_user_agent: '' };
    const args = ['covering', '--file', file, ...(kind === undefined ? ['--execution', recording] : []), ...flags];
    const expected = spawnSync(process.execPath, [nodeEntry, ...args], { cwd: root, env, encoding: 'utf8' });
    expect(expected.error).toBeUndefined();
    expect(expected.status, expected.stderr).toBe(0);
    expect(expected.stdout).toContain(contains);
    const actual = spawnSync(executable, args, { cwd: root, env: { ...env, PATH: empty }, encoding: 'utf8' });
    expect(actual.error).toBeUndefined();
    expect([actual.status, actual.stdout, actual.stderr]).toEqual([expected.status, expected.stdout, expected.stderr]);
  } finally {
    process.chdir(previous);
    rmSync(root, { recursive: true, force: true });
  }
});
