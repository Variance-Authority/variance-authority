import { beforeAll, expect, it } from 'vitest';
import { treeOf } from '@variance-authority/mcp/tools';
import { readHelp } from '@variance-authority/package/help';
import { inventedWorkspace } from '../__fixtures__/invented-workspace.js';
import type { SearchIndex } from '../search-index.js';
import { searchNames } from './search-answer.js';
import { searchIndexOf } from './search.js';

/**
 * A word a doc holds is a doc's word, never a name's, however short the doc:
 * a name holding one of the question's words, its doc the rest, sorts before
 * short docs holding the same words. A doc that says most of what was asked is
 * about it, however long it runs to say the rest: the Vite plugin whose
 * transform instruments each module holds five of the six words.
 */

const manifest = JSON.stringify({ name: 'kit', type: 'module', exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } }, files: ['dist'] });

const doc = (lines: readonly string[]): string => `/**\n${lines.map((line) => ` * ${line}`).join('\n')}\n */`;

const PROBES = [
  'Instrument a build.',
  '',
  'The Vite plugin whose transform instruments each module it is handed, so a',
  'run records which regions of the source its tests entered. It runs after every',
  'other plugin that rewrites source, since it marks the text the browser or the',
  'worker will run and not the text on disk, and it hands the rewritten source on',
  'with a map back to the text it was given, one source per map, so an error still',
  'names the line the author wrote. A module it cannot parse is handed on as it',
  'came, unmarked and unmapped, and named once in the log of the run, never thrown,',
  'since a run that cannot be measured is still a run the author asked for. Files',
  'outside the checkout, installed dependencies among them, are handed on unmarked',
  'as well: a region nobody in the repository wrote is not a region any change in',
  'it can move. The marks are plain calls into a table the worker keeps, one per',
  'region entered, read once when a case ends and cleared before the next begins,',
  'so two cases never share a mark and a case that fails still leaves what it read.',
];

const TEXT_AT = [
  'The text of every source file that differs between `commit` and the working',
  'tree, as it was at `commit`, read from the object store in one request rather',
  'than once per path, since a checkout with thousands of changed paths would',
  'otherwise wait on the store once for each of them. A path the commit does not',
  'hold is left out rather than read as an empty text, since a file added after',
  'the commit has no text there and an empty one would read as every line deleted.',
  'The texts come back in the order the paths were asked in, decoded as UTF-8, a',
  'path whose bytes do not decode named in the answer and its text left out.',
];

// Docs of about the length most docs here run to, each holding one word asked
// below in passing: what a doc of the usual length is measured against.
const usual = (at: number): string => doc([
  `The ${at}th reading of a recorded case, kept with the case that took it and`,
  'the file and the module it ran in, so a later reading of the same case can be laid beside',
  'it and the difference between the two named rather than recomputed. A reading',
  'with no case is not kept, since nothing could ask for it again, and a reading',
  'that repeats the one before it is kept once and counted, never stored twice.',
]);

const KIT = [
  doc(PROBES),
  'export function probesFor(root: string): string {\n  return root;\n}',
  'export function vitePlugin(name: string): string {\n  return name;\n}',
  '/** A plugin as Vite resolves it, as far as a hook is replaced on one. */',
  'export function hookedPlugin(name: string): string {\n  return name;\n}',
  '/** The part of a Vite transform\'s context this reads. */',
  'export function contextOf(name: string): string {\n  return name;\n}',
  'export function transformHook(name: string): string {\n  return name;\n}',
  doc(TEXT_AT),
  'export function textAt(commit: string): string {\n  return commit;\n}',
  '/** The text of a file at the commit before. */',
  "export const PRICE = 'price';",
  '/** A file a run recorded at its commit, and its text. */',
  "export const RECORDED = 'recorded';",
  '/** The text of the file at the commit it was cut at. */',
  "export const STALE = 'stale';",
  ...Array.from({ length: 12 }, (_, at) => `${usual(at)}\nexport function readingAt${at}(file: string): string {\n  return file;\n}`),
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

it('puts a long doc holding five words of six in the first rows, before short names and docs holding two or three', () => {
  expect(describedFirst('vite plugin transform hook instruments each module').slice(0, 3)).toContain('probesFor');
});

it('puts a name holding one word, its doc the rest, before short docs holding the same words', () => {
  expect(describedFirst('text of a file at a commit')[0]).toBe('textAt');
});
