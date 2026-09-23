import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FileRecord } from '@variance-authority/mcp/tools';
import { treeOf } from '@variance-authority/mcp/tools';
import { readHelp } from '@variance-authority/package/help';
import { searchNames } from '../tools.js';
import { searchIndexOf } from './search.js';

/**
 * `search` as data: the fields the text is written from, and the difference
 * between a section that was not run and one that ran and found nothing.
 */

const WORKSPACE = join(dirname(fileURLToPath(import.meta.url)), '../__fixtures__/workspace');
const INDEX = searchIndexOf(readHelp(WORKSPACE));

const reads = (file: string, ...to: readonly string[]): FileRecord =>
  to.length === 0 ? { file } : { file, edges: to.map((target) => ({ to: target, kind: 'imports' as const })) };

const TREE = treeOf(
  [
    reads('packages/alpha/src/values.ts'),
    reads('packages/alpha/src/deep.ts'),
    reads('packages/alpha/src/index.ts', 'packages/alpha/src/values.ts'),
    reads('packages/beta/src/index.ts', 'packages/alpha/src/index.ts', 'packages/alpha/src/deep.ts'),
    reads('packages/beta/src/again.ts', 'packages/alpha/src/index.ts'),
    reads('packages/beta/src/inner/deeper.ts', 'packages/alpha/src/deep.ts'),
  ] satisfies readonly FileRecord[],
  WORKSPACE,
);

describe('searchNames', () => {
  it('gives a published name its specifier, declaring file and repository counts', () => {
    const answer = searchNames(INDEX, { query: 'Measure' });
    expect(answer.query).toBe('measure');
    const measure = answer.published?.shown.find((match) => match.name === 'measure');
    expect(measure).toMatchObject({ source: 'published', specifier: expect.any(String), at: expect.any(String) });
    expect(measure?.packages).toBeGreaterThan(0);
    expect(measure?.inArea).toBeUndefined();
    expect(answer.area).toBeUndefined();
    // The substring answered, so the loose pass was never run — absent, not empty.
    expect(answer.loose).toBeUndefined();
  });

  it('counts the area and what each name is used for inside it', () => {
    const answer = searchNames(INDEX, { query: 'e', from: 'packages/beta/src/again.ts' }, TREE);
    expect(answer.area?.from).toEqual(['packages/beta/src/again.ts']);
    expect(answer.published?.shown.length).toBeGreaterThan(0);
    for (const match of answer.published?.shown ?? []) {
      expect(match.inArea?.files).toBeGreaterThan(0);
      expect(match.inArea?.filesByDistance.length).toBeGreaterThan(0);
    }
    // `measure` is in the barrel `again.ts` imports, and `again.ts` never imports it.
    expect(answer.published?.shown.map((match) => match.name)).not.toContain('measure');
  });

  it('says it looked loosely and found nothing, as an empty section rather than a missing one', () => {
    const answer = searchNames(INDEX, { query: 'nothing-is-called-this' });
    expect(answer.published).toEqual({ total: 0, shown: [] });
    expect(answer.exported).toEqual({ total: 0, shown: [] });
    expect(answer.loose).toEqual({ total: 0, shown: [] });
  });

  it('marks what the loose pass added by where it came from', () => {
    const loose = searchNames(INDEX, { query: 'meesure' }).loose;
    expect(loose?.shown.some((match) => match.name === 'measure')).toBe(true);
    expect(loose?.total).toBeGreaterThanOrEqual(loose?.shown.length ?? 0);
  });

  it('refuses a start point that does not resolve, and searches nothing', () => {
    const answer = searchNames(INDEX, { query: 'measure', from: 'packages/nowhere/' }, TREE);
    expect(answer.refused).toEqual(expect.any(String));
    expect(answer.published).toBeUndefined();
    expect(answer.exported).toBeUndefined();
    expect(answer.loose).toBeUndefined();
  });
});
