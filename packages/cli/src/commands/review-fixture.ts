// compass: variance-authority/runtime/attention
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { digestString } from '@variance-authority/core/format';
import { updateSourceIndex } from '@variance-authority/sense';
import {
  encodeExecutionIndex,
  testCoverageFile,
  withCaseSections,
  writeTestCoverage,
  type ExecutionBlock,
  type ExecutionIndex,
} from '@variance-authority/sense/test-selection';

/**
 * A change a review reads: `main` at the base, the change in the working tree,
 * and the run after it recorded, for the review command's tests.
 */

export const BEFORE = 'export function applyDiscount(price: number): number {\n  return price * 0.9;\n}\n';
export const AFTER = `${BEFORE.replace('0.9', '0.8')}\nexport function round(price: number): number {\n  return Math.round(price);\n}\n`;
export const TEST = "import { applyDiscount } from '../src/total';\nit('discounts', () => applyDiscount(1));\n";

export const DISCOUNTS = { id: 'test/total.test.ts > discounts', file: 'test/total.test.ts', name: 'discounts', stopped: false };
export const ROUNDS = { id: 'test/total.test.ts > rounds', file: 'test/total.test.ts', name: 'rounds', stopped: false };
export const GONE = { id: 'test/round.test.ts > rounds up', file: 'test/round.test.ts', name: 'rounds up', stopped: false };

export function block(name: string, startLine: number, endLine: number, tests: readonly number[]): ExecutionBlock {
  return { kind: 'function', name, path: name, startLine, endLine, source: true, crossings: tests.map((test) => ({ test, distance: 0 })) };
}

export const git = (at: string, args: readonly string[]): string =>
  execFileSync('git', args, { cwd: at, stdio: 'pipe', encoding: 'utf8' }).trim();

/** `main` at the base, the change in the working tree, and the run after it recorded, over `text` of `src/total.ts`, the tree's own unless given. */
export async function changed(options: { readonly gone?: boolean; readonly suites?: readonly string[]; readonly text?: string } = {}): Promise<{ root: string; first: string; against: string }> {
  const root = await mkdtemp(join(tmpdir(), 'variance-review-'));
  await mkdir(join(root, 'src'));
  await mkdir(join(root, 'test'));
  git(root, ['init', '--quiet', '--initial-branch', 'main']);
  git(root, ['config', 'user.email', 'fixture@example.test']);
  git(root, ['config', 'user.name', 'Fixture']);
  await writeFile(join(root, 'src/total.ts'), BEFORE);
  await writeFile(join(root, 'test/total.test.ts'), TEST);
  await writeFile(join(root, 'config.json'), '{}\n');
  if (options.suites !== undefined) {
    const suites = Object.fromEntries(options.suites.map((name) => [name, { kind: 'unit' }]));
    await writeFile(join(root, 'variance.config.json'), JSON.stringify({ suites }));
  }
  git(root, ['add', '-A']);
  git(root, ['commit', '--quiet', '-m', 'first']);
  const first = git(root, ['rev-parse', 'HEAD']);

  await writeFile(join(root, 'src/total.ts'), AFTER);
  await writeFile(join(root, 'test/total.test.ts'), `${TEST}it('rounds', () => {});\n`);
  await writeFile(join(root, 'config.json'), '{ "strict": true }\n');
  process.chdir(root);
  // A test the run recorded and the tree no longer holds, so the import graph has no node for it.
  const extra = options.gone === true ? ['test/round.test.ts'] : [];

  await recordTotal(testCoverageFile(root, { suite: options.suites?.[0] }), {
    commit: first,
    ...(options.text === undefined ? {} : { text: options.text }),
    tests: [
      { file: 'test/total.test.ts', complete: true, preconditions: [{ name: 'config.json', digest: digestString('{}') }] },
      ...extra.map((file) => ({ file, complete: true, preconditions: [] })),
    ],
    entered: { applyDiscount: ['test/total.test.ts'], round: extra },
    index: {
      tests: [DISCOUNTS, ROUNDS, ...(extra.length === 0 ? [] : [GONE])],
      modules: [{ file: 'src/total.ts', blocks: [block('applyDiscount', 1, 3, [0]), block('round', 5, 7, extra.length === 0 ? [] : [2])] }],
    },
  });
  // What the pipeline's `variance index` step publishes after the run; under CI, review refuses to build it itself.
  await updateSourceIndex(root);

  // The base's record, copied aside before the run the way a pipeline does it.
  const against = join(await mkdtemp(join(tmpdir(), 'variance-review-base-')), 'coverage.bin');
  await writeTestCoverage(against, { version: 3, instrumentation: 'fixture', tests: [], modules: [] }, {
    index: encodeExecutionIndex({
      tests: [DISCOUNTS],
      modules: [{ file: 'src/total.ts', blocks: [block('applyDiscount', 1, 3, [0])] }],
    }),
    // The commit the base was recorded at, which the regions are paired through the diff from.
    last: Buffer.from(JSON.stringify({ commit: first, at: '2026-01-01T00:00:00.000Z', files: [], cases: [] })),
  });
  return { root, first, against };
}

/**
 * A second suite's record of the same change: `test/total.test.ts > rounds`
 * entered `round`, over `text` of `src/total.ts`, the tree's own unless given.
 */
export async function roundedBy(root: string, first: string, suite: string, text: string = AFTER): Promise<void> {
  await recordTotal(testCoverageFile(root, { suite }), {
    commit: first,
    text,
    tests: [{ file: 'test/total.test.ts', complete: true, preconditions: [] }],
    entered: { applyDiscount: [], round: ['test/total.test.ts'] },
    index: {
      tests: [ROUNDS],
      modules: [{ file: 'src/total.ts', blocks: [block('applyDiscount', 1, 3, []), block('round', 5, 7, [0])] }],
    },
  });
}

/**
 * A record of `src/total.ts` at `coverageFile`: `text` is the source it ran,
 * `entered` names the test files that entered each function, and `index` is the
 * case index the run wrote into it.
 */
async function recordTotal(coverageFile: string, record: {
  readonly commit: string;
  readonly text?: string;
  readonly tests: readonly { readonly file: string; readonly complete: boolean; readonly preconditions: readonly { readonly name: string; readonly digest: string }[] }[];
  readonly entered: { readonly applyDiscount: readonly string[]; readonly round: readonly string[] };
  readonly index: ExecutionIndex;
}): Promise<void> {
  await mkdir(dirname(coverageFile), { recursive: true });
  await writeTestCoverage(coverageFile, {
    version: 3,
    instrumentation: 'fixture',
    commit: record.commit,
    tests: record.tests,
    modules: [{
      file: 'src/total.ts',
      sourceDigest: digestString(record.text ?? AFTER),
      instrumented: true,
      blocks: [
        { ordinal: 0, kind: 'function', digest: digestString('applyDiscount'), name: 'applyDiscount', path: 'applyDiscount', startLine: 1, endLine: 3, source: true, testFiles: record.entered.applyDiscount },
        { ordinal: 1, kind: 'function', digest: digestString('round'), name: 'round', path: 'round', startLine: 5, endLine: 7, source: true, testFiles: record.entered.round },
      ],
    }],
  });
  await writeFile(coverageFile, withCaseSections(await readFile(coverageFile), { index: encodeExecutionIndex(record.index) }));
}
