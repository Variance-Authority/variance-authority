import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { treeOf } from '@variance-authority/mcp/tools';
import { readHelp } from '@variance-authority/package/help';
import { inventedWorkspace } from '../__fixtures__/invented-workspace.js';
import type { SearchIndex } from '../search-index.js';
import { searchNames } from './search-answer.js';
import { searchIndexOf } from './search.js';

/**
 * Which names `search` puts first, as a fixed set of questions and the names
 * that must open their answers. A name answers by its own words before its
 * doc, by the doc's opening before the rest of it, and by every word of the
 * question before some of them; an inflected word reaches the name written in
 * its stem.
 */

const manifest = (name: string, dependencies: Readonly<Record<string, string>> = {}): string =>
  JSON.stringify({ name, type: 'module', exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } }, files: ['dist'], dependencies });
const TSCONFIG = JSON.stringify({ compilerOptions: { rootDir: './src', outDir: './dist' } });
const app = (name: string, imports: string): Readonly<Record<string, string>> => ({
  [`packages/${name}/package.json`]: manifest(name, { probes: '1.0.0' }),
  [`packages/${name}/tsconfig.json`]: TSCONFIG,
  [`packages/${name}/src/index.ts`]: `import { ${imports} } from 'probes';\n\nexport const ${name}Uses = [${imports}];\n`,
});

const PROBES = [
  '/** Wraps a module so each of its functions records that it ran. */',
  'export function instrumentModule(source: string): string {\n  return source;\n}',
  '/** Where the instrument places probes in a module. */',
  'export function probeSites(source: string): number[] {\n  return [source.length];\n}',
  '/**\n * How often a case changed its verdict between runs.\n *\n * The instrument two readings cannot be told apart by is the case itself.\n */',
  'export interface Flakiness {\n  readonly flips: number;\n}',
  '/** A region as its place in the text. */',
  'export function region(at: number): number {\n  return at;\n}',
  '/** The regions of a module, with their probes. */',
  'export interface Placed {\n  readonly at: number;\n}',
  '/** A region placed by the transform. */',
  'export const written: readonly number[] = [];',
  '/** How many there are. */',
  'export const regionCount = 0;',
].join('\n');

let index: SearchIndex;
let root: string;
const cache = process.env['VARIANCE_AUTHORITY_CACHE'];
afterEach(() => {
  if (cache === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
});

beforeAll(async () => {
  root = await inventedWorkspace([], [], {
    'package.json': JSON.stringify({ name: 'fixture', private: true, workspaces: ['packages/*'] }),
    'packages/probes/package.json': manifest('probes'),
    'packages/probes/tsconfig.json': TSCONFIG,
    'packages/probes/src/index.ts': `${PROBES}\n`,
    ...app('first', 'Flakiness, probeSites'),
    ...app('second', 'Flakiness'),
    ...app('third', 'Flakiness'),
  });
  index = searchIndexOf(readHelp(root));
});

const ask = (query: string) => searchNames(index, { query }, treeOf([], root), root);
const publishedFirst = (query: string): readonly string[] => (ask(query).published?.shown ?? []).map((one) => one.name);
const describedFirst = (query: string): readonly string[] =>
  (ask(query).described?.shown ?? []).map((one) => ('name' in one ? one.name : one.at));

describe('the names a question puts first', () => {
  it('reaches a name written in the stem of an inflected word, as an exact match', () => {
    expect(publishedFirst('instrumenting modules')).toEqual(['instrumentModule']);
    expect(publishedFirst('instrumented module')).toEqual(['instrumentModule']);
  });

  it('puts a name holding the word before a doc opening with it, and that before a doc saying it later', () => {
    // `Flakiness` is imported by three packages and `instrumentModule` by none:
    // where the word was found decides first, and the importers only within that.
    expect(publishedFirst('instrument')).toEqual(['instrumentModule', 'probeSites', 'Flakiness']);
  });

  it('puts a name holding a word of the question before a doc holding them all and no name', () => {
    const order = describedFirst('region placement');
    expect(order.slice(0, 3)).toEqual(['region', 'Placed', 'written']);
    expect(order.indexOf('regionCount')).toBeGreaterThan(order.indexOf('written'));
  });
});
