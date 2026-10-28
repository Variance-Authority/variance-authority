import { beforeAll, expect, it } from 'vitest';
import { treeOf } from '@variance-authority/mcp/tools';
import { readHelp } from '@variance-authority/package/help';
import { inventedWorkspace } from '../__fixtures__/invented-workspace.js';
import type { SearchIndex } from '../search-index.js';
import { describedShown, type DescribedDeclaration } from './described.js';
import { searchNames } from './search-answer.js';
import { searchIndexOf } from './search.js';

/**
 * A word most of what a description reaches holds says little about which of
 * them it means. `find the repository root` is asked of a name that holds
 * `repository` and `root`, and every doc that also says `find` in passing holds
 * one word more; the rare words, held in the name, decide.
 */

const manifest = JSON.stringify({ name: 'kit', type: 'module', exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } }, files: ['dist'] });

const KIT = [
  '/** The directory a checkout spells its records from. */',
  'export function repositoryRoot(from: string): string {\n  return from;\n}',
  '/** Find the config at the root of a repository. */',
  'export function configAt(from: string): string {\n  return from;\n}',
  '/** Find what the root manifest of a repository declares. */',
  'export function declaredAt(from: string): string {\n  return from;\n}',
  '/** Find the case a frame belongs to. */',
  'export function caseOf(frame: number): number {\n  return frame;\n}',
  '/** Find the shard a file was placed on. */',
  'export function shardOf(file: string): string {\n  return file;\n}',
  '/** Find the suite a test file runs in. */',
  'export function suiteOf(file: string): string {\n  return file;\n}',
  '/** Find the baseline an image is compared with. */',
  'export function baselineOf(image: string): string {\n  return image;\n}',
  '/** Find the working copy of a file. */',
  'export function workingOf(file: string): string {',
  '  /** Find the repository root a working copy is under. */',
  '  const rootOfRepository = (at: string): string => at;',
  '  return rootOfRepository(file);',
  '}',
].join('\n');

let index: SearchIndex;
let root: string;

beforeAll(async () => {
  root = await inventedWorkspace([], [], {
    'package.json': JSON.stringify({ name: 'fixture', private: true, workspaces: ['packages/*'] }),
    'packages/kit/package.json': manifest,
    'packages/kit/tsconfig.json': JSON.stringify({ compilerOptions: { rootDir: './src', outDir: './dist' } }),
    'packages/kit/src/index.ts': `${KIT}\n`,
  });
  index = searchIndexOf(readHelp(root));
});

const describedFirst = (query: string): readonly string[] =>
  (searchNames(index, { query }, treeOf([], root), root).described?.shown ?? []).map((one) => ('name' in one ? one.name : one.at));

it('puts a name holding the rare words of a question before docs holding a common one besides', () => {
  expect(describedFirst('find the repository root')[0]).toBe('repositoryRoot');
});

it('never answers a description with a name a function body declares', () => {
  const named = searchNames(index, { query: 'find the repository root' }, treeOf([], root), root);
  expect(JSON.stringify(named)).not.toContain('rootOfRepository');
});

it('weighs a word by how many of everything the description reached hold it, not only the rows left to show', () => {
  const row = (at: string, word: string): DescribedDeclaration => ({
    match: { source: 'declared', name: `${word}Kept`, kind: 'function', at, line: 1 },
    words: [word], named: [], near: 0, rows: 0, rank: Number.MAX_SAFE_INTEGER, docLength: 40,
  });
  const left = [row('a.ts', 'alpha'), row('b.ts', 'beta')];
  // Five more rows hold `alpha`, claimed by another section: `alpha` is common, `beta` is rare.
  const population = [...left, ...['c', 'd', 'e', 'f', 'g'].map((at) => row(`${at}.ts`, 'alpha'))];
  const shown = describedShown(index, 'alpha beta', left, 2, population);
  expect(shown.map((one) => ('match' in one ? one.match.at : ''))).toEqual(['b.ts', 'a.ts']);
});
