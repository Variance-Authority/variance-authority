import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Help } from '@variance-authority/package/help';
import * as sense from '@variance-authority/sense';
import { classify } from './classify.js';
import { classifyWords, unshownFiles, type Named } from './classify-words.js';

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

  /** What a request's words name among these files and names, as `classify` lists the words. */
  const FILES = ['lib/a.ts', 'lib/b.ts', 'a.ts', 'page.tsx', 'loader.ts', 'photo/page.tsx', 'app/[id]/page.tsx', 'app/[id]-page.tsx', '[id].tsx', 'docs/[[...slug]].tsx', 'src/routes/+page.ts', 'String+Extensions.swift', '.eslintrc.js', 'lib/~a%b.ts'];
  const DECLARED = ['ModuleLoader', 'checkoutPath'];
  const read = (text: string) => classifyWords(text, HELP, ['@acme/sense'], (words) => new Map(words.flatMap((word) => {
    const files = FILES.filter((at) => at === word.replace(/^\.\//u, '') || (!word.includes('/') && word.includes('.') && at.endsWith(`/${word}`)));
    const declared = DECLARED.filter((name) => name === word).map((name): Named => ({ ...file(`src/${name}.rs`), kind: 'declared' }));
    return files.length + declared.length === 0 ? [] : [[word, [...declared, ...files.map((at) => file(at))]]];
  })));
  const named = (text: string): readonly string[] => read(text).entities.map((entity) => entity.word);

  it.each([
    ['**Files: lib/b.ts, lib/a.ts**', ['lib/b.ts', 'lib/a.ts']],
    ['**lib/a.ts:** x', ['lib/a.ts']],
    ['**[lib/a.ts](x)** [lib/b.ts][1]', ['lib/a.ts', 'lib/b.ts']],
    ['*see lib/a.ts* or *lib/b.ts*', ['lib/a.ts', 'lib/b.ts']],
    ['~~lib/a.ts~~ •lib/b.ts', ['lib/a.ts', 'lib/b.ts']],
    ['lib/a.ts→lib/b.ts', ['lib/a.ts', 'lib/b.ts']],
    ['lib/a.ts​, “lib/b.ts”…', ['lib/a.ts', 'lib/b.ts']],
    ['(lib/a.ts) [lib/b.ts loader.ts].', ['lib/a.ts', 'lib/b.ts', 'loader.ts']],
    ['lib/a.ts:12 lib/b.ts#L10 --file=loader.ts', ['lib/a.ts', 'lib/b.ts', 'loader.ts']],
    ['[loader.ts](x), ./lib/a.ts. [lib/b.ts]', ['loader.ts', './lib/a.ts', 'lib/b.ts']],
    ['app/[id]/page.tsx app/[id]-page.tsx [id].tsx docs/[[...slug]].tsx', ['app/[id]/page.tsx', 'app/[id]-page.tsx', '[id].tsx', 'docs/[[...slug]].tsx']],
    ['src/routes/+page.ts String+Extensions.swift .eslintrc.js lib/~a%b.ts', ['src/routes/+page.ts', 'String+Extensions.swift', '.eslintrc.js', 'lib/~a%b.ts']],
  ])('finds the files in %j', (text, words) => {
    expect(named(text)).toEqual(words);
  });

  it.each(['../lib/a.ts', '/lib/a.ts', 'x/lib/a.ts', 'lib\\a.ts', '*loader.ts', 'lib/**/loader.ts', 'https://x.y/lib/a.ts', '~/lib/a.ts', 'x+loader.ts', 'app/(.)photo/page.tsx', 'src/{loader.ts,a.ts}', '(shop)/page.tsx'])('names no file by a part of %s', (text) => {
    expect(named(text)).toEqual([]);
  });

  it.each([
    ['**Refactor ModuleLoader.**', 'ModuleLoader'],
    ['**Upgrade @acme/sense**', '@acme/sense'],
    ['**[@acme/sense](https://x.y)**', '@acme/sense'],
    ['[@acme/sense][1]', '@acme/sense'],
    ['bump @acme/sense/*', '@acme/sense'],
    ['ModuleLoader.\\nThen load', 'ModuleLoader'],
    ['ModuleLoader[0].load ModuleLoader→x.y', 'ModuleLoader'],
    ['./checkoutPath /checkoutPath', 'checkoutPath'],
    ['./sense/test-selection', 'sense/test-selection'],
  ])('still finds the name in %j', (text, word) => {
    expect(named(text)).toEqual([word]);
  });

  it('reads the words of a text that spells no file as they are written, a path as one of them', () => {
    expect(read('fix (missing/x.ts), foo+bar and half-done- [x] *gone.ts - ../.. **').plain).toEqual(['fix', 'missing/x.ts', 'foo', 'bar', 'and', 'half-done', 'x', 'gone.ts']);
  });

  it.each(['/', './', '-', '*', '[', '[a', '+', '~', '(', ']'])('reads a long run of %s in linear time', (mark) => {
    const started = performance.now();
    read(`a${mark.repeat(200_000)}b`);
    read(`${mark.repeat(200_000)}b`);

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

  it('asks for the import graph for what several files can answer: a file name or an identifier, and no path', () => {
    expect(classify.wants?.({ query: 'fix loader.ts' })).toBe(true);
    expect(classify.wants?.({ query: 'fix lib/a/loader.ts' })).toBe(false);
    expect(classify.wants?.({ query: 'fix ModuleLoader' })).toBe(true);
    expect(classify.wants?.({ query: 'fix the loader' })).toBe(false);
  });
});
