import { beforeAll, describe, expect, it } from 'vitest';
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
 * its stem. A name that is the question comes before every name holding it,
 * as written before in another case.
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
  '/** A region by where it starts. */',
  'export interface Region {\n  readonly start: number;\n}',
  '/** One probe, by where it is placed. */',
  'export function probe(at: number): number {\n  return at;\n}',
].join('\n');

// Exported by a file no entrypoint reaches, declared in the reverse of the order expected.
const UNPUBLISHED = [
  '/**\n * How long a run took.\n *\n * Read off the instrument.\n */',
  'export const runTime = 0;',
  '/** The calls an instrument recorded. */',
  'export const callCount = 0;',
  '/** Records every call. */',
  'export function instrumentCalls(): void {}',
  '/** One call. */',
  'export const call = 0;',
].join('\n');

// Declared and not exported: more names holding the word than a section shows, and then the word in both cases.
const KEPT = [
  ...Array.from({ length: 30 }, (_, at) => `const tally${at} = ${at};`),
  'function Tally(): number {\n  return 0;\n}',
  'function tally(): number {\n  return 0;\n}',
  'export const kept = [tally(), Tally(), tally0];',
].join('\n');

let index: SearchIndex;
let root: string;

beforeAll(async () => {
  root = await inventedWorkspace([], [], {
    'package.json': JSON.stringify({ name: 'fixture', private: true, workspaces: ['packages/*'] }),
    'packages/probes/package.json': manifest('probes'),
    'packages/probes/tsconfig.json': TSCONFIG,
    'packages/probes/src/index.ts': `${PROBES}\n`,
    'packages/probes/src/unpublished.ts': `${UNPUBLISHED}\n`,
    'packages/probes/src/kept.ts': `${KEPT}\n`,
    'packages/probes/src/counted.ts': "export { callCount } from './unpublished.js';\n",
    ...app('first', 'Flakiness, probeSites'),
    ...app('second', 'Flakiness'),
    ...app('third', 'Flakiness'),
  });
  index = searchIndexOf(readHelp(root));
});

const ask = (query: string) => searchNames(index, { query }, treeOf([], root), root);
const publishedFirst = (query: string): readonly string[] => (ask(query).published?.shown ?? []).map((one) => one.name);
const exportedFirst = (query: string): readonly string[] => (ask(query).exported?.shown ?? []).map((one) => one.name);
const declaredFirst = (query: string): readonly string[] => (ask(query).declared?.shown ?? []).map((one) => one.name);
const describedFirst = (query: string): readonly string[] =>
  (ask(query).described?.shown ?? []).map((one) => ('name' in one ? one.name : one.at));

describe('the names a question puts first', () => {
  it('reaches a name written in the stem of an inflected word, as an exact match', () => {
    expect(publishedFirst('instrumenting modules')).toEqual(['instrumentModule']);
    expect(publishedFirst('instrumented module')).toEqual(['instrumentModule']);
  });

  it('reaches a name written in the stem of a question of one inflected word', () => {
    expect(publishedFirst('instrumenting')).toEqual(['instrumentModule']);
  });

  it('puts a name holding the word before a doc opening with it, and that before a doc saying it later', () => {
    // `Flakiness` is imported by three packages and `instrumentModule` by none:
    // where the word was found decides first, and the importers only within that.
    expect(publishedFirst('instrument')).toEqual(['instrumentModule', 'probeSites', 'Flakiness']);
  });

  it('puts the name that is the question before a name holding it that more packages import', () => {
    expect(publishedFirst('probe')[0]).toBe('probe');
    expect(publishedFirst('Probe')[0]).toBe('probe');
  });

  it('puts the name as the question writes it before the same word in another case', () => {
    expect(publishedFirst('region').slice(0, 2)).toEqual(['region', 'Region']);
    expect(publishedFirst('Region').slice(0, 2)).toEqual(['Region', 'region']);
  });

  it('puts the exported name that is the question before an exported name holding it that more files export', () => {
    expect(exportedFirst('call')[0]).toBe('call');
  });

  it('puts the declared name that is the question first, then the same name in another case, however many names holding it come before them', () => {
    expect(declaredFirst('tally').slice(0, 2)).toEqual(['tally', 'Tally']);
    expect(declaredFirst('Tally').slice(0, 2)).toEqual(['Tally', 'tally']);
  });

  it('orders the names the source exports without publishing by the same fields', () => {
    expect(exportedFirst('instrument')).toEqual(['instrumentCalls', 'callCount', 'runTime']);
  });

  it('puts a name holding a word of the question before a doc holding them all and no name', () => {
    // No doc writes the words in this order, so none answers as a phrase.
    const order = describedFirst('placement region');
    expect(order.slice(0, 3)).toEqual(['region', 'Placed', 'written']);
    expect(order.indexOf('regionCount')).toBeGreaterThan(order.indexOf('written'));
  });
});

describe('the published rows a question shows', () => {
  it('are, named no checkout, every row it shows named one: the checkout adds declared names and other sections, never a published row', () => {
    // `countingShown` decides whether to open the value from the answer named no checkout.
    const shown = (query: string, checkout?: string): readonly string[] =>
      (searchNames(index, { query }, treeOf([], root), checkout).published?.shown ?? []).map((one) => `${one.name} ${one.at}`);
    const questions = ['instrument', 'probe', 'region', 'Region', 'tally', 'call', 'region placement', 'run time'];

    expect(questions.some((query) => JSON.stringify(searchNames(index, { query }, treeOf([], root), root)) !== JSON.stringify(searchNames(index, { query }, treeOf([], root))))).toBe(true);
    for (const query of questions) expect(shown(query)).toEqual(expect.arrayContaining([...shown(query, root)]));
    expect(questions.flatMap((query) => shown(query, root)).length).toBeGreaterThan(0);
  });
});
