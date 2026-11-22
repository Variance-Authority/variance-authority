import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Documented, Entry, Help } from '@variance-authority/package/help';
import * as sense from '@variance-authority/sense';
import { HELP_TOOLS } from '../tools.js';
import { classify } from './classify.js';
import { classifyWords, formatClassified, identifier, placedAreas, type CodeMapPlaces, type Named } from './classify-words.js';
import { FoundNothing } from './find.js';
import * as symbol from './symbol.js';

// `symbol`'s own answer, as classify reads it, unless a case says it fails.
vi.mock('./symbol.js', async (actual) => {
  const real = await actual<typeof import('./symbol.js')>();
  return { ...real, declaredInCheckout: vi.fn(real.declaredInCheckout) };
});

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
    ['@acme/sense', { area: { id: '4', name: 'around core, sense' }, layer: 3, directory: 'packages/sense' }],
    ['@acme/eyes', { area: { id: '5', name: 'png' }, layer: 2, directory: 'packages/eyes' }],
    ['@acme/vantage', { area: { id: '10', name: 'vantage wire event' }, layer: 1, directory: 'packages/vantage' }],
  ]),
};

const MAPPED = [...PLACED.packages.keys()];

const ASKED = 'hey can you check if sense can see eyes via vantage';

afterEach(() => vi.restoreAllMocks());

describe('docs_classify', () => {
  it.each(['checkoutPath', 'sense/test-selection'])('answers a fully recognized unscoped query without requesting area ranking (%s)', (query) => {
    vi.spyOn(sense, 'packageLayers').mockReturnValue({ current: true, packages: [] });
    const rank = vi.spyOn(sense, 'classifiedAreas').mockReturnValue({ areas: [], reached: 0, unresolved: 0 });

    const text = classify.run(HELP, { query }, { root: '/unused' });

    expect(text).toContain(query);
    expect(rank).not.toHaveBeenCalled();
  });

  it('fails with what failed when `symbol` cannot answer a word for a reason other than finding nothing', () => {
    vi.spyOn(sense, 'packageLayers').mockReturnValue({ current: true, packages: [] });
    vi.spyOn(sense, 'filesNamed').mockReturnValue(new Map());
    vi.mocked(symbol.declaredInCheckout).mockImplementationOnce(() => {
      throw new Error('the source index could not be read');
    });

    expect(() => classify.run(HELP, { query: 'ModuleLoader' }, { root: '/unused' })).toThrow('the source index could not be read');
  });

  it.each(['checkoutPath defaults', 'defaults'])('still requests area ranking for unresolved words (%s)', (query) => {
    vi.spyOn(sense, 'packageLayers').mockReturnValue({ current: true, packages: [] });
    const rank = vi.spyOn(sense, 'classifiedAreas').mockReturnValue({ areas: [], reached: 0, unresolved: 0 });

    classify.run(HELP, { query }, { root: '/unused' });

    expect(rank).toHaveBeenCalledOnce();
  });

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

  it('names two exports of one entrypoint, each with its own `symbol` question', () => {
    const text = formatClassified(classifyWords('checkoutPath eyes', HELP, MAPPED), PLACED);

    expect(text).toMatch(/^checkoutPath — export @acme\/sense/m);
    expect(text).toMatch(/^eyes — package @acme\/eyes.*\n {5}— export @acme\/sense/m);
    expect(text).toContain('variance ask symbol --name checkoutPath');
    expect(text).toContain('variance ask symbol --name eyes');
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
    const places = { current: true, packages: new Map([...PLACED.packages, ['case-runner', { area: { id: '7', name: 'cases' }, layer: 2, directory: 'cases/runner' }]]) };
    const text = formatClassified(classifyWords('is case-runner in a layer', HELP, [...places.packages.keys()]), places);

    expect(text).toContain('variance ask orient --area 7');
    expect(text).not.toContain('entrypoint --package case-runner');
  });

  it('lists the areas the words point to, best first, each in its package, and asks `search` from the best for its two weightiest words', () => {
    const areas = [
      { path: 'x-pack/plugins/task_manager/server', files: 3, words: ['manager', 'task', 'claiming'], score: 2900, declares: true, package: '@acme/sense' },
      { path: 'x-pack/plugins/alerting/server', files: 1, words: ['task'], score: 700, declares: true, package: '@acme/alerting' },
      { path: 'docs', files: 1, words: ['task'], score: 500, declares: true },
    ];
    const text = formatClassified(classifyWords('task manager claiming', HELP, MAPPED), PLACED, areas);

    expect(text).toContain([
      'Areas its words point to, best first:',
      '  x-pack/plugins/task_manager/server — 3 files · holds manager task claiming · in @acme/sense · area 4 around core, sense · layer 3',
      '  x-pack/plugins/alerting/server — 1 file · holds task · in @acme/alerting · not on the code map',
      '  docs — 1 file · holds task',
    ].join('\n'));
    expect(text).toContain("variance ask search --query 'manager task' --from x-pack/plugins/task_manager/server");
  });

  it('places an area in the map package nearest at or above it, by the name the map gives it', () => {
    const packages = new Map([
      ['shop', { layer: 1, directory: 'packages/shop' }],
      ['shop (packages/old/shop)', { layer: 1, directory: 'packages/old/shop' }],
    ]);
    const area = (path: string) => ({ path, files: 1, words: ['shop'], score: 1, declares: true });

    expect(placedAreas([area('packages/old/shop/src'), area('packages/shop'), area('packages/old'), area('.')], packages)).toEqual([
      { ...area('packages/old/shop/src'), package: 'shop (packages/old/shop)' },
      { ...area('packages/shop'), package: 'shop' },
      area('packages/old'),
      area('.'),
    ]);
  });

  it('keeps the start point the asker said when the best area is the whole tree it reached', () => {
    const areas = [{ path: '.', files: 40, words: ['task', 'manager'], score: 900, declares: true }];
    const text = formatClassified(classifyWords('task manager claiming', HELP, MAPPED), PLACED, areas, { from: ['x-pack/plugins/task_manager/'] });

    expect(text).toContain("variance ask search --query 'task manager' --from x-pack/plugins/task_manager/");
  });

  it('keeps the start point the asker said over the best area, whose directory holds files that start point never reached', () => {
    const areas = [{ path: 'x-pack/plugins/task_manager/server', files: 3, words: ['manager', 'task'], score: 800, declares: true }];
    const text = formatClassified(classifyWords('task manager claiming', HELP, MAPPED), PLACED, areas, { from: ['x-pack/plugins/alerting/'] });

    expect(text).toMatch(/variance ask search --query 'manager task' --from x-pack\/plugins\/alerting\/$/);
    expect(text).not.toContain('--from x-pack/plugins/task_manager/server');
  });

  it('asks `search` from the best area a file of which declares a name, as one that declares none is no start point', () => {
    const areas = [
      { path: 'docs/task_manager', files: 4, words: ['task', 'manager'], score: 900, declares: false },
      { path: 'x-pack/plugins/task_manager/server', files: 3, words: ['manager', 'task'], score: 800, declares: true },
    ];
    const text = formatClassified(classifyWords('task manager claiming', HELP, MAPPED), PLACED, areas);

    expect(text).toContain("variance ask search --query 'manager task' --from x-pack/plugins/task_manager/server");
    expect(text).not.toContain('--from docs/task_manager');
  });

  it('looks up only the identifier-shaped words no published name took, and counts past the ones it shows', () => {
    const asked: string[][] = [];
    const declared = (at: string, more?: number): Named => ({ kind: 'declared', specifier: at, package: '', published: false, ...(more === undefined ? {} : { more }) });
    const located = classifyWords('ModuleLoader checkoutPath loader child_process', HELP, MAPPED, (words) => {
      asked.push([...words]);
      return new Map([
        ['ModuleLoader', [declared('lib/a.js:3'), declared('lib/b.js:9'), declared('test/c.test.js:1', 4)]],
        ['child_process', [{ kind: 'file', specifier: 'lib/child_process.js', package: '@acme/sense', published: false }]],
      ]);
    });
    const text = formatClassified(located, PLACED);

    expect(asked).toEqual([['ModuleLoader', 'child_process']]);
    expect(text).toContain('ModuleLoader — declared lib/a.js:3 · in no package\n             — declared lib/b.js:9 · in no package\n             — declared test/c.test.js:1 · in no package\n             — and 4 more\n');
    expect(text).toMatch(/^child_process — file lib\/child_process\.js · in @acme\/sense · area 4 around core, sense · layer 3$/m);
    expect(text).not.toContain('variance ask orient --files');
    expect(text).toContain('Not entities: loader');
  });

  it('ends with what each named file declares, functions, classes and methods only, exported first, eight at most, and says they are the answer', () => {
    vi.spyOn(sense, 'packageLayers').mockReturnValue({ current: true, packages: [] });
    vi.spyOn(sense, 'filesNamed').mockReturnValue(new Map([['run_main', { files: ['lib/run_main.js'], count: 1 }]]));
    vi.mocked(symbol.declaredInCheckout).mockImplementation((_, { name }) => {
      if (name !== 'ModuleLoader') throw new FoundNothing(name);
      return { files: new Map([['lib/loader.js', [3]]]), spelled: new Map([['lib/loader.js:3', ['ModuleLoader']]]) } as unknown as ReturnType<typeof symbol.declaredInCheckout>;
    });
    const declaration = (name: string, line: number, kind = 'function', exported = false) => ({ name, kind, line, exported, members: [] });
    const orient = vi.spyOn(sense, 'orientAround').mockReturnValue({
      packages: { index: '' },
      external: { index: '' },
      declarations: [
        { file: 'lib/loader.js', read: true, more: 0, moreMembers: 0, declarations: [
          declaration('helper', 1), declaration('CACHE', 2, 'const', true), declaration('ModuleLoader', 3, 'class', true),
          ...['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((name, at) => declaration(name, 10 + at)),
        ] },
        { file: 'lib/run_main.js', read: true, more: 0, moreMembers: 0, declarations: [declaration('runEntryPointWithESMLoader', 5, 'function', true)] },
      ],
    } as unknown as ReturnType<typeof sense.orientAround>);

    const text = classify.run(HELP, { query: 'ModuleLoader run_main' }, { root: '/unused' });

    expect(orient.mock.calls[0]?.[1]).toEqual(['lib/loader.js', 'lib/run_main.js']);
    expect(text.endsWith([
      '',
      'The files the request names, each with what it declares, exported first. They are the answer: a file beside them joins it only when it declares a name the request uses, never for sharing their folder.',
      '  lib/loader.js — ModuleLoader (exported), helper, a, b, c, d, e, f, and 2 more',
      '  lib/run_main.js — runEntryPointWithESMLoader (exported)',
      '',
    ].join('\n'))).toBe(true);
  });

  it('takes a word as an identifier by an inner capital, an underscore or a digit after a letter, and nothing else', () => {
    expect(['ModuleLoader', 'run_main', 'utf8', 'ESM'].filter(identifier)).toEqual(['ModuleLoader', 'run_main', 'utf8', 'ESM']);
    expect(['loader', 'Loader', '2fa', 'CJS-ESM', 'lib/loader.js'].filter(identifier)).toEqual([]);
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
