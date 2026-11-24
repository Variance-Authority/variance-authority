/// <depends path="../bin.ts" />
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digestString } from '@variance-authority/core/format';
import { INSTRUMENTATION_ID } from '@variance-authority/sense/instrument';
import { encodeAsSetExecutionIndex, landRun, recordOfCases, testCoverageFile, writeTestCoverage, type TestCoverage } from '@variance-authority/sense/test-selection';
import { expect, it } from 'vitest';
import { checkout } from './ask-packages.fixture.js';

const manifest = new URL('../../package.json', import.meta.url);
const { bin } = JSON.parse(readFileSync(manifest, 'utf8')) as { bin: { variance: string } };
const executable = fileURLToPath(new URL(bin.variance, manifest));
const nodeEntry = fileURLToPath(new URL('../../dist/bin.js', import.meta.url));

it.each([
  { format: 'plain', edit: 'handed' },
  { format: 'json', edit: 'handed' },
  { format: 'plain', edit: 'body' },
  { format: 'json', edit: 'comment' },
  { format: 'plain', edit: 'loaded' },
  { format: 'json', edit: 'since' },
  { format: 'plain', edit: 'declared' },
  { format: 'json', edit: 'load' },
])('selects a $edit patch from a journey in $format with Node absent from PATH', ({ format, edit }) => {
  const previous = process.cwd();
  const file = 'packages/lib/src/choose.ts';
  const source = 'export function first() {\n  return 1;\n}\nexport function second() {\n  return 2;\n}\n';
  const tests = ['test/first.test.ts', 'test/second.test.ts'];
  const root = checkout({
    [file]: source,
    [tests[0]!]: "import '../packages/lib/src/choose.js';\n",
    ...(edit === 'declared' ? { [tests[1]!]: '/// <depends path="../packages/lib/src/choose.ts" />\n' } : {}),
    ...(edit === 'since' ? { 'yarn.lock': '# yarn lockfile v1\n' } : {}),
  });
  try {
    const execution = '.git/journey.bin';
    writeFileSync(execution, encodeAsSetExecutionIndex({
      tests: tests.map((file, index) => ({ id: String(index), name: file, file })),
      modules: [{ file, blocks: [
        { kind: 'function', name: 'first', path: 'first', startLine: 1, endLine: 3, source: true,
          ...(edit === 'loaded' ? { loaded: true, crossings: [] } : { crossings: [{ test: 0, distance: 0 }] }) },
        { kind: 'function', name: 'second', path: 'second', startLine: 4, endLine: 6, source: true, crossings: [{ test: 1, distance: 0 }] },
      ] }],
    }));
    const handed = [
      `diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`,
      '@@ -1,6 +1,6 @@', ' export function first() {', '-  return 1;', '+  return 9;',
      ' }', ' export function second() {', '   return 2;', ' }', '',
    ].join('\n');
    const fromGit = edit === 'body' || edit === 'comment' || edit === 'since' || edit === 'load';
    if (fromGit) {
      const revised = edit === 'load' ? `console.log('loaded');\n${source}`
        : source.replace('return 1;', edit === 'comment' ? 'return 1; // unchanged at runtime' : 'return 9;');
      writeFileSync(file, revised);
    }
    const patch = '.git/change.patch';
    const change = edit === 'since' ? ['--since', 'HEAD'] : ['--diff', patch];
    if (edit !== 'since') writeFileSync(patch, fromGit ? execFileSync('git', ['diff', '--', file]) : handed);
    const args = ['select', '--execution', execution, ...change, '--format', format];
    const { native, oracle } = commands(root);
    const actual = native(args);
    const expected = oracle(args);
    expect(expected.status, expected.stderr).toBe(0);
    if (format === 'plain') expect(expected.stdout).toBe(edit === 'declared' ? '' : `${tests[1]}\n`);
    else expect(JSON.parse(expected.stdout)).toMatchObject({ ground: 'read', skip: edit === 'comment' ? tests : [tests[1]] });
    expect([actual.status, actual.stdout, actual.stderr]).toEqual([expected.status, expected.stdout, expected.stderr]);
  } finally {
    process.chdir(previous);
    rmSync(root, { recursive: true, force: true });
  }
});


function commands(root: string) {
  const env = { ...process.env, CI: 'false', npm_config_user_agent: '' };
  const gitPath = join(root, '.git', 'git-path');
  mkdirSync(gitPath);
  const windows = process.platform === 'win32';
  const git = execFileSync(windows ? 'where.exe' : 'which', ['git'], { encoding: 'utf8' }).split(/\r?\n/u)[0]!;
  if (windows) copyFileSync(git, join(gitPath, 'git.exe'));
  else symlinkSync(git, join(gitPath, 'git'));
  return {
    native: (args: readonly string[]) => spawnSync(executable, args, { cwd: root, env: { ...env, PATH: gitPath }, encoding: 'utf8' }),
    oracle: (args: readonly string[]) => spawnSync(process.execPath, [nodeEntry, ...args], { cwd: root, env, encoding: 'utf8' }),
  };
}

it.each(['clean', 'body', 'comment', 'handed', 'stale', 'precondition', 'landed', 'missing', 'case-only', 'before-read', 'before-clear', 'file-use', 'mocked'] as const)(
  'reads the named suite coverage against a %s change with Node absent from PATH',
  async (edit) => {
    const previous = process.cwd();
    const file = 'src/widget.ts';
    const source = 'export function first() {\n  return 1;\n}\nexport function second() {\n  return 2;\n}\n';
    const tests = ['test/first.test.ts', 'test/incomplete.test.ts', 'test/second.test.ts'] as const;
    const before = edit === 'before-read' || edit === 'before-clear' ? ['src/setup.ts'] : undefined;
    const root = checkout({
      'variance.config.json': JSON.stringify({
        suites: { unit: { kind: 'unit', before, ...(edit === 'file-use' ? { precision: 'file-use' } : {}) }, ...(edit === 'handed' ? {} : { other: { kind: 'integration' } }) },
      }),
      [file]: source,
      ...(before === undefined ? {} : { 'src/setup.ts': edit === 'before-read' ? "import './widget.js';\n" : 'export const setup = 1;\n' }),
      ...Object.fromEntries(tests.map((test, index) => [
        test,
        "import '../src/widget.js';\n" + (edit === 'mocked' && index === 0 ? "vi.mock('../src/widget.js');\n" : ''),
      ])),
    });
    try {
      const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      const journal = testCoverageFile(root, { suite: 'unit' });
      mkdirSync(dirname(journal), { recursive: true });
      const coverage: TestCoverage = {
        version: 3, instrumentation: INSTRUMENTATION_ID, commit,
        tests: tests.map((file, index) => ({
          file, complete: index !== 1,
          preconditions: edit === 'precondition' && index === 2 ? [{ name: 'src/widget.ts', digest: digestString(source) }] : [],
        })),
        modules: [{
          file, instrumented: true, sourceDigest: digestString(edit === 'stale' ? source + '\n' : source),
          blocks: [
            { ordinal: 0, kind: 'module', name: file, path: 'module', startLine: 1, endLine: 6, source: true, digest: digestString(file), testFiles: [...tests] },
            { ordinal: 1, kind: 'function', name: 'first', path: 'first', startLine: 1, endLine: 3, source: true, digest: digestString('first'), testFiles: [tests[0]!], ...(edit === 'mocked' ? { loadedBy: [tests[0]!] } : {}) },
            { ordinal: 2, kind: 'function', name: 'second', path: 'second', startLine: 4, endLine: 6, source: true, digest: digestString('second'), testFiles: [tests[2]!] },
          ],
        }],
      };
      if (edit === 'case-only') writeFileSync(journal, recordOfCases({ index: encodeAsSetExecutionIndex({ tests: [], modules: [] }) }));
      else if (edit === 'landed') await landRun(journal, coverage, root);
      else if (edit !== 'missing') await writeTestCoverage(journal, coverage);
      const { native, oracle } = commands(root);
      if (edit !== 'clean' && edit !== 'missing' && edit !== 'case-only') writeFileSync(file, source.replace('return 1;', edit === 'comment' ? 'return 1; // same' : 'return 9;'));
      const patch = '.git/change.patch';
      if (edit === 'handed') writeFileSync(patch, execFileSync('git', ['diff', '--', file]));
      if (edit !== 'case-only' && edit !== 'missing') {
        const indexed = oracle(['index', '--wait']);
        expect(indexed.status, indexed.stderr).toBe(0);
      }
      const args = ['select', '--format', 'json', ...(edit === 'handed' ? ['--execution', journal, '--diff', patch] : ['--suite', 'unit'])];
      const expected = oracle(args);
      expect(expected.status, expected.stderr).toBe(0);
      if (edit === 'missing' || edit === 'case-only') {
        expect(JSON.parse(expected.stdout)).toMatchObject({ ground: edit === 'missing' ? 'no-journal' : 'no-coverage', skip: [], journal: { at: journal } });
      } else if (edit === 'before-read') {
        expect(JSON.parse(expected.stdout)).toMatchObject({ ground: 'before', skip: [], rests: [file] });
      } else {
        expect(JSON.parse(expected.stdout)).toMatchObject({
          ground: 'read',
          skip: edit === 'clean' || edit === 'comment' || edit === 'mocked' ? [tests[0], tests[2]] : edit === 'stale' || edit === 'precondition' || edit === 'file-use' ? [] : [tests[2]],
          journal: { at: journal, commit },
        });
      }
      const actual = native(args);
      expect([actual.status, actual.stdout, actual.stderr]).toEqual([expected.status, expected.stdout, expected.stderr]);
    } finally {
      process.chdir(previous);
      rmSync(root, { recursive: true, force: true });
    }
  },
);
