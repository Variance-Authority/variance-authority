import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Documented, Entry, Help } from '@variance-authority/package/help';
import { HELP_TOOLS } from '../tools.js';
import { classify } from './classify.js';
import { classifyWords, formatClassified, type CodeMapPlaces } from './classify-words.js';

/**
 * `docs_classify`: which words of the asker's own sentence are, whole, a
 * package, an entrypoint or an exported name, each placed on the code map.
 * The packages are the map's, the entrypoints and exports what the workspace
 * publishes; a word is a name or it is not, and a word that is only part of a
 * name is not one.
 */

const entry = (name: string, at: string): Entry => ({
  name, kind: 'function', at, declared: name, line: 1, usedBy: [], uses: 0, sites: [], throughDefault: [],
});

const published = (name: string, exported: readonly string[], subpaths: readonly string[] = []): Documented => {
  const directory = `packages/${name.slice('@acme/'.length)}`;
  return {
    name,
    entry: true,
    openings: [
      { subpath: '.', source: `${directory}/src/index.ts`, entries: exported.map((one) => entry(one, `${directory}/src/${one}.ts`)), whole: [] },
      ...subpaths.map((subpath) => ({ subpath: `./${subpath}`, source: `${directory}/src/${subpath}.ts`, entries: [], whole: [] })),
    ],
  } as unknown as Documented;
};

const HELP = {
  packages: [
    published('@acme/sense', ['checkoutPath', 'eyes'], ['test-selection']),
    published('@acme/eyes', ['Check']),
    published('@acme/vantage', ['attachVantage']),
  ],
} as unknown as Help;

const PLACED: CodeMapPlaces = {
  current: true,
  packages: new Map([
    ['@acme/sense', { area: { id: '4', name: 'around core, sense' }, layer: 3 }],
    ['@acme/eyes', { area: { id: '5', name: 'png' }, layer: 2 }],
    ['@acme/vantage', { area: { id: '10', name: 'vantage wire event' }, layer: 1 }],
  ]),
};

const MAPPED = [...PLACED.packages.keys()];

const ASKED = 'hey can you check if sense can see eyes via vantage';

describe('docs_classify', () => {
  it('names the packages among the words, each with its area and layer, and the rest on one line', () => {
    const text = formatClassified(classifyWords(ASKED, HELP, MAPPED), PLACED);

    expect(text).toMatch(/^sense — package @acme\/sense · area 4 around core, sense · layer 3$/m);
    expect(text).toMatch(/^eyes — package @acme\/eyes · area 5 png · layer 2$/m);
    expect(text).toMatch(/^vantage — package @acme\/vantage · area 10 vantage wire event · layer 1$/m);
    expect(text).toMatch(/^Not entities: hey can you check if see via$/m);
  });

  it('does not take a word that is only part of a name, nor an export spelled in another case', () => {
    const { entities } = classifyWords('check the checkout', HELP, MAPPED);

    expect(entities).toEqual([]);
  });

  it('lists a word that is a package and an exported name once, the package first', () => {
    const { entities } = classifyWords('eyes and eyes again', HELP, MAPPED);

    expect(entities).toHaveLength(1);
    expect(entities[0]?.names.map((named) => `${named.kind} ${named.specifier}`)).toEqual([
      'package @acme/eyes',
      'export @acme/sense',
    ]);
  });

  it('lists a package written in two cases once, as first written', () => {
    const { entities } = classifyWords('sense and Sense', HELP, MAPPED);

    expect(entities.map((found) => found.word)).toEqual(['sense']);
  });

  it('names an export that shares a package\'s letters in another case, whichever is written first', () => {
    const help = { packages: [...HELP.packages, published('@acme/kernel', ['Sense'])] } as unknown as Help;
    const listed = (text: string) => classifyWords(text, help, MAPPED).entities
      .flatMap(({ names }) => names.map((named) => `${named.kind} ${named.specifier}`)).sort();

    expect(listed('sense Sense')).toEqual(['export @acme/kernel', 'package @acme/sense']);
    expect(listed('Sense sense')).toEqual(['export @acme/kernel', 'package @acme/sense']);
  });

  it('asks the next question of everything a word names, not only the first', () => {
    const text = formatClassified(classifyWords('eyes', HELP, MAPPED), PLACED);

    expect(text).toContain('variance ask entrypoint --package @acme/eyes');
    expect(text).toContain('variance ask symbol --name eyes');
  });

  it('takes an entrypoint, a scoped name and an exported identifier whole, in the asker\'s punctuation', () => {
    const { entities } = classifyWords('does sense/test-selection call attachVantage, from @acme/vantage?', HELP, MAPPED);

    expect(entities.map((found) => `${found.word}: ${found.names.map((named) => named.kind).join(', ')}`)).toEqual([
      'sense/test-selection: entrypoint',
      'attachVantage: export',
      '@acme/vantage: package',
    ]);
  });

  it('names a package the code map holds that publishes nothing', () => {
    const { entities } = classifyWords('is case-runner in a layer', HELP, [...MAPPED, 'case-runner']);

    expect(entities.map((found) => `${found.word}: ${found.names.map((named) => `${named.kind} ${named.specifier}`).join(', ')}`)).toEqual([
      'case-runner: package case-runner',
    ]);
  });

  it('sends a package that publishes nothing to its area on the map, not to `entrypoint`', () => {
    const places = { current: true, packages: new Map([...PLACED.packages, ['case-runner', { area: { id: '7', name: 'cases' }, layer: 2 }]]) };
    const text = formatClassified(classifyWords('is case-runner in a layer', HELP, [...places.packages.keys()]), places);

    expect(text).toContain('variance ask orient --area 7');
    expect(text).not.toContain('entrypoint --package case-runner');
  });

  it('says the map is older than the source index when it was folded from an earlier one', () => {
    const text = formatClassified(classifyWords(ASKED, HELP, MAPPED), { ...PLACED, current: false });

    expect(text).toContain('This map was folded from an earlier source index; `variance index` folds it again.');
  });

  it('says there is no code map and names `variance index`, classifying nothing', () => {
    const root = mkdtempSync(join(tmpdir(), 'classify-'));
    try {
      const text = classify.run(HELP, { query: ASKED }, { root });

      expect(text).toContain('`variance index`');
      expect(text).not.toContain('package @acme/sense');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('is asked as `variance ask classify` and MCP `docs_classify`', () => {
    expect(HELP_TOOLS.map((tool) => tool.name)).toContain('docs_classify');
  });
});
