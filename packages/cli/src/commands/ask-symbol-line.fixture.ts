// compass: variance-authority.report.agent-surface

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { encodeExecutionIndex, landCases, testCoverageFile, withCaseSections, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { expect } from 'vitest';
import { main } from '../bin.js';
import { EXIT_CLEAN } from '../exit.js';

/**
 * Five tests, each named for what it renders, recorded at the commit the
 * sources are written at, at `commit` when it names one, at none when it is
 * false, and not recorded at all when `recording` is false.
 */
export async function recorded({ commit = true, recording = true }: { readonly commit?: boolean | string; readonly recording?: boolean } = {}): Promise<string> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-symbol-line-')));
  execFileSync('git', ['init', '--quiet', '--initial-branch', 'main'], { cwd: root, stdio: 'pipe' });
  process.chdir(root);
  const declares = (name: string, value: string): string => `export function ${name}(): string {\n  return '${value}';\n}\n`;
  const sources: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'resonance', private: true }),
    'src/session.ts': declares('useSessionId', 'real'),
    'src/legacy.ts': declares('useSessionId', 'legacy'),
    'src/stale.ts': declares('useSessionId', 'stale'),
    'src/constant.ts': `export const useSessionId = 'constant';\n${declares('other', 'other')}`,
    'src/page.ts': [
      "import { useSessionId } from './session';",
      'export function page(): string {',
      '  return useSessionId();',
      '}',
      'export function header(): string {',
      '  return useSessionId();',
      '}',
      '',
    ].join('\n'),
    'src/idle.ts': "import { useSessionId } from './session';\nexport function idle(): string {\n  return useSessionId();\n}\n",
    'src/a.ts': declares('format', 'a'),
    'src/b.ts': declares('format', 'b'),
    'src/c.ts': "function shout(): string {\n  return 'c';\n}\nexport { shout as format };\n",
    'src/use.ts': "import { format } from './a';\nexport const used = (): string => format();\n",
    'src/log.ts': declares('log', 'loud'),
    'src/quiet.ts': declares('log', 'quiet'),
    'src/report.ts': "import { log } from './quiet';\nexport const report = (): string => log();\n",
    'src/arrow.ts': "export const token =\n  (): string => 'arrow';\n",
    'src/store.ts': "export class Store {\n  token(): string {\n    return 'method';\n  }\n}\n",
    'src/fixed.ts': "export const token = 'fixed';\n{\n  const token = (): string => 'inner';\n  void token;\n}\n",
  };
  for (const [path, text] of Object.entries(sources)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('add', '.');
  git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', 'commit', '--quiet', '-m', 'recorded');
  // A question reads the generation `variance index` published.
  expect(await main(['index'], { out: () => {}, err: () => {} })).toBe(EXIT_CLEAN);
  if (!recording) return root;
  const at = testCoverageFile(root);
  const files = ['test/page.test.ts', 'test/legacy.test.ts', 'test/header.test.ts', 'test/use.test.ts', 'test/report.test.ts'];
  const region = (kind: string, name: string, startLine: number, endLine: number, entered: readonly number[]) => ({
    kind, name, path: 'entry', startLine, endLine, source: true, crossings: entered.map((test) => ({ test, distance: 0 })),
  });
  const modules: Record<string, ReturnType<typeof region>[]> = {
    'src/session.ts': [region('function', 'useSessionId', 1, 3, [0])],
    'src/legacy.ts': [region('function', 'useSessionId', 1, 3, [1])],
    'src/stale.ts': [region('function', 'useSessionId', 1, 3, [])],
    'src/constant.ts': [region('function', 'other', 2, 4, [])],
    'src/page.ts': [region('function', 'page', 2, 4, [0]), region('function', 'header', 5, 7, [2])],
    'src/idle.ts': [region('function', 'idle', 2, 4, [])],
    'src/a.ts': [region('function', 'format', 1, 3, [3])],
    'src/b.ts': [region('function', 'format', 1, 3, [3])],
    'src/c.ts': [region('function', 'shout', 1, 3, [3])],
    'src/use.ts': [region('function', 'used', 2, 2, [3])],
    'src/log.ts': [region('function', 'log', 1, 3, [0, 1, 2, 3, 4])],
    'src/quiet.ts': [region('function', 'log', 1, 3, [4])],
    'src/report.ts': [region('function', 'report', 2, 2, [4])],
    'src/arrow.ts': [region('function', 'token', 2, 2, [0])],
    'src/store.ts': [region('function', 'Store/token', 2, 4, [0])],
    'src/fixed.ts': [region('function', 'token', 3, 3, [0])],
  };
  const covered = (file: string, blocks: readonly ReturnType<typeof region>[]) => ({
    file,
    sourceDigest: `digest:${file}`,
    instrumented: true,
    blocks: blocks.map((block, ordinal) => ({
      ordinal, kind: block.kind, digest: `block:${file}:${ordinal}`, name: block.name, path: block.path, source: true,
      startLine: block.startLine, endLine: block.endLine, testFiles: block.crossings.map(({ test }) => files[test] ?? ''),
    })),
  });
  await writeTestCoverage(at, {
    version: 3,
    instrumentation: 'fixture-instrumentation',
    ...(commit === false ? {} : { commit: commit === true ? git('rev-parse', 'HEAD') : commit }),
    tests: files.map((file) => ({ file, complete: true, preconditions: [] })),
    modules: Object.entries(modules).map(([file, blocks]) => covered(file, blocks)),
  });
  const tests = files.map((file, at) => ({ id: `t${at}`, file, name: `renders ${file.slice(5, -8)}` }));
  const shard = join(mkdtempSync(join(tmpdir(), 'va-symbol-line-shard-')), 'run.bin');
  writeFileSync(shard, withCaseSections(readFileSync(at), { index: encodeExecutionIndex({
    tests,
    modules: Object.entries(modules).map(([file, blocks]) => ({ file, blocks })),
  }) }));
  const { sections } = await landCases(at, {}, root, [{ path: shard, coverage: { tests: files.map((file) => ({ file, complete: true })) } }]);
  writeFileSync(at, withCaseSections(readFileSync(at), sections));
  return root;
}
