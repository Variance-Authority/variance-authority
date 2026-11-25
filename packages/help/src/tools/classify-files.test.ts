import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Help } from '@variance-authority/package/help';
import * as sense from '@variance-authority/sense';
import { classify } from './classify.js';
import { classifyWords, unshownFiles, wordsOf, type Named } from './classify-words.js';

/** The words of a request that are written as a file: a path, or a file's name with its extension. */

const HELP = {
  packages: [{ name: '@acme/sense', entry: true, openings: [{ subpath: './test-selection', source: 'packages/sense/src/test-selection.ts', entries: [], whole: [] }] }],
} as unknown as Help;

afterEach(() => vi.restoreAllMocks());

describe('the files a request spells', () => {
  const file = (at: string, more?: number): Named => ({ kind: 'file', specifier: at, file: at, package: '', published: false, ...(more === undefined ? {} : { more }) });

  it('looks up a path and a name with its extension, a package or an entrypoint too, and no plain word', () => {
    const asked: string[][] = [];
    const read = classifyWords('fix lib/a/loader.ts, run_main.ts and sense/test-selection in loader', HELP, ['@acme/sense'], (words) => {
      asked.push([...words]);
      return new Map([['lib/a/loader.ts', [file('lib/a/loader.ts')]], ['sense/test-selection', [file('sense/test-selection')]]]);
    });

    expect(asked).toEqual([['lib/a/loader.ts', 'run_main.ts', 'sense/test-selection']]);
    expect(read.entities.map((entity) => [entity.word, entity.names.map((named) => named.kind)])).toEqual([['lib/a/loader.ts', ['file']], ['sense/test-selection', ['entrypoint', 'file']]]);
    expect(read.plain).toEqual(['fix', 'run_main.ts', 'and', 'in', 'loader']);
  });

  it('lists what a file name names, with its count, after a path that names one of them', () => {
    const read = classifyWords('a/index.ts and index.ts', HELP, [], () => new Map([['a/index.ts', [file('a/index.ts')]], ['index.ts', [file('a/index.ts', 4)]]]));

    expect(read.entities.map((entity) => [entity.word, entity.names.map((named) => [named.specifier, named.more])])).toEqual([['a/index.ts', [['a/index.ts', undefined]]], ['index.ts', [['a/index.ts', 4]]]]);
    expect(unshownFiles(read)).toEqual([{ word: 'index.ts', more: 4 }]);
  });

  it('keeps a path whole, so a part of one is never read as a name of its own', () => {
    const paths = ['./a.ts', '../lib/a.ts', '.eslintrc.js', 'src/routes/+page.ts', 'lib\\page.ts', 'app/[id]/page.tsx', 'app/[id]-page.tsx', '[id].tsx', 'String+Extensions.swift', '*loader.ts', 'lib/**', '@acme/sense', 'lib/~a%b.ts'];

    expect(wordsOf(paths.join(' '))).toEqual(paths);
  });

  it('drops the punctuation a sentence puts around a word', () => {
    expect(wordsOf('/checkoutPath ./checkoutPath. (ModuleLoader) foo+bar @types half-done-')).toEqual(['checkoutPath', 'checkoutPath', 'ModuleLoader', 'foo', 'bar', '@types', 'half-done']);
    expect(wordsOf('**a.ts**. *b.ts*, `c.ts`: “d.ts” e.ts… f.ts—g.ts 看、h.ts。')).toEqual(['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts', 'g.ts', '看', 'h.ts']);
    expect(wordsOf('[lib/a.ts](x) [lib/b.ts lib/c.ts] [app/[id]/page.tsx]. [x]')).toEqual(['lib/a.ts', 'x', 'lib/b.ts', 'lib/c.ts', 'app/[id]/page.tsx', 'x']);
    expect(wordsOf('lib/a.ts:12 lib/b.ts#L10 --file=lib/c.ts - ../.. **')).toEqual(['lib/a.ts', '12', 'lib/b.ts', 'L10', 'file', 'lib/c.ts']);
  });

  it.each(['/', './', '-', '*', '[', '+'])('reads a long run of %s in linear time', (mark) => {
    const started = performance.now();
    wordsOf(`a${mark.repeat(200_000)}b`);
    wordsOf(`${mark.repeat(200_000)}b`);

    expect(performance.now() - started).toBeLessThan(1_000);
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
