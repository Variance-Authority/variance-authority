import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The review action's `diff-marks.mjs` turns the review it posted into a
 * warning at each changed line no test ran. Each case runs the script on a
 * review file, as the step runs it.
 */

const ROOT = resolve(import.meta.dirname, '..');
const FOLDER = '.github/actions/variance';

describe('the marks a review puts on the diff', () => {
  const region = (name: string, startLine: number, endLine: number, reach: string, kind = 'function') =>
    ({ kind, name, startLine, endLine, reach });

  /** What the script prints for a review of `files`, read from a `record` of that age. */
  async function marks(files: readonly unknown[], record = 'ran'): Promise<readonly string[]> {
    const at = await mkdtemp(join(tmpdir(), 'variance-diff-marks-'));
    try {
      await writeFile(join(at, 'review.json'), JSON.stringify({ record, files }));
      return execFileSync('node', [join(ROOT, FOLDER, 'diff-marks.mjs'), join(at, 'review.json')], { encoding: 'utf8' })
        .split('\n')
        .filter((line) => line !== '');
    } finally {
      await rm(at, { recursive: true, force: true });
    }
  }

  it('marks each changed function no case covered, at its lines, and nothing a case ran or may have', async () => {
    const regions = [
      region('parse', 3, 9, 'hole'),
      region('walk', 12, 20, 'unwalked'),
      region('guess', 22, 24, 'unknown'),
      region('ran', 30, 34, 'near'),
      region('far', 36, 40, 'far'),
      region('rewritten', 42, 44, 'overwritten'),
      region('ran/if', 31, 32, 'hole', 'branch'),
      region('', 1, 50, 'hole', 'module'),
    ];

    expect(await marks([{ file: 'src/a.ts', regions }, { file: 'README.md' }])).toEqual([
      '::warning file=src/a.ts,line=3,endLine=9,title=No run of this change covered this::`parse` changed, and no case that ran this change covered it.',
      '::warning file=src/a.ts,line=12,endLine=20,title=No run of this change covered this::`walk` changed, and no case that ran this change covered it.',
      '::warning file=src/a.ts,line=22,endLine=24,title=No run of this change covered this::`guess` changed, and no case that ran this change covered it.',
    ]);
  });

  it('marks a function once, not again for each function inside it', async () => {
    const regions = [region('outer/inner', 4, 6, 'hole'), region('outer', 2, 9, 'hole'), region('next', 9, 12, 'hole')];

    expect((await marks([{ file: 'a.ts', regions }])).map((mark) => /line=(\d+)/.exec(mark)?.[1])).toEqual(['2', '9']);
  });

  it('marks the lines the change wrote, which the diff shows, not the whole function', async () => {
    const written = [{ start: 1, end: 1 }, { start: 40, end: 41 }, { start: 58, end: 70 }];
    const regions = [region('long', 30, 60, 'hole')];

    expect((await marks([{ file: 'a.ts', written, regions }])).map((mark) => /line=\d+,endLine=\d+/.exec(mark)?.[0])).toEqual(['line=40,endLine=41']);
  });

  it('marks two functions that share their lines, one inside neither', async () => {
    const regions = [region('first', 3, 3, 'hole'), region('second', 3, 3, 'hole')];

    expect((await marks([{ file: 'a.ts', regions }])).map((mark) => /`(\w+)`/.exec(mark)?.[1])).toEqual(['first', 'second']);
  });

  it('calls a function with no name by what it is', async () => {
    const [mark] = await marks([{ file: 'a.ts', regions: [region('', 3, 4, 'hole')] }]);

    expect(mark).toContain('::A function changed, and no case that ran this change covered it.');
  });

  it('stops at the ten warnings GitHub shows for a step, and names how many it left out', async () => {
    const regions = Array.from({ length: 12 }, (_, at) => region(`f${at}`, at * 10 + 1, at * 10 + 5, 'hole'));
    const printed = await marks([{ file: 'a.ts', regions }]);

    expect(printed.filter((mark) => mark.startsWith('::warning '))).toHaveLength(10);
    expect(printed.at(-1)).toBe('::notice title=No run of this change covered these::2 more changed functions no case that ran this change covered: the review lists them.');
  });

  it('marks a file another suite ran as the tree holds it, under a named suite whose record is older', async () => {
    const regions = [region('parse', 3, 9, 'hole')];
    expect((await marks([{ file: 'a.ts', ran: true, regions }, { file: 'b.ts', regions }], 'before')).map((mark) => /file=([\w.]+)/.exec(mark)?.[1])).toEqual(['a.ts']);
  });

  it('marks nothing from a record older than the change, which has not run what the change wrote', async () => {
    expect(await marks([{ file: 'a.ts', regions: [region('parse', 3, 9, 'hole')] }], 'before')).toEqual([]);
  });

  it('escapes what a workflow command reads as its own syntax', async () => {
    const [mark] = await marks([{ file: 'src/a,b:c%.ts', regions: [region('100%', 1, 2, 'hole')] }]);

    expect(mark).toBe('::warning file=src/a%2Cb%3Ac%25.ts,line=1,endLine=2,title=No run of this change covered this::`100%25` changed, and no case that ran this change covered it.');
  });
});
