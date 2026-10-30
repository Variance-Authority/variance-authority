import { afterEach, describe, expect, it } from 'vitest';
import { treeOf, type Tree } from '@variance-authority/mcp/tools';
import { readHelp } from '@variance-authority/package/help';
import { INVENTED_PACKAGES } from '../__fixtures__/invented-packages.js';
import { inventedWorkspace } from '../__fixtures__/invented-workspace.js';
import { searchNames } from './search-answer.js';
import { searchIndexOf } from './search.js';

/**
 * One name's rows are in one order in every section: the published section
 * lists them in it, the exported section shows the first of them, and the
 * described section shows a name through the row it weighs most through, then
 * the one whose doc writes more of the question's adjacent word pairs, then the
 * first of them. A published row goes before an exported one: in the published
 * and exported sections before where the question was found, in the described
 * section with the question found alike in each. Then a row goes by where the
 * question was found in it: the name whole, then in its words, then in its
 * doc's opening, then later in the doc. Then a published row goes by the files
 * of the area importing it, then its import sites there, then the packages
 * importing it anywhere, then its import sites anywhere; an exported row source
 * first, then tests, then stories; then the doc's text, then what a published
 * row declares or the line an exported row is declared on, then the row's path.
 * A published row has no line, so the file settles two published declarations
 * of one kind under one doc.
 */

const before = process.env['VARIANCE_AUTHORITY_CACHE'];
afterEach(() => {
  if (before === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = before;
});

/** A workspace of `packages/*` kits, each by its `src/` files, and the kits each `uses`. */
const kits = (each: Record<string, Record<string, string>>, uses: Record<string, readonly string[]> = {}): Promise<string> =>
  inventedWorkspace(INVENTED_PACKAGES, ['react'], {
    'package.json': JSON.stringify({ name: 'fixture', private: true, workspaces: ['packages/*'], dependencies: { react: '1.0.0' } }),
    ...Object.fromEntries(Object.entries(each).flatMap(([name, files]) => [
      [`packages/${name}/package.json`, JSON.stringify({
        name,
        type: 'module',
        exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
        dependencies: Object.fromEntries((uses[name] ?? []).map((kit) => [kit, 'workspace:*'])),
      })],
      [`packages/${name}/tsconfig.json`, JSON.stringify({ compilerOptions: { rootDir: './src', outDir: './dist' } })],
      ...Object.entries(files).map(([file, text]) => [`packages/${name}/src/${file}`, text]),
    ])),
  });

/** `PlacementKit` declared under `doc`. */
const placed = (doc: string): string => `/** ${doc} */\nexport interface PlacementKit {\n  readonly at: string;\n}\n`;

/**
 * The rows each section shows `PlacementKit` through: the published and
 * exported sections asked by its name, the described section by words its name
 * holds and no doc adds to, every `renamed` written as `<renamed>`.
 */
function sections(root: string, renamed: string, from?: string, tree?: Tree): unknown {
  const index = searchIndexOf(readHelp(root));
  const where = from === undefined ? {} : { from };
  const named = searchNames(index, { query: 'PlacementKit', ...where }, tree);
  const described = searchNames(index, { query: 'placement kit zebra', ...where }, tree).described;
  const shown = {
    published: named.published?.shown.map((one) => one.specifier),
    exported: named.exported?.shown.map((one) => one.at),
    described: described?.shown.filter((one) => one.name === 'PlacementKit').map((one) => ('specifier' in one ? one.specifier : one.at)),
  };
  return JSON.parse(JSON.stringify(shown).replaceAll(renamed, '<renamed>'));
}

const APP = 'packages/app/src/index.ts';

describe('the order one name\'s rows are shown in', () => {
  it('shows a name published twice in an area through the row it lists first, an import outside settling the tie there', async () => {
    // `app` imports `PlacementKit` from both kits once each; `far`, outside the area, imports the first kit's.
    const shown = async (first: string): Promise<unknown> => {
      const root = await kits({
        [first]: { 'index.ts': placed('The kit of a placement.') },
        'b-kit': { 'index.ts': placed('A kit for one placement.') },
        'app': { 'index.ts': `import type { PlacementKit } from '${first}';\nimport type { PlacementKit as Kit } from 'b-kit';\nexport type Used = PlacementKit | Kit;\n` },
        'far': { 'index.ts': `import type { PlacementKit } from '${first}';\nexport type Far = PlacementKit;\n` },
      }, { app: [first, 'b-kit'], far: [first] });
      const files = [first, 'b-kit'].map((name) => `packages/${name}/src/index.ts`);
      const tree = treeOf([{ file: APP, edges: files.map((to) => ({ to, kind: 'imports' as const })) }, ...files.map((file) => ({ file }))], root);
      return sections(root, first, APP, tree);
    };
    const expected = { published: ['<renamed>', 'b-kit'], exported: [], described: ['<renamed>'] };
    expect(await shown('a-kit')).toEqual(expected);
    expect(await shown('z-kit')).toEqual(expected);
  });

  it('lists a name published twice, nothing importing either, by its docs whatever its packages are called', async () => {
    const shown = async (first: string): Promise<unknown> => sections(await kits({
      [first]: { 'index.ts': placed('The kit of a placement.') },
      'b-kit': { 'index.ts': placed('A kit for one placement.') },
    }), first);
    const expected = { published: ['b-kit', '<renamed>'], exported: [], described: ['b-kit'] };
    expect(await shown('a-kit')).toEqual(expected);
    expect(await shown('z-kit')).toEqual(expected);
  });

  it('shows a name exported from two source files through the same row in both sections whatever its files are called', async () => {
    const shown = async (first: string): Promise<unknown> => sections(await inventedWorkspace(INVENTED_PACKAGES, ['react'], {
      [`src/${first}.ts`]: placed('The kit of a placement.'),
      'src/b.ts': placed('A kit for one placement.'),
    }), `src/${first}.ts`);
    const expected = { published: [], exported: ['src/b.ts'], described: ['src/b.ts'] };
    expect(await shown('a')).toEqual(expected);
    expect(await shown('c')).toEqual(expected);
  });

  it('shows a name a doc reached through that doc\'s row, though the order puts another of its rows first', async () => {
    const index = searchIndexOf(readHelp(await inventedWorkspace(INVENTED_PACKAGES, ['react'], {
      'src/a.ts': placed('A kit for one placement.'),
      'src/b.ts': placed('The placement kit a zebra rides.'),
    })));
    const through = { name: 'PlacementKit', at: 'src/b.ts', summary: 'The placement kit a zebra rides.' };
    expect(searchNames(index, { query: 'zebra rides' }).exported?.shown).toContainEqual(expect.objectContaining(through));
    expect(searchNames(index, { query: 'rides zebra' }).described?.shown).toContainEqual(expect.objectContaining(through));
  });

  /** `PlacementKit`, or what `declaration` declares, under a doc of `lines`. */
  const documented = (lines: readonly string[], declaration = 'export interface PlacementKit {\n  readonly at: string;\n}\n'): string =>
    `/**\n${lines.map((line) => (line === '' ? ' *' : ` * ${line}`)).join('\n')}\n */\n${declaration}`;
  const LATER = documented(['A kit.', '', 'It holds zebra rides.']);
  const OPENS = documented(['The kit for zebra rides.']);
  const exportedBy = (shown: readonly { name: string; at: string; summary?: string }[] | undefined): unknown =>
    shown?.map((one) => [one.name, one.at, one.summary]);

  it('shows a name in the exported section through the row whose doc opens with the question, the row that ranks it', async () => {
    const index = searchIndexOf(readHelp(await inventedWorkspace(INVENTED_PACKAGES, ['react'], {
      'src/a.ts': LATER,
      'src/b.ts': OPENS,
      'src/r.ts': documented(['zebra rides for the rival.'], 'export interface Rival {\n  readonly at: string;\n}\n'),
    })));
    expect(exportedBy(searchNames(index, { query: 'zebra rides' }).exported?.shown)).toEqual([
      ['PlacementKit', 'src/b.ts', 'The kit for zebra rides.'],
      ['Rival', 'src/r.ts', 'zebra rides for the rival.'],
    ]);
  });

  it('shows a name in an area through the row whose doc opens with the question, in the exported and the described section', async () => {
    const root = await inventedWorkspace(INVENTED_PACKAGES, ['react'], {
      'src/a.ts': LATER,
      'src/b.ts': OPENS,
      'src/index.ts': "import type { PlacementKit } from './a.js';\nimport type { PlacementKit as Kit } from './b.js';\nexport type Used = PlacementKit | Kit;\n",
    });
    const tree = treeOf([{ file: 'src/index.ts', edges: ['src/a.ts', 'src/b.ts'].map((to) => ({ to, kind: 'imports' as const })) }, { file: 'src/a.ts' }, { file: 'src/b.ts' }], root);
    const index = searchIndexOf(readHelp(root));
    const shown = [['PlacementKit', 'src/b.ts', 'The kit for zebra rides.']];
    for (const where of [{}, { from: 'src/index.ts' }]) {
      expect(exportedBy(searchNames(index, { query: 'zebra rides', ...where }, tree).exported?.shown)).toEqual(shown);
      expect(exportedBy(searchNames(index, { query: 'rides zebra', ...where }, tree).described?.shown as never)).toEqual(shown);
    }
  });

  it('lists the published row whose doc opens with the question first, before a row a package imports', async () => {
    const listed = async (first: string): Promise<unknown> => {
      const root = await kits({
        [first]: { 'index.ts': LATER },
        'b-kit': { 'index.ts': OPENS },
        'app': { 'index.ts': `import type { PlacementKit } from '${first}';\nexport type Used = PlacementKit;\n` },
      }, { app: [first] });
      const shown = searchNames(searchIndexOf(readHelp(root)), { query: 'zebra rides' }).published?.shown;
      return JSON.parse(JSON.stringify(shown?.map((one) => [one.specifier, one.otherPackages, one.summary])).replaceAll(first, '<renamed>'));
    };
    const expected = [['b-kit', 0, 'The kit for zebra rides.'], ['<renamed>', 1, 'A kit.']];
    expect(await listed('a-kit')).toEqual(expected);
    expect(await listed('z-kit')).toEqual(expected);
  });

  it('orders a name published twice under one doc by its declaration\'s kind before its package\'s name', async () => {
    const shown = async (first: string, declared: string, other: string, doc: string): Promise<unknown> => {
      const index = searchIndexOf(readHelp(await kits({ [first]: { 'index.ts': `${doc}${declared}` }, 'm-kit': { 'index.ts': `${doc}${other}` } })));
      const kinds = (query: string, section: 'published' | 'described'): unknown =>
        searchNames(index, { query })[section]?.shown.map((one) => ['specifier' in one ? one.specifier : one.at, 'kind' in one ? one.kind : undefined]);
      return JSON.parse(JSON.stringify({ published: kinds('PlacementKit', 'published'), described: kinds('placement kit zebra', 'described') }).replaceAll(first, '<renamed>'));
    };
    const INTERFACE = 'export interface PlacementKit {\n  readonly at: string;\n}\n';
    const FUNCTION = 'export function PlacementKit(): string {\n  return "";\n}\n';
    const TYPE = 'export type PlacementKit = {\n  readonly at: string;\n};\n';
    const documentedKinds = { published: [['m-kit', 'function'], ['<renamed>', 'interface']], described: [['m-kit', 'function']] };
    expect(await shown('a-kit', INTERFACE, FUNCTION, '/** The placement kit. */\n')).toEqual(documentedKinds);
    expect(await shown('z-kit', INTERFACE, FUNCTION, '/** The placement kit. */\n')).toEqual(documentedKinds);
    const undocumented = { published: [['<renamed>', 'interface'], ['m-kit', 'type']], described: [['<renamed>', 'interface']] };
    expect(await shown('a-kit', INTERFACE, TYPE, '')).toEqual(undocumented);
    expect(await shown('z-kit', INTERFACE, TYPE, '')).toEqual(undocumented);
  });

  it('shows a name exported twice under one doc through the row declared on the earlier line before the file\'s name', async () => {
    const shown = async (first: string): Promise<unknown> => {
      const fillers = ['one', 'two', 'three', 'four'].map((name) => `export const ${name} = 1;\n`).join('');
      const index = searchIndexOf(readHelp(await inventedWorkspace(INVENTED_PACKAGES, ['react'], {
        [`src/${first}.ts`]: placed('The placement kit.'),
        'src/m.ts': `${fillers}${placed('The placement kit.')}`,
      })));
      const lines = (query: string, section: 'exported' | 'described'): unknown =>
        searchNames(index, { query })[section]?.shown.filter((one) => one.name === 'PlacementKit').map((one) => [one.at, 'line' in one ? one.line : undefined]);
      return JSON.parse(JSON.stringify({ exported: lines('PlacementKit', 'exported'), described: lines('placement kit zebra', 'described') }).replaceAll(`src/${first}.ts`, '<renamed>'));
    };
    const expected = { exported: [['<renamed>', 2]], described: [['<renamed>', 2]] };
    expect(await shown('a')).toEqual(expected);
    expect(await shown('z')).toEqual(expected);
  });
});
