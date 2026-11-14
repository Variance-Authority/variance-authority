import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { treeOf } from '@variance-authority/mcp/tools';
import { readHelp } from '@variance-authority/package/help';
import { inventedWorkspace } from '../__fixtures__/invented-workspace.js';
import { readWorkspace } from '../read.js';
import { publishWorkspaceFromIndex } from '../refresh-native.js';
import { readWorkspaceSnapshot } from '../snapshot.js';
import type { SearchIndex } from '../search-index.js';
import { describedShown, type DescribedDeclaration } from './described.js';
import { searchNames } from './search-answer.js';
import { searchIndexOf } from './search.js';

/**
 * A declaration's signature says what it takes and what it returns, so the
 * words it writes there are evidence of what it does, below its name and its
 * doc: a row holding the question's words in its signature comes after one
 * holding them in its doc, and before one holding only the name's word.
 */

const manifest = (name: string): string =>
  JSON.stringify({ name, type: 'module', exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } }, files: ['dist'] });
const TSCONFIG = JSON.stringify({ compilerOptions: { rootDir: './src', outDir: './dist' } });

// Published, in the reverse of the order expected.
const PUBLISHED = [
  'export function matchAll(): number {\n  return 0;\n}',
  'export function matchTrees(baseline: SemanticNode, candidate: SemanticNode): number {\n  return baseline.at - candidate.at;\n}',
  '/** Pairs the baseline with the candidate. */',
  'export function matchNodes(left: SemanticNode, right: SemanticNode): number {\n  return left.at - right.at;\n}',
  'export interface SemanticNode {\n  readonly at: number;\n}',
  'export type matchShape = { readonly baseline: number };',
].join('\n');

// Exported by a file no entrypoint reaches, in the reverse of the order expected.
const UNPUBLISHED = [
  'export function coverageAll(): number {\n  return 0;\n}',
  'export function coverageTest(\n  /** The task it was asked for. */\n  task: Readonly<FinishedFile>,\n): number {\n  return task.at;\n}',
  '/** Reads it from the finished file. */',
  'export function coverageRow(): number {\n  return 0;\n}',
  'export interface FinishedFile {\n  readonly at: number;\n}',
  'export type coverageShape = { readonly finished: number };',
].join('\n');

let root: string;

beforeAll(async () => {
  root = await inventedWorkspace([], [], {
    'package.json': JSON.stringify({ name: 'fixture', private: true, workspaces: ['packages/*'] }),
    'packages/trees/package.json': manifest('trees'),
    'packages/trees/tsconfig.json': TSCONFIG,
    'packages/trees/src/index.ts': `${PUBLISHED}\n`,
    'packages/trees/src/unpublished.ts': `${UNPUBLISHED}\n`,
  });
});

afterAll(() => vi.unstubAllEnvs());

// Each reading collects the exported rows with its own collector: the package
// stage's walk of the disk, Help's join over the source index's parses, and the
// scanner's, which refreshes what was published last.
describe.each<[string, () => Promise<SearchIndex>]>([
  ['read off the disk', async () => searchIndexOf(readHelp(root))],
  ['read through the source index', async () => searchIndexOf(await readWorkspace(root))],
  ['refreshed by the scanner', async () => {
    await publishWorkspaceFromIndex(root, { readStartedAt: new Date().toISOString() });
    await publishWorkspaceFromIndex(root, { readStartedAt: new Date().toISOString() });
    return searchIndexOf(await readWorkspaceSnapshot(root));
  }],
])('the words a signature holds, %s', (_, read) => {
  let index: SearchIndex;
  beforeAll(async () => {
    index = await read();
  });

  const shownFor = (query: string) => searchNames(index, { query }, treeOf([], root), root).described?.shown ?? [];
  const describedFirst = (query: string): readonly string[] => shownFor(query).map((one) => ('name' in one ? one.name : one.at));
  const wordsOf = (query: string, name: string) => shownFor(query).find((one) => 'name' in one && one.name === name)?.words;

  it('put a published row holding them after one whose doc holds them, and leave out one holding only a common word in its name', () => {
    expect(describedFirst('match baseline candidate').filter((name) => name.startsWith('match') && name !== 'matchShape')).toEqual(['matchNodes', 'matchTrees']);
  });

  it('put an exported row holding them, its generic parameter types included, after one whose doc holds them, and leave out one holding only a common word in its name', () => {
    expect(describedFirst('coverage finished file').filter((name) => name.startsWith('coverage') && name !== 'coverageShape')).toEqual(['coverageRow', 'coverageTest']);
  });

  // A parameter's doc comment is what its author wrote about it, read as written.
  it('are the words it writes, a comment inside it included', () => {
    expect(wordsOf('coverage asked task', 'coverageTest')).toEqual(['asked', 'coverage', 'task']);
  });

  // A type alias has no head before a body: what it writes after `=` is its body.
  it('are none of a type alias, whose text is its body', () => {
    expect(wordsOf('match shape baseline', 'matchShape')).toEqual(['match', 'shape']);
    expect(wordsOf('coverage shape finished', 'coverageShape')).toEqual(['coverage', 'shape']);
  });
});

// A word only a signature holds reaches no name, and shows no row in a better one's place.
it('show no row in the place of a better one for a word only its signature holds', async () => {
  const index = searchIndexOf(readHelp(root));
  const row = (at: string, words: string[], signed: string[] = []): DescribedDeclaration => ({
    match: { source: 'declared', name: `${at}Kept`, kind: 'function', at, line: 1 },
    words, named: [], signed, near: 0, rows: 0, rank: Number.MAX_SAFE_INTEGER, docLength: 40,
  });
  const reached = [row('a.ts', ['alpha', 'gamma']), row('b.ts', ['alpha', 'gamma']), row('c.ts', ['alpha', 'beta'], ['beta'])];
  const shown = describedShown(index, 'alpha beta gamma', reached, 2, reached);
  expect(shown.map((one) => ('match' in one ? one.match.at : ''))).toEqual(['a.ts', 'b.ts']);
});

it('keep no row in view for a word only its signature holds, in the place of one holding a word nothing shown holds', async () => {
  const index = searchIndexOf(readHelp(root));
  const row = (at: string, words: string[], signed: string[] = []): DescribedDeclaration => ({
    match: { source: 'declared', name: `${at}Kept`, kind: 'function', at, line: 1 },
    words, named: [], signed, near: 0, rows: 0, rank: Number.MAX_SAFE_INTEGER, docLength: 40,
  });
  const reached = [row('a.ts', ['alpha', 'gamma']), row('x.ts', ['alpha', 'beta'], ['beta']), row('d.ts', ['delta'])];
  const shown = describedShown(index, 'alpha beta gamma delta', reached, 2, reached);
  expect(shown.map((one) => ('match' in one ? one.match.at : ''))).toEqual(['a.ts', 'd.ts']);
});
