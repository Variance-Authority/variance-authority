import { beforeAll, describe, expect, it } from 'vitest';
import { treeOf } from '@variance-authority/mcp/tools';
import { readHelp } from '@variance-authority/package/help';
import { nearOfNative } from '@variance-authority/sense';
import { inventedWorkspace } from '../__fixtures__/invented-workspace.js';
import type { SearchIndex } from '../search-index.js';
import { searchNames } from './search-answer.js';
import { searchIndexOf } from './search.js';

/**
 * A doc writes a question of several words when one paragraph holds them in
 * order, each as many words after the last as in the question, read by stem
 * the way search reads every word: punctuation and a possessive between them
 * do not break the phrase, a word between them does, and a function word the
 * question drops still holds its place. A run in the opening paragraph ranks
 * first. The described section counts a doc's pairs by the same rule.
 */

const manifest = (name: string): string =>
  JSON.stringify({ name, type: 'module', exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } }, files: ['dist'] });
const TSCONFIG = JSON.stringify({ compilerOptions: { rootDir: './src', outDir: './dist' } });

const SINKS = [
  "/** Source that installs the page's sink. */",
  "export function eventCollectorSource(): string {\n  return '';\n}",
  '/** The sink one page writes to. */',
  'export const sinkOf = 0;',
  '/** Each page and its sink. */',
  'export const pages = 0;',
  '/** A region placed by the transform. */',
  'export const written: readonly number[] = [];',
  "export const EVENT_SINK = 'vae';",
  '/** The text of the file at the commit. */',
  'export const textOf = 0;',
  '/**\n * Kept apart.\n *\n * The cache sweep.\n */',
  'export const later = 0;',
  '/** The cache sweep, first. */',
  'export const opening = 0;',
].join('\n');

let index: SearchIndex;
let root: string;

beforeAll(async () => {
  root = await inventedWorkspace([], [], {
    'package.json': JSON.stringify({ name: 'fixture', private: true, workspaces: ['packages/*'] }),
    'packages/event/package.json': manifest('event'),
    'packages/event/tsconfig.json': TSCONFIG,
    'packages/event/src/index.ts': `${SINKS}\n`,
  });
  index = searchIndexOf(readHelp(root));
});

const ask = (query: string) => searchNames(index, { query }, treeOf([], root), root);
const publishedFirst = (query: string): readonly string[] => (ask(query).published?.shown ?? []).map((one) => one.name);

describe('a doc that writes the question as a phrase', () => {
  it('holds the words in order by stem, a possessive between them, and answers with it first', () => {
    // `sinkOf` writes the words the other way round and `pages` writes `and its` between them.
    expect(publishedFirst('page sink')).toEqual(['eventCollectorSource']);
    expect(ask('page sink').described).toBeUndefined();
  });

  it('holds an inflected word by its stem', () => {
    expect(publishedFirst('region placement')).toEqual(['written']);
  });

  it('is not written by a doc holding the words the other way round', () => {
    expect(publishedFirst('placement region')).toEqual([]);
  });

  it('holds a word the question drops at its place, any word filling it', () => {
    expect(publishedFirst('text of a file at a commit')).toEqual(['textOf']);
    expect(publishedFirst('text file commit')).toEqual([]);
  });

  it('asks nothing before the run for a word the question drops ahead of its first', () => {
    expect(publishedFirst('the source that installs')).toEqual(['eventCollectorSource']);
  });

  it('ranks a doc that writes it in its opening paragraph above one that writes it later', () => {
    expect(publishedFirst('cache sweep')).toEqual(['opening', 'later']);
  });

  it('is the rule the described section counts pairs by', () => {
    const docs = ["Source that installs the page's sink.", 'The sink one page writes to.', 'Each page and its sink.'];
    expect(nearOfNative('page sink', docs)).toEqual([1, 0, 0]);
  });
});
