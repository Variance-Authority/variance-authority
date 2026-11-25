import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Help } from '@variance-authority/package/help';
import * as sense from '@variance-authority/sense';
import { classify } from './classify.js';
import { classifyWords, wordsOf } from './classify-words.js';

/** The words of a request that are written as a file: a path, or a file's name with its extension. */

const HELP = {
  packages: [{ name: '@acme/sense', entry: true, openings: [{ subpath: './test-selection', source: 'packages/sense/src/test-selection.ts', entries: [], whole: [] }] }],
} as unknown as Help;

afterEach(() => vi.restoreAllMocks());

describe('the files a request spells', () => {
  it('looks up a path and a name with its extension, and neither an entrypoint nor a plain word', () => {
    const asked: string[][] = [];
    const read = classifyWords('fix lib/a/loader.ts, run_main.ts and sense/test-selection in loader', HELP, ['@acme/sense'], (words) => {
      asked.push([...words]);
      return new Map([
        ['lib/a/loader.ts', [{ kind: 'file', specifier: 'lib/a/loader.ts', file: 'lib/a/loader.ts', package: '', published: false }]],
      ]);
    });

    expect(asked).toEqual([['lib/a/loader.ts', 'run_main.ts']]);
    expect(read.entities.map((entity) => [entity.word, entity.names[0]?.kind])).toEqual([['lib/a/loader.ts', 'file'], ['sense/test-selection', 'entrypoint']]);
    expect(read.plain).toEqual(['fix', 'run_main.ts', 'and', 'in', 'loader']);
  });

  it('keeps what a path starts with, so the end of a path is never read as a name of its own', () => {
    expect(wordsOf('./a.ts ../lib/a.ts app/[id]/page.tsx **bold.ts** .eslintrc.js')).toEqual(['./a.ts', '../lib/a.ts', 'app', 'id', '/page.tsx', 'bold.ts', '.eslintrc.js']);
    expect(wordsOf('/checkoutPath ./checkoutPath. (ModuleLoader)')).toEqual(['checkoutPath', 'checkoutPath', 'ModuleLoader']);
  });

  it('says a spelled file was not looked up when no snapshot answers, rather than that it names nothing', () => {
    const refused = 'no source index was published';
    vi.spyOn(sense, 'packageLayers').mockReturnValue({ current: true, packages: [] });
    vi.spyOn(sense, 'classifyNames').mockReturnValue({ named: [], declared: [], refused });
    vi.spyOn(sense, 'classifiedAreas').mockReturnValue({ areas: [], reached: 0, unresolved: 0, refused });

    const text = classify.run(HELP, { query: 'lib/a/loader.ts run_main.ts fix' }, { root: '/unused' });

    expect(text).toContain('Not looked up: lib/a/loader.ts run_main.ts');
    expect(text).toContain('Not entities: fix');
  });

  it('asks for the import graph for a spelled file, as for an identifier', () => {
    expect(classify.wants?.({ query: 'fix lib/a/loader.ts' })).toBe(true);
    expect(classify.wants?.({ query: 'fix the loader' })).toBe(false);
  });
});
