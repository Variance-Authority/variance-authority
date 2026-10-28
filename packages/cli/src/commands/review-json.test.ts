import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { main } from '../bin.js';
import { REVIEW_JSON_VERSION, reviewJson, reviewOfJson } from './review-json.js';
import { reviewPieces } from './review-text.js';
import type { Review, ReviewCase, ReviewFile } from './review.js';

// The review is cut at what the command prints: what it read is pinned by the
// tests of `review`, and this one asks only how the answer reaches the reader.
const answer = vi.hoisted(() => ({ current: undefined as Review | undefined }));
vi.mock('./review-evidence.js', () => ({ reviewWithCoverage: async () => answer.current }));

/** Cases a change's every region was entered by, as a suite's hub file is: each region lists all of them. */
function hub(files: number, regions: number, cases: number): Review {
  const called: ReviewCase[] = Array.from({ length: cases }, (_, at) => {
    const file = `test/hub-${String(at).padStart(3, '0')}.test.ts`;
    return { id: `${file} > reads the hub`, file, name: 'reads the hub', preconditions: [] };
  });
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
  it('names each case once, and a region names the cases that entered it by their place in that list', async () => {
    answer.current = hub(40, 5, 60);
    let printed = '';

    const code = await main(['review', '--since', 'cc25d6a6', '--format', 'json'], { out: (text) => (printed += text), err: () => {} });

    expect(code).toBe(0);
    const kept = JSON.parse(printed);
    expect(kept.version).toBe(REVIEW_JSON_VERSION);
    expect(kept.cases).toEqual(answer.current.files[0]!.regions![0]!.called);
    expect(kept.files[0].regions[0]).toEqual({
      kind: 'function', name: 'read0', startLine: 1, endLine: 3, reach: 'far', edit: 'modified',
      cases: 60, changedLineCases: 60, called: Array.from({ length: 60 }, (_, at) => at),
    });
    // 200 regions each entered by all 60 cases spell each case's id once, not 200 times.
    expect(printed.split('test/hub-007.test.ts > reads the hub')).toHaveLength(2);
    expect(reviewOfJson(kept)).toEqual(answer.current);
  });

  it('writes the answer as it serializes, never as one string holding every region', async () => {
    answer.current = hub(40, 5, 60);
    const writes: string[] = [];
    let err = '';

    const code = await main(['review', '--since', 'cc25d6a6', '--format', 'json'], { out: (text) => void writes.push(text), err: (text) => (err += text) });

    expect(err).toBe('');
    expect(code).toBe(0);
    const printed = writes.join('');
    expect(printed).toBe(`${JSON.stringify(reviewJson(answer.current), undefined, 2)}\n`);
    // Written in batches, no write holds the whole answer, whatever it weighs.
    expect(Math.max(...writes.map((write) => write.length))).toBeLessThan(printed.length / 2);
  });

  it('writes a file a region at a time, so one file never spells the answer alone', () => {
    const one = hub(1, 400, 60);
    const pieces = [...reviewPieces(one, 'json')];
    const file = JSON.stringify(reviewJson(one).files[0], undefined, 2);

    expect(pieces.join('')).toBe(`${JSON.stringify(reviewJson(one), undefined, 2)}\n`);
    expect(Math.max(...pieces.map((piece) => piece.length))).toBeLessThan(file.length / 10);
  });

  it('saves the same answer it prints when given a directory', async () => {
    answer.current = hub(40, 5, 60);
    const kept = await mkdtemp(join(tmpdir(), 'variance-review-json-'));
    const out = join(kept, 'review');
    let printed = '';

    const code = await main(['review', '--since', 'cc25d6a6', '--format', 'json', '--out', out], { out: (text) => (printed += text), err: () => {} });

    expect(code).toBe(0);
    expect(await readFile(join(out, 'review.json'), 'utf8')).toBe(printed);
    expect(reviewOfJson(JSON.parse(printed))).toEqual(answer.current);
    await rm(kept, { recursive: true, force: true });
  });
});

describe('a review.json read back', () => {
  it('reads one written before cases were named once as the review it is', () => {
    const before = hub(2, 2, 3);
    expect(reviewOfJson(JSON.parse(JSON.stringify(before)))).toEqual(before);
  });

  it('names the version it cannot read rather than misread a newer one', () => {
    const newer = { ...reviewJson(hub(1, 1, 1)), version: 3 };
    expect(() => reviewOfJson(newer as never)).toThrow(/version 3, written by a newer variance/);
  });

  it('places the cases by file, title and id, so a review over the same cases gives each the same place', () => {
    const twin = (id: string): ReviewCase => ({ id, file: 'test/a.test.ts', name: 'twice' });
    const region = { kind: 'function', startLine: 1, endLine: 2, reach: 'far', edit: 'modified', changedLineCases: 0, tests: ['test/a.test.ts'] } as const;
    const review: Review = {
      from: 'cc25d6a6', base: 'since', record: 'ran',
      files: [{ file: 'src/a.ts', regions: [
        { ...region, name: 'b', cases: 2, called: [twin('a#2'), twin('a#1')] },
        { ...region, name: 'c', cases: 1, called: [twin('a#2')] },
      ] }],
    };

    const kept = reviewJson(review);

    expect(kept.cases.map((test) => test.id)).toEqual(['a#1', 'a#2']);
    expect(kept.files[0]!.regions!.map((written) => written.called)).toEqual([[0, 1], [1]]);
    // Read back, a region lists its cases in the review's order, whatever order it was handed them in.
    const read = reviewOfJson(JSON.parse(JSON.stringify(kept)));
    expect(read.files[0]!.regions![0]!.called.map((test) => test.id)).toEqual(['a#1', 'a#2']);
    expect(read.files[0]!.regions![1]).toEqual(review.files[0]!.regions![1]);
  });
});
