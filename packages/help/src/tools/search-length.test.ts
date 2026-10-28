import { beforeAll, expect, it } from 'vitest';
import { treeOf } from '@variance-authority/mcp/tools';
import { readHelp } from '@variance-authority/package/help';
import { inventedWorkspace } from '../__fixtures__/invented-workspace.js';
import type { SearchIndex } from '../search-index.js';
import { searchNames } from './search-answer.js';
import { searchIndexOf } from './search.js';

/**
 * A long doc holds most words by chance: it mentions a repository and a root
 * on its way to saying what it is about. A word held in a short text says more
 * about that text than the same word held in a long one, so a short
 * declaration whose name holds the question's words sorts before long docs
 * that hold them, and one word more, in passing.
 */

const manifest = JSON.stringify({ name: 'kit', type: 'module', exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } }, files: ['dist'] });

const FINDING = [
  'One diagnostic the TypeScript compiler reported, as the checker hands it on.',
  'The compiler runs once per project, with the configuration that project declares,',
  'and every diagnostic it writes is kept with the file and the line it names, its',
  'message chain flattened to one sentence, and the code the compiler gave it. A',
  'diagnostic about a file outside the repository, in a declaration file a dependency',
  'ships, is kept as well, since the compiler reported it and the checker does not',
  'second-guess the compiler. Paths are written relative to the root the checker was',
  'started in, so two machines that check the same commit write the same diagnostics',
  'in the same order, and a diagnostic that moved by a line reads as moved rather than',
  'as one gone and one new. The severity is the compiler\'s own: an error stays an',
  'error, a suggestion stays a suggestion, and the checker never promotes one to the',
  'other. Diagnostics the compiler groups under one related location are kept as one',
  'diagnostic with that location beside it, the way an editor shows them.',
];

const ROOTED = [
  'A provenance whose file is written against the checkout, rewritten against the',
  'directory the server serves from, so the browser can fetch it. A path inside the',
  'repository is not something a browser can fetch: the server mounts one directory,',
  'and the browser asks for paths under it. The rewrite keeps the line and the column,',
  'since they name a place in the text and the text did not move, and drops nothing',
  'else the provenance carries. A provenance already written against the served',
  'directory is returned as it was, and one whose file is outside it is returned as',
  'it was too, since no rewrite makes it fetchable and the caller decides what to',
  'show for it. Callers find the served directory once per run and pass it to every',
  'call, which keeps this a pure function of its arguments, cheap to call per node',
  'of a tree, and trivially the same on every machine that serves the same build.',
];

const RECORDED = [
  'One frame of a recorded run, as the player replays it. A frame is what the page',
  'showed at one moment: the pixels, the regions that moved since the frame before,',
  'and the input that moved them. The player shows a long run frame by frame, and',
  'the answer to where a region came from is the first frame it appears in, read',
  'from the regions alone without decoding a single pixel. A frame the recorder',
  'could not settle is kept and marked, since leaving it out would make the frames',
  'after it look as if they moved more than they did. The pixels are stored once',
  'per distinct image, so a still part of a run costs one image and a frame',
  'pointing at it, and the regions are stored in the order the page painted them,',
  'which the player replays them in. Two recordings of the same run on the same',
  'image hold the same frames byte for byte, so a recording compares by its digest',
  'before anything is decoded, and the rest of the frames are only read when the',
  'digests differ. A count of frames is not stored: it is the length of the list.',
];

const PLAYER = [
  'The player that replays a recorded run in a browser, frame after frame. It',
  'reads the frames lazily, so a long recording opens as fast as a short one, and',
  'it seeks by the regions alone, which answer which frame first showed a part of',
  'the page without decoding the pixels of any frame before it. Each frame is',
  'painted onto one canvas, the regions that moved outlined over it, and the input',
  'that moved them written beside it, so a reviewer sees what changed and why on',
  'one screen. The player keeps no state of its own beyond the frame it is on:',
  'reloading the page and seeking to the same frame shows the same thing, the',
  'rest of its state lives in the address bar, and a link to a frame is a link',
  'to that moment of that run for anybody who opens it. Keys step one frame, and',
  'a count typed before a key steps that many, the way a pager moves by lines.',
];

const doc = (lines: readonly string[]): string => `/**\n${lines.map((line) => ` * ${line}`).join('\n')}\n */`;

const KIT = [
  '/** The checkout `from` sits in. */',
  'export function repositoryRoot(from: string): string {\n  return from;\n}',
  doc(FINDING),
  'export interface TypescriptFinding {\n  readonly file: string;\n}',
  doc(ROOTED),
  'function rooted(file: string): string {\n  return file;\n}',
  '/** Find the case a frame belongs to. */',
  'export function findCase(frame: number): number {\n  return frame;\n}',
  '/** Find the shard a file was placed on. */',
  'export function findShard(file: string): string {\n  return file;\n}',
  '/** The repository a run reads. */',
  "export const REPOSITORY = 'origin';",
  '/** The root a run reads. */',
  "export const ROOT = '/';",
  '/** A part of an answer listed a row per value, at most `limit` rows, and the rest counted on one more line. */',
  'export function cappedRows(values: readonly string[], limit: number): readonly string[] {\n  return values.slice(0, limit);\n}',
  doc(RECORDED),
  'export interface RecordedFrame {\n  readonly at: number;\n}',
  doc(PLAYER),
  'export function player(frames: readonly number[]): number {\n  return frames.length;\n}',
  '/** The rest of a line. */',
  'export function restOf(line: string): string {\n  return line;\n}',
  '/** The part of a path after its directory. */',
  'export function partOf(path: string): string {\n  return path;\n}',
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

it('puts a short name holding the question before long docs that hold it and one word more', () => {
  expect(describedFirst('find the repository root')[0]).toBe('repositoryRoot');
});

it('puts a short doc holding most of the question before long docs that hold all of it', () => {
  expect(describedFirst('cap a long part of an answer and count the rest')[0]).toBe('cappedRows');
});
