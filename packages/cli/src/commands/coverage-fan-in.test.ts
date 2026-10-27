import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeExecutionIndex, testCoverageFile, writeTestCoverage, type FanInFile } from '@variance-authority/sense/test-selection';
import { main } from '../bin.js';
import { fanInLines, fanInMarkdown } from './coverage-fan-in-text.js';

type Index = Parameters<typeof encodeExecutionIndex>[0];

function region(name: string, tests: readonly number[]) {
  return {
    kind: 'function', name, path: `entry/${name}`, startLine: 1, endLine: 3, source: true,
    crossings: tests.map((test) => ({ test, distance: 1 })),
  };
}

function run(file: string, duration: number) {
  return { id: file, file, name: 'one', stopped: false, duration };
}

async function record(at: string, index: Index): Promise<void> {
  await mkdir(dirname(at), { recursive: true });
  await writeTestCoverage(at, { version: 3, instrumentation: 'fixture-instrumentation', tests: [], modules: [] }, { index: encodeExecutionIndex(index) });
}

async function ask(argv: readonly string[]) {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (text) => (out += text), err: (text) => (err += text) });
  return { code, out, err };
}

let cache: string;
let root: string;
let previous: string | undefined;

// Three unit test files and one story: `pay.ts` is entered by all four, its
// `charge` by three of them; `refund` rests on one; `Button.tsx` on the story.
beforeAll(async () => {
  cache = await mkdtemp(join(tmpdir(), 'variance-fan-in-cache-'));
  previous = process.env['VARIANCE_AUTHORITY_CACHE'];
  process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
  root = await mkdtemp(join(tmpdir(), 'variance-fan-in-'));
  execFileSync('git', ['init', '--quiet', root]);
  await writeFile(join(root, 'variance.config.json'), JSON.stringify({ suites: { unit: { kind: 'unit' }, stories: { kind: 'visual' } } }));
  await record(testCoverageFile(root, { suite: 'unit' }), {
    tests: [run('src/a.test.ts', 10), run('src/b.test.ts', 10), run('src/c.test.ts', 20)],
    modules: [{ file: 'src/pay.ts', blocks: [region('charge', [0, 1, 2]), region('refund', [2])] }],
  });
  await record(testCoverageFile(root, { suite: 'stories' }), {
    tests: [run('src/pay.stories.tsx', 5)],
    modules: [
      { file: 'src/pay.ts', blocks: [region('charge', []), region('refund', [])] },
      { file: 'src/Button.tsx', blocks: [region('Button', [0])] },
    ],
  });
});

afterAll(async () => {
  if (previous === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = previous;
  await rm(cache, { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
});

describe('coverage --fan-in', () => {
  it('prints, per kind, how many test files called into each region', async () => {
    const answer = await ask(['coverage', '--root', root, '--fan-in']);

    expect(answer.code).toBe(0);
    expect(answer.out).toContain('test files that called into each region');
    expect(answer.out).toMatch(/unit\s+3\s+2\s+1\s+50\.0%\s+1\s+3\s+3/u);
    expect(answer.out).toMatch(/visual\s+1\s+1\s+1\s+100\.0%\s+1\s+1\s+1/u);
    expect(answer.out).toMatch(/src\/pay\.ts\s+3\s+75\.0%\s+88\.9%\s+visual 0 · unit 3/u);
    expect(answer.out).toMatch(/selected whole beyond what its median region needs\n.*\n\s+src\/pay\.ts\s+2\s+3\s+1\s+3/u);
  });

  it('gives every file to a program', async () => {
    const answer = await ask(['coverage', '--root', root, '--fan-in', '--format', 'json']);

    const said = JSON.parse(answer.out) as { fanIn: { files: FanInFile[] } };
    expect(said.fanIn.files.map((one) => [one.file, one.entered, one.one])).toEqual([['src/Button.tsx', 1, 1], ['src/pay.ts', 3, 1]]);
  });

  it('counts nothing it was not asked for', async () => {
    const answer = await ask(['coverage', '--root', root, '--format', 'json']);

    expect(JSON.parse(answer.out)).not.toHaveProperty('fanIn');
  });
});

describe('the fan-in lists at size', () => {
  const file = (name: string, one: number, extra: Partial<FanInFile> = {}): FanInFile => ({
    file: name, regions: 20, run: 20, one, entered: one, peak: one, median: one, testFiles: 100, share: one / 100, ...extra,
  });
  const fanIn = (files: readonly FanInFile[]) => ({ kinds: [{ testFiles: 100, regions: 20, one: 1, median: 1, p90: 1, max: 1 }], files });

  it('names ten files per list, largest first and ties in code-unit order, and leaves a list with nothing in it out', () => {
    const files = Array.from({ length: 12 }, (_, at) => file(`src/f${String(at).padStart(2, '0')}.ts`, at < 2 ? 5 : at + 1));

    const lines = fanInLines(fanIn(files));

    const thin = lines.slice(lines.indexOf('most regions only one test file ran') + 2, lines.indexOf('most test files called into the file'));
    expect(thin).toHaveLength(10);
    expect(thin[0]).toMatch(/^ {2}src\/f11\.ts/u);
    expect(thin.findIndex((line) => line.includes('f00')) < thin.findIndex((line) => line.includes('f01'))).toBe(true);
    expect(lines).not.toContain('selected whole beyond what its median region needs');
  });

  it('prints the same lists for a pull request behind one disclosure', () => {
    const lines = fanInMarkdown(fanIn([file('src/a.ts', 2, { entered: 4, by: { unit: 4 } })]));

    expect(lines).toContain('| Kind | Test files | Regions ran | One test file |  | Median | p90 | Max |');
    expect(lines).toContain('|---|--:|--:|--:|--:|--:|--:|--:|');
    expect(lines).toContain('| the record | 100 | 20 | 1 | 5.0% | 1 | 1 | 1 |');
    expect(lines).toContain('**most test files called into the file**');
    expect(lines).toContain('| `src/a.ts` | 4 | 2.0% |  | unit 4 |');
    expect(lines.join('\n')).not.toMatch(/loaded/u);
    expect(lines.at(-1)).toBe('</details>');
    expect(lines).toContain('**selected whole beyond what its median region needs**');
    expect(fanInMarkdown(fanIn([file('src/a.ts', 2)]))).not.toContain('**selected whole beyond what its median region needs**');
  });

  it('says nothing when it was not asked', () => {
    expect(fanInLines(undefined)).toEqual([]);
    expect(fanInMarkdown(undefined)).toEqual([]);
  });
});
