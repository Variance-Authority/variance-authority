import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { treeOf } from '@variance-authority/mcp/tools';
import { readHelp } from '@variance-authority/package/help';
import { inventedWorkspace } from '../__fixtures__/invented-workspace.js';
import type { SearchIndex } from '../search-index.js';
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
].join('\n');

// Exported by a file no entrypoint reaches, in the reverse of the order expected.
const UNPUBLISHED = [
  'export function coverageAll(): number {\n  return 0;\n}',
  'export function coverageTest(\n  /** The task it was asked for. */\n  task: FinishedFile,\n): number {\n  return task.at;\n}',
  '/** Reads it from the finished file. */',
  'export function coverageRow(): number {\n  return 0;\n}',
  'export interface FinishedFile {\n  readonly at: number;\n}',
].join('\n');

let index: SearchIndex;
let root: string;

beforeAll(async () => {
  root = await inventedWorkspace([], [], {
    'package.json': JSON.stringify({ name: 'fixture', private: true, workspaces: ['packages/*'] }),
    'packages/trees/package.json': manifest('trees'),
    'packages/trees/tsconfig.json': TSCONFIG,
    'packages/trees/src/index.ts': `${PUBLISHED}\n`,
    'packages/trees/src/unpublished.ts': `${UNPUBLISHED}\n`,
  });
  index = searchIndexOf(readHelp(root));
});

afterAll(() => vi.unstubAllEnvs());

const describedFirst = (query: string): readonly string[] =>
  (searchNames(index, { query }, treeOf([], root), root).described?.shown ?? []).map((one) => ('name' in one ? one.name : one.at));

describe('the words a signature holds', () => {
  it('put a published row holding them after one whose doc holds them, and before one holding only its name', () => {
    expect(describedFirst('match baseline candidate').filter((name) => name.startsWith('match'))).toEqual(['matchNodes', 'matchTrees', 'matchAll']);
  });

  it('put an exported row holding them, its parameter types and their comments included, after one whose doc holds them, and before one holding only its name', () => {
    expect(describedFirst('coverage finished file').filter((name) => name.startsWith('coverage'))).toEqual(['coverageRow', 'coverageTest', 'coverageAll']);
    expect(describedFirst('coverage asked task').filter((name) => name.startsWith('coverage'))[0]).toBe('coverageTest');
  });
});
