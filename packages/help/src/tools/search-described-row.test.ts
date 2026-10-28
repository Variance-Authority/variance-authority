import { realpathSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { treeOf } from '@variance-authority/mcp/tools';
import { readHelp } from '@variance-authority/package/help';
import { INVENTED_PACKAGES } from '../__fixtures__/invented-packages.js';
import { inventedWorkspace } from '../__fixtures__/invented-workspace.js';
import { areaOf, type Area } from './area.js';
import { describedNames } from './described.js';
import { searchNames, shownRowOrder } from './search-answer.js';
import { answerSearch, searchIndexOf } from './search.js';

/**
 * A name with more than one row — published by more than one package or
 * exported from more than one file, or published and also exported — is
 * weighed, ordered and shown through one of them, never several rows' docs
 * added up: the row its words weigh most through, then the one whose doc writes
 * the most of the question's adjacent word pairs, then the first by
 * {@link shownRowOrder}. A word's rarity is counted per name, declaration and
 * file reached, and the mean doc length over every row reached, so no name's
 * weight depends on which row another is shown through. A name stays in the
 * described section by the words of the row it is weighed through. In an area
 * only the area's rows count.
 */

const before = process.env['VARIANCE_AUTHORITY_CACHE'];
afterEach(() => {
  if (before === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = before;
});

describe('which row a described name is weighed, ordered and shown through', () => {
  /** The names the described section reaches for `query`, in `area` when one is given, with nothing answered before it. */
  const reachedBy = (index: ReturnType<typeof searchIndexOf>, query: string, area?: Area) => {
    const within = area === undefined ? undefined : index.fileIds(area.files);
    return describedNames(index, query, within, new Set(), shownRowOrder(index, area, within));
  };

  it('weighs a name published twice with the length of the doc that holds the words, not of the row published first', async () => {
    const kit = (name: string, source: string): Record<string, string> => ({
      [`packages/${name}/package.json`]: JSON.stringify({ name, type: 'module', exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } } }),
      [`packages/${name}/tsconfig.json`]: JSON.stringify({ compilerOptions: { rootDir: './src', outDir: './dist' } }),
      [`packages/${name}/src/index.ts`]: source,
    });
    const root = await inventedWorkspace(INVENTED_PACKAGES, ['react'], {
      'package.json': JSON.stringify({ name: 'fixture', private: true, workspaces: ['packages/*'], dependencies: { react: '1.0.0' } }),
      // `a-kit`'s `Placement` has no doc; `b-kit`'s holds the words.
      ...kit('a-kit', 'export interface Placement {\n  readonly shard: number;\n}\n'),
      ...kit('b-kit', '/** Where a case was placed: the file it is in, at the commit it ran at, and the text of that file then. */\nexport interface Placement {\n  readonly at: string;\n}\n'),
    });
    const index = searchIndexOf(readHelp(root));
    const placement = index.namesContaining('placement').find((name) => index.name(name) === 'Placement') as number;
    const rows = [...index.publishedOf(placement)];
    const held = rows.find((row) => index.published(row).doc !== undefined);
    expect(rows.map((row) => index.published(row).specifier).sort()).toEqual(['a-kit', 'b-kit']);
    const reached = reachedBy(index, 'text of a file at a commit')?.find((one) => one.name === placement);
    expect(reached?.words).toEqual(['commit', 'file', 'text']);
    expect(reached?.docLength).toBe(index.publishedDocLength(held as number));
    const said = answerSearch(index, { query: 'text of a file at a commit' }, treeOf([], root), root);
    expect(said).toMatch(/b-kit · Placement .*\[holds: commit, file, text\]/u);
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

  /** A published `Placement` in `a-kit` and one `b-kit/src/inner.ts` exports without publishing, beside `more` kits. */
  const placedTwice = async (published: string, exported: string, more: Record<string, Record<string, string>> = {}): Promise<string> =>
    kits({
      'a-kit': { 'index.ts': `${published}export interface Placement {\n  readonly shard: number;\n}\n` },
      'b-kit': {
        'index.ts': 'export const kit = 1;\n',
        'inner.ts': `${exported}export interface Placement {\n  readonly at: string;\n}\n`,
      },
      ...more,
    });
  const placementOf = (index: ReturnType<typeof searchIndexOf>): number =>
    index.namesContaining('placement').find((name) => index.name(name) === 'Placement') as number;

  it('shows a name through the exported row whose doc holds the words, not the published row with none', async () => {
    const doc = '/** Where a case was placed: the file it is in, at the commit it ran at, and the text of that file then. */\n';
    const root = await placedTwice('', doc);
    const index = searchIndexOf(readHelp(root));
    const reached = reachedBy(index, 'text of a file at a commit')?.find((one) => one.name === placementOf(index));
    expect(reached?.through?.kind).toBe('exported');
    const said = answerSearch(index, { query: 'text of a file at a commit' }, treeOf([], root), root);
    const line = said.split('\n').find((one) => one.includes('Placement')) ?? '';
    expect(line).toContain('packages/b-kit/src/inner.ts');
    expect(line).toContain('[holds: commit, file, text]');
  });

  it('weighs and shows a name through its published row when an exported doc as long adds as many other words', async () => {
    const root = await placedTwice('/** Kept with the text it holds. */\n', '/** Kept at the commit, as read. */\n');
    const index = searchIndexOf(readHelp(root));
    const [exportedRow] = [...index.exportedOf(placementOf(index))];
    const reached = reachedBy(index, 'commit text')?.find((one) => one.name === placementOf(index));
    expect(reached?.through?.kind).toBe('published');
    expect(reached?.docLength).toBe(index.publishedDocLength(reached?.through?.row as number));
    expect(reached?.docLength).toBe(index.exportedDocLength(exportedRow as number));
    expect(reached?.words).toEqual(['text']);
    const said = answerSearch(index, { query: 'commit text' }, treeOf([], root), root);
    expect(said).toMatch(/a-kit · Placement .*Kept with the text it holds\..*\[holds: text\]/u);
  });

  it('weighs and shows a name through the shorter of two docs adding as many other words, though the longer is published', async () => {
    const root = await placedTwice('/** Where a case was put: the file it is in and the text of that file then, kept while the run is read. */\n', '/** At a commit. */\n');
    const index = searchIndexOf(readHelp(root));
    const reached = reachedBy(index, 'commit text')?.find((one) => one.name === placementOf(index));
    expect(reached?.through?.kind).toBe('exported');
    expect(reached?.words).toEqual(['commit']);
    expect(reached?.docLength).toBe(index.exportedDocLength(reached?.through?.row as number));
    const [publishedRow] = [...index.publishedOf(placementOf(index))];
    expect(reached?.docLength).toBeLessThan(index.publishedDocLength(publishedRow as number) as number);
    const line = answerSearch(index, { query: 'commit text' }, treeOf([], root), root).split('\n').find((one) => one.includes('Placement')) ?? '';
    expect(line).toContain('packages/b-kit/src/inner.ts');
    expect(line).toContain('[holds: commit]');
  });

  /** A doc of about 260 bytes that holds `text` and not `placement`. */
  const LONG = '/** Where a case was put while the run was read: the file it is in, at the commit it ran at, and the text of that file then, kept for as long as the run is read and dropped when the run is, so that a later read of the same run finds the same file at the same commit. */\n';
  const SHORT = '/** The text it holds. */\n';

  it('weighs and shows a name through the same row whichever package publishes which doc', async () => {
    // Every doc adds two words of three: `LONG` and `c-kit`'s add `commit` and `text`, `SHARD` adds `commit` and `shard`.
    // `SHARD` and `c-kit`'s are no longer than the mean, so they weigh alike, and a published row comes first.
    const SHARD = '/** Kept at the commit of one shard. */\n';
    const placed = async (first: string, second: string): Promise<unknown> => {
      const root = await kits({
        'a-kit': { 'index.ts': `${first}export interface Placement {\n  readonly at: string;\n}\n` },
        'b-kit': { 'index.ts': `${second}export interface Placement {\n  readonly at: string;\n}\n` },
        'c-kit': { 'index.ts': 'export const kit = 1;\n', 'inner.ts': '/** The text of a commit. */\nexport interface Placement {\n  readonly at: string;\n}\n' },
      });
      const index = searchIndexOf(readHelp(root));
      const reached = reachedBy(index, 'commit text shard')?.find((one) => one.name === placementOf(index));
      const line = answerSearch(index, { query: 'commit text shard' }, treeOf([], root), root).split('\n').find((one) => one.includes('Placement'));
      return { through: reached?.through.kind, words: reached?.words, line };
    };
    const shown = { through: 'published', words: ['commit', 'shard'], line: expect.stringMatching(/· Placement .*Kept at the commit of one shard\..*\[holds: commit, shard\]/u) };
    expect(await placed(LONG, SHARD)).toEqual(shown);
    expect(await placed(SHARD, LONG)).toEqual(shown);
  });

  /** Each described row for `query` as its name, the row it is shown through, its doc and the words it holds. */
  const describedBy = (root: string, query: string): unknown =>
    searchNames(searchIndexOf(readHelp(root)), { query }).described?.shown.map((one) =>
      [one.name, 'specifier' in one ? one.specifier : one.at, 'summary' in one ? one.summary : undefined, one.words]);
  // Both docs are 31 bytes and add one word of three as rare as the other's, so the two rows weigh alike.
  const TEXT = '/** Kept with its text at a commit. */\n';
  const PAGE = '/** Kept with its page at a commit. */\n';

  it('weighs and shows a name published twice through the same row whatever its packages are called, at a tie on all else', async () => {
    const placed = async (first: string): Promise<unknown> => describedBy(await kits({
      [first]: { 'index.ts': `${TEXT}export interface Placement {\n  readonly at: string;\n}\n` },
      'b-kit': { 'index.ts': `${PAGE}export interface Placement {\n  readonly at: string;\n}\n` },
    }), 'commit text page');
    const shown = [['Placement', 'b-kit', 'Kept with its page at a commit.', ['commit', 'page']]];
    expect(await placed('a-kit')).toEqual(shown);
    expect(await placed('z-kit')).toEqual(shown);
  });

  it('weighs and shows a name exported twice through the same row whatever its files are called, at a tie on all else', async () => {
    const placed = async (first: string): Promise<unknown> => describedBy(await inventedWorkspace(INVENTED_PACKAGES, ['react'], {
      [first]: `${TEXT}export interface Placement {\n  readonly at: string;\n}\n`,
      'src/b.ts': `${PAGE}export interface Placement {\n  readonly at: string;\n}\n`,
    }), 'commit text page');
    const shown = [['Placement', 'src/b.ts', 'Kept with its page at a commit.', ['commit', 'page']]];
    expect(await placed('src/a.ts')).toEqual(shown);
    expect(await placed('src/c.ts')).toEqual(shown);
  });

  it('weighs and shows a name through the shorter of two rows whose docs hold the same words, though the longer is published', async () => {
    const root = await placedTwice(LONG, SHORT);
    const index = searchIndexOf(readHelp(root));
    const reached = reachedBy(index, 'placement text')?.find((one) => one.name === placementOf(index));
    expect(reached?.through?.kind).toBe('exported');
    expect(reached?.docLength).toBe(index.exportedDocLength(reached?.through?.row as number));
    expect(reached?.docLength).toBe(18);
    const said = answerSearch(index, { query: 'placement text' }, treeOf([], root), root);
    const line = said.split('\n').find((one) => one.includes('Placement')) ?? '';
    expect(line).toContain('packages/b-kit/src/inner.ts');
    expect(line).toContain('The text it holds.');
  });

  it('sorts a name by the shorter doc holding its words, so a longer published one holding the same never demotes it', async () => {
    // Each `c-kit` doc holds `placement`, and only `omega`'s holds `text` too.
    const fillers = ['alpha', 'beta', 'gamma', 'delta'].map((name) => `/** Kept for a placement. */\nexport const ${name} = 1;\n`).join('');
    const root = await placedTwice(LONG, SHORT, {
      'c-kit': { 'index.ts': `export const seed = 1;\n${fillers}/** The text kept with a placement. */\nexport const omega = 1;\n` },
    });
    const said = answerSearch(searchIndexOf(readHelp(root)), { query: 'placement text' }, treeOf([], root), root);
    const at = (name: string): number => said.search(new RegExp(`^(?:\\S+ · )?${name} `, 'mu'));
    expect(at('omega')).toBeGreaterThan(-1);
    expect(at('Placement')).toBeGreaterThan(-1);
    expect(at('Placement')).toBeLessThan(at('omega'));
  });

  const KEPT = '/** Kept with the text it holds. */\n';
  const APP = 'packages/app/src/index.ts';

  it('reaches no name in an area through a published row the area does not import, as it shows none', async () => {
    // `a-kit` publishes `Inner` as `Placement`; the area imports `Inner` from its file and `Placement` from `b-kit`.
    // A re-export is resolved to its real path, so the root is the real one.
    const root = realpathSync(await kits({
      'a-kit': { 'inner.ts': `${KEPT}export interface Inner {\n  readonly shard: number;\n}\n`, 'index.ts': "export type { Inner as Placement } from './inner.js';\n" },
      'b-kit': { 'index.ts': 'export interface Placement {\n  readonly at: string;\n}\n' },
      'app': { 'index.ts': "import type { Placement } from 'b-kit';\nimport type { Inner } from '../../a-kit/src/inner.js';\nexport type Used = Placement | Inner;\n" },
    }, { app: ['b-kit'] }));
    const tree = treeOf([
      { file: APP, edges: [{ to: 'packages/a-kit/src/inner.ts', kind: 'imports' }] },
      { file: 'packages/a-kit/src/inner.ts' },
      { file: 'packages/a-kit/src/index.ts', edges: [{ to: 'packages/a-kit/src/inner.ts', kind: 'imports' }] },
      { file: 'packages/b-kit/src/index.ts' },
    ], root);
    const described = searchNames(searchIndexOf(readHelp(root)), { query: 'commit text', from: APP }, tree).described;
    expect(described?.total).toBe(described?.shown.length);
    expect(described?.shown.map((one) => one.name)).toEqual(['Inner']);
  });

  it('weighs and shows a name in an area through the exported row the area holds, not a published row it does not import', async () => {
    // The area imports `kit` from `z-kit` and `Placement` from `b-kit`, so only `b-kit`'s `Placement` is used there.
    const root = await kits({
      'z-kit': { 'index.ts': `export const kit = 1;\n${KEPT}export interface Placement {\n  readonly shard: number;\n}\n` },
      'b-kit': { 'index.ts': 'export interface Placement {\n  readonly at: string;\n}\n' },
      'app': { 'index.ts': "import { kit } from 'z-kit';\nimport type { Placement } from 'b-kit';\nexport const used: Placement | number = kit;\n" },
    }, { app: ['z-kit', 'b-kit'] });
    const files = [APP, 'packages/z-kit/src/index.ts', 'packages/b-kit/src/index.ts'];
    const tree = treeOf([{ file: APP, edges: files.slice(1).map((to) => ({ to, kind: 'imports' as const })) }, ...files.slice(1).map((file) => ({ file }))], root);
    const index = searchIndexOf(readHelp(root));
    const reached = reachedBy(index, 'commit text', areaOf(APP, undefined, tree))?.find((one) => one.name === placementOf(index));
    expect(reached?.through?.kind).toBe('exported');
    expect(index.exported(reached?.through?.row as number).at).toBe('packages/z-kit/src/index.ts');
    const shown = searchNames(index, { query: 'commit text', from: APP }, tree).described?.shown.find((one) => one.name === 'Placement');
    expect(shown?.at).toBe('packages/z-kit/src/index.ts');
    expect(shown && 'summary' in shown ? shown.summary : undefined).toBe('Kept with the text it holds.');
  });

  it('counts no name in an area by its own words through a published row declared there that nothing there imports', async () => {
    // `a-kit` publishes `Inner` as `Placement`: declared in `inner.ts`, which exports no `Placement`; the area imports `Inner`.
    // A re-export is resolved to its real path, so the root is the real one.
    const root = realpathSync(await kits({
      'a-kit': { 'inner.ts': `${KEPT}export interface Inner {\n  readonly shard: number;\n}\n`, 'index.ts': "export type { Inner as Placement } from './inner.js';\n" },
      'app': { 'index.ts': "import type { Inner } from '../../a-kit/src/inner.js';\nexport type Used = Inner;\n" },
    }));
    const tree = treeOf([{ file: APP, edges: [{ to: 'packages/a-kit/src/inner.ts', kind: 'imports' }] }, { file: 'packages/a-kit/src/inner.ts' }], root);
    const described = searchNames(searchIndexOf(readHelp(root)), { query: 'placement text', from: APP }, tree).described;
    expect(described?.shown.map((one) => one.name)).toEqual(['Inner']);
    expect(described?.total).toBe(1);
  });

  it('counts the words a name holds in an area through the published row the area imports, the row it is shown through', async () => {
    const root = await kits({
      'b-kit': { 'index.ts': `${KEPT}export interface Placement {\n  readonly at: string;\n}\n` },
      'app': { 'index.ts': "import type { Placement } from 'b-kit';\nexport type Used = Placement;\n" },
    }, { app: ['b-kit'] });
    const described = searchNames(searchIndexOf(readHelp(root)), { query: 'placement text', from: APP }, treeOf([{ file: APP }], root)).described;
    const shown = described?.shown.find((one) => one.name === 'Placement');
    expect(shown && 'specifier' in shown ? shown.specifier : undefined).toBe('b-kit');
    expect(shown?.words).toEqual(['placement', 'text']);
  });

  it('orders names in an area by the rows the area holds, so barrels outside it move nothing there', async () => {
    // In the area `beta.ts` and `hub.ts` export `cacheBeta`, `alpha.ts` alone `cacheAlpha`; each `out` file outside it passes `cacheAlpha` on.
    const order = async (barrels: number): Promise<readonly string[]> => {
      const outside = Object.fromEntries(Array.from({ length: barrels }, (_, at) => [`src/out${at}.ts`, "export { cacheAlpha } from './alpha.js';\n"]));
      // A re-export is resolved to its real path, so the root is the real one.
      const root = realpathSync(await inventedWorkspace(INVENTED_PACKAGES, ['react'], {
        'src/alpha.ts': 'export const cacheAlpha = 1;\n',
        'src/beta.ts': 'export const cacheBeta = 2;\n',
        'src/hub.ts': "export { cacheBeta } from './beta.js';\n",
        'src/app.ts': "import { cacheAlpha } from './alpha.js';\nimport { cacheBeta } from './hub.js';\nimport './beta.js';\nexport const used = cacheAlpha + cacheBeta;\n",
        ...outside,
      }));
      const imports = (file: string, to: readonly string[]) => ({ file, edges: to.map((one) => ({ to: one, kind: 'imports' as const })) });
      const tree = treeOf([
        imports('src/app.ts', ['src/alpha.ts', 'src/hub.ts', 'src/beta.ts']),
        imports('src/hub.ts', ['src/beta.ts']),
        { file: 'src/alpha.ts' },
        { file: 'src/beta.ts' },
        ...Object.keys(outside).map((file) => imports(file, ['src/alpha.ts'])),
      ], root);
      const described = searchNames(searchIndexOf(readHelp(root)), { query: 'cache zebra', from: 'src/app.ts' }, tree).described;
      return described?.shown.map((one) => one.name) ?? [];
    };
    expect(await order(0)).toEqual(['cacheBeta', 'cacheAlpha']);
    expect(await order(3)).toEqual(['cacheBeta', 'cacheAlpha']);
  });

  it('weighs a name no doc added a word to by the doc of the row it is shown through, not of its first published row', async () => {
    // Neither doc holds `text`. `app` imports `b-kit`'s `Placement`, so it is the one shown.
    const root = await kits({
      'a-kit': { 'index.ts': '/** Kept for one shard. */\nexport interface Placement {\n  readonly shard: number;\n}\n' },
      'b-kit': { 'index.ts': '/** Kept for one run of the suite, and read once. */\nexport interface Placement {\n  readonly at: string;\n}\n' },
      'app': { 'index.ts': "import type { Placement } from 'b-kit';\nexport type Used = Placement;\n" },
    }, { app: ['b-kit'] });
    const index = searchIndexOf(readHelp(root));
    const placement = placementOf(index);
    const [firstRow, shownRow] = index.publishedOf(placement);
    expect(index.published(firstRow as number).specifier).toBe('a-kit');
    expect(index.published(shownRow as number).specifier).toBe('b-kit');
    const shown = searchNames(index, { query: 'placement text' }).described?.shown.find((one) => one.name === 'Placement');
    expect(shown && 'specifier' in shown ? shown.specifier : undefined).toBe('b-kit');
    const reached = reachedBy(index, 'placement text')?.find((one) => one.name === placement);
    expect(reached?.docLength).toBe(index.publishedDocLength(shownRow as number));
    expect(reached?.through).toEqual({ kind: 'published', row: shownRow });
  });

  it('shows a name in an area no doc adds a word to through the row more files there import, however many import another outside it', async () => {
    // `app/src/index.ts` imports `PlacementKit` from both kits and `more.ts`, which it imports, from `b-kit` again;
    // `far` and `wide`, outside the area, import `a-kit`'s, whose doc sorts first.
    const shown = async (outside: readonly string[]): Promise<unknown> => {
      const kit = (name: string, doc: string): Record<string, string> => ({ 'index.ts': `/** ${doc} */\nexport interface ${name} {\n  readonly at: string;\n}\n` });
      const root = await kits({
        'a-kit': kit('PlacementKit', 'A kit for one placement.'),
        'b-kit': kit('PlacementKit', 'The kit of a placement.'),
        'app': {
          'index.ts': "import type { PlacementKit } from 'a-kit';\nimport type { PlacementKit as Kit } from 'b-kit';\nimport type { More } from './more.js';\nexport type Used = PlacementKit | Kit | More;\n",
          'more.ts': "import type { PlacementKit } from 'b-kit';\nexport type More = PlacementKit;\n",
        },
        ...Object.fromEntries(outside.map((name) => [name, { 'index.ts': "import type { PlacementKit } from 'a-kit';\nexport type Far = PlacementKit;\n" }])),
      }, { app: ['a-kit', 'b-kit'], ...Object.fromEntries(outside.map((name) => [name, ['a-kit']])) });
      const [one, two, more] = ['packages/a-kit/src/index.ts', 'packages/b-kit/src/index.ts', 'packages/app/src/more.ts'];
      const edges = (...to: string[]) => to.map((file) => ({ to: file, kind: 'imports' as const }));
      const tree = treeOf([{ file: APP, edges: edges(one, two, more) }, { file: more, edges: edges(two) }, { file: one }, { file: two }], root);
      return searchNames(searchIndexOf(readHelp(root)), { query: 'placement kit zebra', from: APP }, tree).described?.shown.map((one) =>
        [one.name, 'specifier' in one ? one.specifier : one.at, 'summary' in one ? one.summary : undefined]);
    };
    const alone = await shown([]);
    expect(alone).toEqual(await shown(['far', 'wide']));
    expect(alone).toEqual([['PlacementKit', 'b-kit', 'The kit of a placement.']]);
  });

  it('shows a name in an area no doc adds a word to through the same exported row there whatever its files are called', async () => {
    const shown = async (first: string): Promise<unknown> => {
      const placed = (doc: string): string => `/** ${doc} */\nexport interface PlacementKit {\n  readonly at: string;\n}\n`;
      const root = await inventedWorkspace(INVENTED_PACKAGES, ['react'], {
        [`src/${first}.ts`]: placed('The kit of a placement.'),
        'src/b.ts': placed('A kit for one placement.'),
        'src/app.ts': `import type { PlacementKit } from './${first}.js';\nimport type { PlacementKit as Kit } from './b.js';\nexport type Used = PlacementKit | Kit;\n`,
      });
      const files = [`src/${first}.ts`, 'src/b.ts'];
      const tree = treeOf([{ file: 'src/app.ts', edges: files.map((to) => ({ to, kind: 'imports' as const })) }, ...files.map((file) => ({ file }))], root);
      return searchNames(searchIndexOf(readHelp(root)), { query: 'placement kit zebra', from: 'src/app.ts' }, tree).described?.shown.map((one) =>
        [one.name, one.at, 'summary' in one ? one.summary : undefined]);
    };
    const named = await shown('a');
    expect(named).toEqual(await shown('c'));
    expect(named).toEqual([['PlacementKit', 'src/b.ts', 'A kit for one placement.']]);
  });

  /** `name` declared under `doc` by a `src/index.ts`, as `kits` takes it. */
  const declaring = (name: string, doc: string): Record<string, string> => ({ 'index.ts': `/** ${doc} */\nexport interface ${name} {\n  readonly at: string;\n}\n` });

  it('shows a name no doc adds a word to, asked without an area, through the same published row whatever its packages are called', async () => {
    const shown = async (first: string): Promise<unknown> => describedBy(await kits({
      [first]: declaring('PlacementKit', 'The kit of a placement.'),
      'b-kit': declaring('PlacementKit', 'A kit for one placement.'),
      'c-kit': declaring('KitPlacement', 'The placement kit.'),
    }), 'placement kit zebra');
    const named = await shown('a-kit');
    expect(named).toEqual(await shown('z-kit'));
    expect(named).toEqual([
      ['KitPlacement', 'c-kit', 'The placement kit.', ['kit', 'placement']],
      ['PlacementKit', 'b-kit', 'A kit for one placement.', ['kit', 'placement']],
    ]);
  });

  it('shows a name no doc adds a word to, asked without an area, through the same exported row whatever its files are called', async () => {
    const shown = async (first: string): Promise<unknown> => describedBy(await inventedWorkspace(INVENTED_PACKAGES, ['react'], {
      [`src/${first}.ts`]: declaring('PlacementKit', 'The kit of a placement.')['index.ts'] as string,
      'src/b.ts': declaring('PlacementKit', 'A kit for one placement.')['index.ts'] as string,
    }), 'placement kit zebra');
    const named = await shown('a');
    expect(named).toEqual(await shown('z'));
    expect(named).toEqual([['PlacementKit', 'src/b.ts', 'A kit for one placement.', ['kit', 'placement']]]);
  });

  const KEPT_PLACEMENT = { 'index.ts': `${KEPT}export interface Placement {\n  readonly at: string;\n}\n` };

  it('weighs and shows a name in an area through the row the area imports most when two docs add the same words', async () => {
    // `app/src/index.ts` imports `Placement` from both kits, and `more.ts`, which it imports, from `b-kit` again.
    const shown = async (first: string): Promise<unknown> => {
      const root = await kits({
        [first]: KEPT_PLACEMENT,
        'b-kit': KEPT_PLACEMENT,
        'app': {
          'index.ts': `import type { Placement } from '${first}';\nimport type { Placement as Kept } from 'b-kit';\nimport type { More } from './more.js';\nexport type Used = Placement | Kept | More;\n`,
          'more.ts': "import type { Placement } from 'b-kit';\nexport type More = Placement;\n",
        },
      }, { app: [first, 'b-kit'] });
      const [one, two, more] = [`packages/${first}/src/index.ts`, 'packages/b-kit/src/index.ts', 'packages/app/src/more.ts'];
      const edges = (...to: string[]) => to.map((file) => ({ to: file, kind: 'imports' as const }));
      const tree = treeOf([{ file: APP, edges: edges(one, two, more) }, { file: more, edges: edges(two) }, { file: one }, { file: two }], root);
      const match = searchNames(searchIndexOf(readHelp(root)), { query: 'placement text', from: APP }, tree).described?.shown.find(({ name }) => name === 'Placement');
      return match && 'specifier' in match ? [match.specifier, match.inArea?.files, match.inArea?.imports] : match;
    };
    expect(await shown('a-kit')).toEqual(['b-kit', 2, 2]);
    expect(await shown('z-kit')).toEqual(['b-kit', 2, 2]);
  });

  it('weighs and shows a name through the row more packages import when two docs add the same words', async () => {
    const shown = async (first: string): Promise<unknown> => {
      const used = { 'index.ts': "import type { Placement } from 'b-kit';\nexport type Used = Placement;\n" };
      const root = await kits({ [first]: KEPT_PLACEMENT, 'b-kit': KEPT_PLACEMENT, 'app': used }, { app: ['b-kit'] });
      const match = searchNames(searchIndexOf(readHelp(root)), { query: 'placement text' }).described?.shown.find(({ name }) => name === 'Placement');
      return match && 'specifier' in match ? [match.specifier, match.packages] : match;
    };
    expect(await shown('a-kit')).toEqual(['b-kit', 1]);
    expect(await shown('z-kit')).toEqual(['b-kit', 1]);
  });

  it('weighs and shows a name through its source row before a test row when two docs add the same words', async () => {
    const shown = async (test: string): Promise<unknown> => {
      const root = await inventedWorkspace(INVENTED_PACKAGES, ['react'], { [test]: KEPT_PLACEMENT['index.ts'], 'src/b.ts': KEPT_PLACEMENT['index.ts'] });
      return searchNames(searchIndexOf(readHelp(root)), { query: 'placement text' }).described?.shown.find(({ name }) => name === 'Placement')?.at;
    };
    expect(await shown('src/a.test.ts')).toBe('src/b.ts');
    expect(await shown('src/c.test.ts')).toBe('src/b.ts');
  });

  it('weighs and shows a name through the row weighing most, a doc adding one rare word before one adding two words ten names hold', async () => {
    const boards = Array.from({ length: 10 }, (_, at) => `/** A chart palette. */\nexport const board${at} = ${at};\n`).join('');
    const drawn = (doc: string): string => `/** ${doc} */\nexport interface DrawKit {\n  readonly at: string;\n}\n`;
    const root = await inventedWorkspace(INVENTED_PACKAGES, ['react'], {
      'src/a.ts': drawn('The chart palette it is drawn with.'),
      'src/b.ts': drawn('Drawn as a mermaid.'),
      'src/boards.ts': boards,
    });
    const shown = searchNames(searchIndexOf(readHelp(root)), { query: 'kit mermaid chart palette' }).described?.shown.find(({ name }) => name === 'DrawKit');
    expect(shown && [shown.at, 'summary' in shown ? shown.summary : undefined, shown.words]).toEqual(['src/b.ts', 'Drawn as a mermaid.', ['kit', 'mermaid']]);
  });

  it('shows a name through the row writing the question nearer, of two weighing alike, whatever the other one says first', async () => {
    // Both `Placement` docs hold `commit` and `text` in 21 bytes; only `src/b.ts` writes them side by side, as `Rival`'s does.
    const placed = async (first: string): Promise<unknown> => describedBy(await inventedWorkspace(INVENTED_PACKAGES, ['react'], {
      'src/a.ts': `/** ${first} text at the commit. */\nexport interface Placement {\n  readonly at: string;\n}\n`,
      'src/b.ts': '/** The commit text kept. */\nexport interface Placement {\n  readonly at: string;\n}\n',
      'src/r.ts': '/** The commit text kept. */\nexport interface Rival {\n  readonly at: string;\n}\n',
    }), 'commit text shard');
    const shown = [
      ['Placement', 'src/b.ts', 'The commit text kept.', ['commit', 'text']],
      ['Rival', 'src/r.ts', 'The commit text kept.', ['commit', 'text']],
    ];
    expect(await placed('A')).toEqual(shown);
    expect(await placed('X')).toEqual(shown);
  });

  it('keeps a name in the described section by the words of the row it is shown through, never of its rows added up', async () => {
    // The three `Gadget` docs hold the three words between them, and no one of them holds two.
    const found = searchNames(searchIndexOf(readHelp(await kits({
      'a-kit': declaring('Gadget', 'Kept for the walrus.'),
      'b-kit': declaring('Gadget', 'Kept for the pelican.'),
      'c-kit': declaring('Gadget', 'Kept for the narwhal.'),
    }))), { query: 'walrus pelican narwhal' });
    expect(found.described?.shown.map((one) => one.name) ?? []).toEqual([]);
    expect(found.loose?.shown.map((one) => one.name)).toEqual(['Gadget', 'Gadget', 'Gadget']);
  });
});
