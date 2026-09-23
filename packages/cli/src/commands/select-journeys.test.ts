import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodeExecutionIndex } from '@variance-authority/sense/test-selection';
import { selectOutput } from './select-command.js';

/**
 * `variance select --execution` over a change handed in, not read from history.
 *
 * `branch.test.ts` and `other.test.ts` both import `src/decide.ts`; only
 * `branch.test.ts` entered `second`. A patch on a line of `second` skips
 * `other.test.ts`, and the same file named without lines is answered by the
 * import graph, which runs both.
 *
 * The fixture is the row-per-crossing spelling, which is the one a caller can
 * write, so this reads through `narrowByJourneys`; the addon's reading of the
 * set spelling is held to the same answers in `journey-native.test.ts`.
 */
describe('selecting from a journey file', () => {
  const cwd = process.cwd();
  let root: string;

  beforeEach(() => {
    process.env['XDG_CACHE_HOME'] = mkdtempSync(join(tmpdir(), 'va-select-journeys-cache-'));
    root = project();
    process.chdir(root);
  });

  afterEach(() => {
    process.chdir(cwd);
    delete process.env['XDG_CACHE_HOME'];
  });

  it('skips the test file that never entered the changed function', async () => {
    writeFileSync(join(root, 'change.patch'), patch(6));
    const said = await selectOutput({ cwd: root, format: 'plain', execution: 'journeys.bin', diff: 'change.patch', noGit: true });
    expect(said.out).toBe('test/other.test.ts\n');
  });

  it('answers a file named without lines with every test file that imports it', async () => {
    writeFileSync(join(root, 'names.txt'), 'src/decide.ts\n');
    const said = await selectOutput({ cwd: root, format: 'plain', execution: 'journeys.bin', diff: 'names.txt', noGit: true });
    expect(said.out).toBe('');
  });

  it('names a path neither the journey nor the graph knows, and skips every test it does not reach', async () => {
    writeFileSync(join(root, 'names.txt'), 'nowhere.ts\n');
    const said = await selectOutput({ cwd: root, format: 'plain', execution: 'journeys.bin', diff: 'names.txt', noGit: true });
    expect(said.out).toBe('test/branch.test.ts\ntest/other.test.ts\n');
    expect(said.err).toContain('nowhere.ts');
  });
});

const DECIDE = [
  'export function first(value: number): string {',
  "  return value > 0 ? 'up' : 'down';",
  '}',
  '',
  'export function second(value: number): string {',
  "  return value > 10 ? 'high' : 'low';",
  '}',
  '',
].join('\n');

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'va-select-journeys-'));
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'test'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'journeys-fixture', type: 'module' }));
  writeFileSync(join(root, 'src/decide.ts'), DECIDE);
  writeFileSync(join(root, 'test/branch.test.ts'), "import { first, second } from '../src/decide';\nfirst(1);\nsecond(20);\n");
  writeFileSync(join(root, 'test/other.test.ts'), "import { first } from '../src/decide';\nfirst(1);\n");

  const tests = [
    { id: 'test/branch.test.ts > high', file: 'test/branch.test.ts', name: 'high' },
    { id: 'test/other.test.ts > up', file: 'test/other.test.ts', name: 'up' },
  ];
  const crossings = (...tests: number[]) => tests.map((test) => ({ test, distance: 0 }));
  const region = (name: string, startLine: number, endLine: number, entered: ReturnType<typeof crossings>) =>
    ({ kind: 'function', name, path: name, startLine, endLine, source: true, crossings: entered });
  writeFileSync(join(root, 'journeys.bin'), encodeExecutionIndex({
    tests,
    modules: [{
      file: 'src/decide.ts',
      blocks: [region('first', 1, 3, crossings(0, 1)), region('second', 5, 7, crossings(0))],
    }],
  }));
  return root;
}

function patch(line: number): string {
  return [
    'diff --git a/src/decide.ts b/src/decide.ts',
    '--- a/src/decide.ts',
    '+++ b/src/decide.ts',
    `@@ -${line},1 +${line},1 @@`,
    "-  return value > 10 ? 'high' : 'low';",
    "+  return value > 11 ? 'high' : 'low';",
    '',
  ].join('\n');
}
