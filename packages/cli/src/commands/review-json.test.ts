import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { main } from '../bin.js';
import type { Review, ReviewCase, ReviewFile } from './review.js';

// The review is cut at what the command prints: what it read is pinned by the
// tests of `review`, and this one asks only how the answer reaches the reader.
const answer = vi.hoisted(() => ({ current: undefined as Review | undefined }));
vi.mock('./review-evidence.js', () => ({ reviewWithCoverage: async () => answer.current }));

/** Cases a change's every region was entered by, as a suite's hub file is: each region lists all of them. */
function hub(files: number, regions: number, cases: number): Review {
  const called: ReviewCase[] = Array.from({ length: cases }, (_, at) => ({
    id: `test/hub-${at}.test.ts > reads the hub`, file: `test/hub-${at}.test.ts`, name: 'reads the hub', preconditions: [],
  }));
  const changed: ReviewFile[] = Array.from({ length: files }, (_, file) => ({
    file: `src/hub-${file}.ts`, verdict: 'bodies', recorded: true,
    regions: Array.from({ length: regions }, (_, region) => ({
      kind: 'function', name: `read${region}`, startLine: region * 3 + 1, endLine: region * 3 + 3, reach: 'far', edit: 'modified',
      cases, changedLineCases: cases, tests: called.map((test) => test.file), called,
    })),
  }));
  return { from: 'cc25d6a6', base: 'since', record: 'ran', files: changed, suite: cases };
}

describe('review --format json', () => {
  it('writes the answer as it serializes, never as one string holding every region', async () => {
    answer.current = hub(40, 5, 60);
    const writes: string[] = [];
    let err = '';

    const code = await main(['review', '--since', 'cc25d6a6', '--format', 'json'], { out: (text) => void writes.push(text), err: (text) => (err += text) });

    expect(err).toBe('');
    expect(code).toBe(0);
    const printed = writes.join('');
    expect(JSON.parse(printed)).toEqual(answer.current);
    expect(printed).toBe(`${JSON.stringify(answer.current, undefined, 2)}\n`);
    // A review that moved most of a suite's regions spells more text than V8
    // holds in one string, which is a `RangeError: Invalid string length` the
    // reader gets instead of the answer. Written in batches, no write holds the
    // whole answer, whatever it weighs.
    expect(Math.max(...writes.map((write) => write.length))).toBeLessThan(printed.length / 2);
  });

  it('saves the same answer it prints when given a directory', async () => {
    answer.current = hub(40, 5, 60);
    const out = join(await mkdtemp(join(tmpdir(), 'variance-review-json-')), 'review');
    let printed = '';

    const code = await main(['review', '--since', 'cc25d6a6', '--format', 'json', '--out', out], { out: (text) => (printed += text), err: () => {} });

    expect(code).toBe(0);
    expect(await readFile(join(out, 'review.json'), 'utf8')).toBe(printed);
    expect(JSON.parse(printed)).toEqual(answer.current);
  });
});
