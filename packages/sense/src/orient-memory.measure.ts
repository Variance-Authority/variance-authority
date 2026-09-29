import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { recordedCases } from './orient.js';
import { updateSourceIndex } from './published.js';
import { CrossingSets } from './test-selection/crossing-sets.js';
import { encodeSetExecutionIndex } from './test-selection/execution-set-format.js';
import { testCoverageFile } from './test-selection/record-location.js';

// compass: variance-authority.reach.relations

/**
 * A long-lived server answers orientation questions for as long as it runs, and
 * every one reads the recording's per-case index and the source index. Neither
 * read may leave anything behind: a question that kept a few megabytes of
 * either would be a server that grows until it is restarted, and no single
 * question would show it.
 *
 * So this asks the same kind of question many times in one process, over a
 * recording of several megabytes whose modules all ran while they loaded, which
 * is the path that reads the importers too, and compares what the process holds
 * in the first third of the run with the last. Resident size is sampled after
 * each question; a third's figure is the mean of its samples, so one question
 * that happened to land on a collection does not decide it. The bound is small
 * against the recording and large against the noise of an allocator that keeps
 * pages it has been given: a question that kept its recording would move it by
 * the recording's size, several times over.
 */

const QUESTIONS = 300;
const TESTS = 20000;
const MODULES = 800;
const BLOCKS = 12;
const ASKED = 8;
const BOUND_MEGABYTES = 16;

const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

const megabytes = (bytes: number): number => bytes / (1 << 20);
const mean = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

/** Every module ran while it loaded, and each region was called by a spread of the cases. */
function recording(): Buffer {
  const sets = new CrossingSets(TESTS);
  const tests = Array.from({ length: TESTS }, (_, at) => ({ id: `case ${at}`, file: `test/t${at % 400}.test.ts`, name: `case ${at}` }));
  const modules = Array.from({ length: MODULES }, (_, module) => ({
    file: `src/m${module}.ts`,
    blocks: Array.from({ length: BLOCKS }, (_, block) => ({
      kind: block === 0 ? 'module' : 'function', name: `f${block}`, path: `f${block}`, startLine: block * 4 + 1, endLine: block * 4 + 4, source: true,
    })),
    called: Uint32Array.from({ length: BLOCKS }, (_, block) =>
      sets.intern(Array.from({ length: 1500 }, (_, member) => ((Math.imul(member + 1, 2654435761) ^ Math.imul(module * BLOCKS + block + 1, 40503)) >>> 0) % TESTS))),
    loaded: Uint8Array.from({ length: BLOCKS }, (_, block) => (block === 0 ? 1 : 0)),
  }));
  return encodeSetExecutionIndex({ tests, modules, sets: sets.pool() });
}

describe('orientation in a process that keeps answering', () => {
  it('holds no more memory in the last third of many questions than in the first', async () => {
    const root = mkdtempSync(join(tmpdir(), 'va-orient-memory-'));
    roots.push(root);
    process.env['VARIANCE_AUTHORITY_CACHE'] = join(root, 'cache');
    const checkout = join(root, 'checkout');
    mkdirSync(checkout);
    execFileSync('git', ['init', '--quiet', checkout]);
    // The source index holds a file per recorded module, and the tests that import some of them.
    const files: Record<string, string> = { 'package.json': JSON.stringify({ name: 'fixture' }) };
    for (let module = 0; module < MODULES; module++) files[`src/m${module}.ts`] = `export const m${module} = ${module};\n`;
    for (let test = 0; test < 400; test++) {
      files[`test/t${test}.test.ts`] = `import { m${test} } from '../src/m${test}.js';\nexport const t${test} = m${test};\n`;
    }
    for (const [file, source] of Object.entries(files)) {
      mkdirSync(dirname(join(checkout, file)), { recursive: true });
      writeFileSync(join(checkout, file), source);
    }
    execFileSync('git', ['add', '.'], { cwd: checkout });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'fixture'], { cwd: checkout });
    await updateSourceIndex(checkout);
    const at = `${testCoverageFile(checkout)}.cases.bin`;
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, recording());
    const size = megabytes(statSync(at).size);

    const held: number[] = [];
    let named = 0;
    for (let question = 0; question < QUESTIONS; question++) {
      const asked = Array.from({ length: ASKED }, (_, file) => `src/m${(question * ASKED + file) % MODULES}.ts`);
      const [suite] = recordedCases(checkout, asked, 3);
      named += suite !== undefined && 'files' in suite ? suite.files.filter((file) => (file.loaders ?? 0) > 0).length : 0;
      held.push(process.memoryUsage().rss);
    }
    const third = QUESTIONS / 3;
    const early = mean(held.slice(0, third));
    const late = mean(held.slice(-third));
    console.log(
      `orient memory: ${QUESTIONS} questions over a ${size.toFixed(1)} MB recording; ` +
        `first third ${megabytes(early).toFixed(0)} MB, last third ${megabytes(late).toFixed(0)} MB, ` +
        `${(megabytes(late - early)).toFixed(1)} MB more`,
    );

    expect(named, 'questions that read the importers').toBeGreaterThan(0);
    expect(megabytes(late - early), 'resident memory added between the first and last third').toBeLessThan(BOUND_MEGABYTES);
  }, 300_000);
});
