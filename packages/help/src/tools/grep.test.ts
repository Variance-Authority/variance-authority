import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FileRecord, Tree } from '@variance-authority/mcp/tools';
import { treeOf } from '@variance-authority/mcp/tools';
import { discover } from './discover.js';
import { grep } from './grep.js';

/**
 * The closure decides which files ripgrep is given, and ripgrep decides what
 * matches in them. The checkout is written to disk because ripgrep reads files,
 * and the tree is built from records so the closure is the rule and not a scan.
 *
 * `far.ts` and `outside.ts` say the same word. Only one of them is in reach,
 * so an answer holding both was a folder search, not a closure.
 */

/** More matching lines in one file than a call can take as arguments. */
const CROWDED = 200_000;

/** A closure of thousands of files with long paths. */
const MANY = 3000;
const leaf = (at: number): string => `src/leaves/${'deep-folder-name/'.repeat(5)}leaf-${String(at).padStart(5, '0')}.ts`;

/** Five files of twenty lines below a one-child folder, forty of two, and one of thirty. */
const NEAR = Array.from({ length: 5 }, (_, at) => `wide/a/only/deep/x${at}.ts`);
const FAR = Array.from({ length: 40 }, (_, at) => `wide/b/f${String(at).padStart(2, '0')}.ts`);

let root: string;
let tree: Tree;

const reads = (file: string, ...to: readonly string[]): FileRecord =>
  to.length === 0 ? { file } : { file, edges: to.map((target) => ({ to: target, kind: 'imports' as const })) };

function write(file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'grep-'));
  write('src/entry.ts', "import './near';\nconst needle = 0;\n");
  write('src/near.ts', "import './far';\nimport './leaves';\n");
  write('src/far.ts', 'export const needle = 1;\n');
  write('src/outside.ts', 'export const needle = 2;\n');
  write('src/leaves.ts', '');
  write('src/crowded.ts', 'crowd\n'.repeat(CROWDED));
  write('wide/index.ts', '');
  for (const file of NEAR) write(file, 'broad\n'.repeat(20));
  for (const file of FAR) write(file, 'broad\n'.repeat(2));
  write('edge/at.ts', 'edge\n'.repeat(20));
  write('edge/over.ts', 'edge  \n'.repeat(21));
  write('wide/c/c1.ts', 'broad\n'.repeat(30));
  const leaves = Array.from({ length: MANY }, (_, at) => leaf(at));
  for (const [at, file] of leaves.entries()) write(file, `export const leaf${at} = ${at === MANY - 1 ? "'haystack'" : at};\n`);
  tree = treeOf(
    [
      reads('src/entry.ts', 'src/near.ts'),
      reads('src/near.ts', 'src/far.ts', 'src/leaves.ts'),
      reads('src/far.ts'),
      reads('src/outside.ts'),
      reads('src/crowded.ts'),
      reads('edge/at.ts'),
      reads('edge/over.ts'),
      reads('src/leaves.ts', ...leaves),
      ...leaves.map((file) => reads(file)),
      reads('wide/index.ts', ...NEAR, 'wide/c/c1.ts'),
      reads('wide/c/c1.ts', ...FAR),
      ...[...NEAR, ...FAR].map((file) => reads(file)),
    ],
    root,
  );
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

const ask = (input: Record<string, unknown>): string => grep.run(undefined, input, { tree });

describe('grep refuses without a closure', () => {
  it('teaches a start point, and sends nobody to another command', () => {
    const refusal = (): string => grep.run(undefined, { query: 'needle' }, { tree, shell: 'variance ask' });
    expect(refusal).toThrow('Pass `--from` or `--to` with the file or folder you are working in');
    expect(refusal).not.toThrow('rg');
  });

  it.each(['.', './'])('refuses %s as the root, not as a path the tree lacks', (path) => {
    const refusal = (): string => ask({ query: 'needle', from: path });
    expect(refusal).toThrow(`\`${path}\` is the root, and a start point is a place in it`);
    expect(refusal).not.toThrow('not found');
  });

  it('refuses a recorded test when no checkout is named to read it from', () => {
    expect(() => ask({ query: 'needle', test: 'src/entry.test.ts' })).toThrow('named no checkout to read');
  });

  it('refuses a path the tree does not hold', () => {
    expect(() => ask({ query: 'needle', from: 'src/nope.ts' })).toThrow('`src/nope.ts` is not found');
  });

  it('refuses a start point when no source tree was read', () => {
    expect(() => grep.run(undefined, { query: 'needle', from: 'src/entry.ts' })).toThrow('`grep` ran nothing: a start point is a path in the source tree, and no source tree was read');
  });
});

describe('the files a grep names, for a question that intersects them', () => {
  const files = (input: Record<string, unknown>) => grep.files!(undefined, input, { tree });

  it('holds each file in reach with its matching lines, and no file out of it', () => {
    expect(files({ query: 'needle', from: 'src/entry.ts' })).toEqual({
      files: new Map([['src/entry.ts', [2]], ['src/far.ts', [1]]]),
    });
  });

  it('refuses what a printed answer refuses', () => {
    expect(() => files({ query: 'needle' })).toThrow('none was given');
    expect(() => files({ query: 'needle', from: 'src/nope.ts' })).toThrow('`src/nope.ts` is not found');
  });
});

describe('grep over a closure', () => {
  it('answers from the files in reach, nearest first', () => {
    const text = ask({ query: 'needle', from: 'src/entry.ts' });
    expect(text).toContain('2 matching lines in 2 files, nearest first:');
    expect(text.indexOf('src/entry.ts:2: const needle = 0;')).toBeLessThan(text.indexOf('src/far.ts:1: export const needle = 1;'));
    expect(text).toContain('2 imports away:');
    expect(text).not.toContain('outside.ts');
    // The area bounds the counts, so it is said even when every file in it was read through.
    expect(text.split('\n').at(-1)).toMatch(/^note: In \d+ file\(s\) reachable from `src\/entry.ts` along the imports/u);
  });

  it('answers against the imports with `to`', () => {
    const text = ask({ query: 'needle', to: 'src/far.ts' });
    expect(text).toContain('src/far.ts:1:');
    expect(text).toContain('src/entry.ts:2:');
    expect(text).not.toContain('outside.ts');
  });

  it('reaches the last of thousands of files', () => {
    const text = ask({ query: 'haystack', from: 'src/entry.ts' });
    expect(text).toContain(`${leaf(MANY - 1)}:1:`);
    expect(text).toContain('3 imports away:');
  });

  it('answers a file that matches on more lines than a call takes as arguments', () => {
    const text = ask({ query: 'crowd', from: 'src/crowded.ts', limit: 200 });
    // The answer first, and a file with several lines named once above them.
    expect(text.split('\n').slice(0, 5)).toEqual([`${CROWDED} matching lines in 1 file, nearest first:`, '0 imports away:', 'src/crowded.ts', '  1: crowd', '  2: crowd']);
    expect(text.split('\n').filter((line) => line.startsWith('src/crowded.ts'))).toEqual(['src/crowded.ts']);
  });

  it('counts what the limit leaves out', () => {
    expect(ask({ query: 'leaf', from: 'src/leaves.ts', limit: 2 })).toContain(`${MANY - 2} more not shown; \`offset\` 2 shows the next 2.`);
  });

  it('shows the lines after an offset, with which of them they are', () => {
    const text = ask({ query: 'leaf', from: 'src/leaves.ts', limit: 2, offset: 2 });
    expect(text).toContain(`Rows 3–4 of ${MANY}.`);
    expect(text).toContain(`${MANY - 4} more not shown; \`offset\` 4 shows the next 2.`);
  });

  it('says the area held nothing, not that the word is nowhere', () => {
    expect(ask({ query: 'needle', from: 'src/leaves.ts', limit: 200 })).toContain('Nothing in those files matches `needle`.');
  });

  it('anchors `^` at every line, as ripgrep does', () => {
    expect(ask({ query: '^const needle', from: 'src/entry.ts' })).toContain('src/entry.ts:2: const needle = 0;');
  });

  it('reads the files of a workspace nested below the graph from where the graph names them', () => {
    write('app/src/entry.ts', "import './far';\n");
    write('app/src/far.ts', 'export const needle = 3;\n');
    const nested = treeOf([reads('app/src/entry.ts', 'app/src/far.ts'), reads('app/src/far.ts')], root, join(root, 'app'));

    const answer = grep.run(undefined, { query: 'needle', from: 'src/entry.ts' }, { tree: nested });

    expect(answer).toContain('app/src/far.ts:1: export const needle = 3;');
    expect(answer).not.toContain('ripgrep reported');
  });

  it("hands ripgrep's refusal back", () => {
    expect(() => ask({ query: '(', from: 'src/entry.ts' })).toThrow('ripgrep refused the pattern');
  });

  it('refuses a NUL in the pattern, which binary detection makes impossible to match, as ripgrep does', () => {
    expect(() => ask({ query: '\\x00', from: 'src/entry.ts' })).toThrow('ripgrep refused the pattern');
  });

  it('answers with no `rg` on PATH', () => {
    const path = process.env.PATH;
    process.env.PATH = '';
    try {
      expect(ask({ query: 'needle', from: 'src/entry.ts' })).toContain('src/entry.ts:2: const needle = 0;');
    } finally {
      if (path === undefined) delete process.env.PATH;
      else process.env.PATH = path;
    }
  });
});

describe('grep over more lines than it shows', () => {
  const SAID = [
    '210 matching lines in 46 files, the first 10, nearest first:',
    '1 import away:',
    NEAR[0],
    ...Array.from({ length: 10 }, (_, at) => `  ${at + 1}: broad`),
    'All 210, by path, most lines first:',
    'wide/b/ — 80 lines in 40 files, nearest 2 imports away',
    'wide/c/c1.ts — 30 lines, 1 import away',
    ...NEAR.map((file) => `${file} — 20 lines, 1 import away`),
  ];

  it('shows the nearest few, then says where they all are, by path, and what answers less and what answers all of it', () => {
    const lines = ask({ query: 'broad', from: 'wide/index.ts' }).split('\n');
    expect(lines.slice(0, SAID.length)).toEqual(SAID);
    expect(lines.slice(SAID.length)).toEqual([
      'note: In 47 file(s) reachable from `wide/index.ts` along the imports, at any depth — 1 named by the path itself.',
      `\`${discover.name}\` with \`from\` \`["wide/index.ts"]\` and \`path\` \`^wide/b/\` and \`text\` \`broad\`: the 40 matching files under \`wide/b/\``,
      '`limit` 210: every line, nearest first',
    ]);
  });

  it('names a question that answers the files it counted', () => {
    const printed = /^`docs_discover` with `from` `(.+)` and `path` `(.+)` and `text` `(.+)`: the 40 matching files/mu.exec(ask({ query: 'broad', from: 'wide/index.ts' }));
    const [, from = '', path, text] = printed ?? [];
    expect(discover.run(undefined, { from: JSON.parse(from), path, text }, { tree })).toContain('40 files in all of them');
  });

  it('spells the question as a shell takes it', () => {
    const shell = (query: string): string => grep.run(undefined, { query, from: 'wide/index.ts' }, { tree, shell: 'variance ask' });
    expect(shell('broad')).toContain("\n`variance ask discover --from wide/index.ts --path '^wide/b/' --text broad`: the 40 matching files under `wide/b/`\n`--limit` 210: every line");
    expect(shell("broad|it's")).toContain("--text 'broad|it'\\''s'`");
    expect(shell('--broad|broad')).toContain("--text='--broad|broad'`");
    expect(shell('-*broad')).toContain("--text='-*broad'`");
  });

  it('names no question where discover answers another set', () => {
    for (const start of [{ from: ['wide/a/', 'wide/b/', 'wide/c/'] }, { from: 'wide/', to: 'wide/' }]) {
      const text = ask({ query: 'broad', ...start });
      expect(text).toContain(' matching lines in 46 files, the first 10, ');
      expect(text).not.toContain(discover.name);
    }
  });

  it('names no question where the pattern is blank, which discover drops', () => {
    const text = ask({ query: '  ', from: 'edge/over.ts' });
    expect(text).toContain('21 matching lines in 1 file, the first 10, nearest first:');
    expect(text).not.toContain(discover.name);
  });

  it('names no question where the start point holds a comma, which discover splits', () => {
    const file = 'odd/a,b.ts';
    write(file, 'odd\n'.repeat(21));
    const text = grep.run(undefined, { query: 'odd', from: [file] }, { tree: treeOf([reads(file)], root) });
    expect(text).toContain('21 matching lines in 1 file, the first 10, nearest first:');
    expect(text).not.toContain(discover.name);
  });

  it('names no question where a `#` follows a file of the tree, which discover reads as a name it exports', () => {
    const file = 'odd/a.ts#over.ts';
    write(file, 'odd\n'.repeat(21));
    const named = treeOf([reads(file), reads('odd/a.ts')], root);
    const lines = (direction: 'from' | 'to'): string[] => grep.run(undefined, { query: 'odd', [direction]: file }, { tree: named, shell: 'variance ask' }).split('\n');
    expect(lines('to').filter((line) => line.includes('discover'))).toEqual([]);
    expect(lines('from').filter((line) => line.includes('discover'))).not.toEqual([]);
  });

  it('names no question for a workspace nested below the graph, whose files discover opens elsewhere', () => {
    write('app/src/start.ts', "import './flood';\n");
    write('app/src/flood.ts', 'flood\n'.repeat(21));
    const nested = treeOf([reads('app/src/start.ts', 'app/src/flood.ts'), reads('app/src/flood.ts')], root, join(root, 'app'));
    const text = grep.run(undefined, { query: '^flood', from: 'src/start.ts' }, { tree: nested });
    expect(text).toContain('21 matching lines in 1 file, the first 10, nearest first:');
    expect(text).not.toContain(discover.name);
  });

  it('says one row of a file that holds every line', () => {
    const lines = ask({ query: 'crowd', from: 'src/crowded.ts' }).split('\n');
    expect(lines[0]).toBe(`${CROWDED} matching lines in 1 file, the first 10, nearest first:`);
    expect(lines.slice(13, 15)).toEqual([`All ${CROWDED}, by path, most lines first:`, `src/crowded.ts — ${CROWDED} lines`]);
  });

  it('counts what it has no row for', () => {
    const lines = ask({ query: 'leaf', from: 'src/leaves.ts' }).split('\n');
    const rows = lines.filter((line) => line.includes(' — ') && !line.startsWith('note:'));
    expect(rows).toHaveLength(10);
    expect(rows[0]).toBe(`the rest of src/leaves/${'deep-folder-name/'.repeat(5)} — ${MANY - 9} lines in ${MANY - 9} files`);
  });

  it.each([{ limit: 5 }, { offset: 5 }, { limit: 210 }])('shows lines when a page is said: %o', (said) => {
    expect(ask({ query: 'broad', from: 'wide/index.ts', ...said })).toContain('210 matching lines in 46 files, nearest first:');
  });

  it('shows a page of twenty where an offset is said and no limit', () => {
    const text = ask({ query: 'broad', from: 'wide/index.ts', offset: 5 });
    expect(text).toContain('Rows 6–25 of 210.');
    expect(text).toContain('185 more not shown; `offset` 25 shows the next 20.');
  });

  it('shows every line where they are no more than it shows', () => {
    expect(ask({ query: 'edge', from: 'edge/at.ts' }).split('\n')).toHaveLength(24);
    expect(ask({ query: 'edge', from: 'edge/at.ts' })).toContain('20 matching lines in 1 file, nearest first:');
    expect(ask({ query: 'edge', from: 'edge/over.ts' })).toContain('21 matching lines in 1 file, the first 10, nearest first:');
  });
});

describe('grep of a start point that answers nothing', () => {
  /** What the call prints, or what it refuses with. */
  const said = (input: Record<string, unknown>): string => {
    try {
      return ask(input);
    } catch (refusal) {
      return `refused: ${(refusal as Error).message}`;
    }
  };
  /** What the call says when it looks nowhere else, which a page said asks for. */
  const alone = (input: Record<string, unknown>): string => said({ ...input, limit: 200 });

  const NEEDLES = [
    'src/entry.ts:2: const needle = 0;',
    'src/far.ts:1: export const needle = 1;',
    'src/outside.ts:1: export const needle = 2;',
  ];

  it.each([
    ['a path the tree does not hold', { from: 'src/nope.ts' }, 'refused: `src/nope.ts` is not found.', 'reachable from'],
    ['a reach that holds no match', { from: 'src/leaves.ts' }, `No match in the ${MANY + 1} files reachable from \`src/leaves.ts\`.`, 'reachable from'],
    ['a folder whose reach holds no match', { from: 'src/leaves/' }, `No match in the ${MANY} files reachable from \`src/leaves/\`.`, 'reachable from'],
    ["a folder's own files", { from: 'src/leaves/deep-folder-name/*' }, 'refused: `src/leaves/deep-folder-name/*` is not found.', 'reachable from'],
    ['a path of two slashes', { from: 'src//nope.ts' }, 'refused: `src//nope.ts` is not found.', 'reachable from'],
    ['a path against the imports', { to: 'src/nope.ts' }, 'refused: `src/nope.ts` is not found.', 'reaching'],
  ])('answers from the folder around %s, in one line and the rows', (_, start, opens, along) => {
    expect(said({ query: 'needle', ...start }).split('\n')).toEqual([`${opens} 3 matching lines in 3 files ${along} \`src/\`, nearest first:`, ...NEEDLES]);
  });

  it('says how far a line outside the folder is, and nothing of the folder itself', () => {
    write('around/in/blank.ts', '');
    write('around/near.ts', "import '../beyond/far';\n");
    write('beyond/far.ts', 'const beyond = 1;\n');
    const records = [reads('around/in/blank.ts'), reads('around/near.ts', 'beyond/far.ts'), reads('beyond/far.ts')];
    expect(grep.run(undefined, { query: 'beyond =', from: 'around/in/blank.ts' }, { tree: treeOf(records, root) }).split('\n')).toEqual([
      'No match in the 1 file reachable from `around/in/blank.ts`. 1 matching line in 1 file reachable from `around/`:',
      '1 import away:',
      'beyond/far.ts:1: const beyond = 1;',
    ]);
  });

  it('keeps what it could not read, of the path asked about and of the folder', () => {
    write('around/hit.ts', 'const partial = 1;\n');
    const records = [reads('around/gone.ts'), reads('around/hit.ts')];
    const text = grep.run(undefined, { query: 'partial', from: 'around/gone.ts' }, { tree: treeOf(records, root) });
    expect(text).toContain('reachable from `around/`:\naround/hit.ts:1: const partial = 1;\nnote: ripgrep reported 1 error reading them; the first: ');
    expect(text.split('\n')).toHaveLength(3);
  });

  it('stops at the nearest folder with a match', () => {
    expect(said({ query: 'broad', from: 'wide/a/only/deep/nope.ts' })).toContain('100 matching lines in 10 files reachable from `wide/a/only/deep/`, nearest first:\n');
    expect(said({ query: 'broad', from: 'wide/a/nope/nope/nope.ts' })).toContain('100 matching lines in 10 files reachable from `wide/a/`, nearest first:\n');
    expect(said({ query: 'broad', from: 'wide/a/only/nope.ts' })).toContain('reachable from `wide/a/only/`, nearest first:\n');
  });

  it('collapses a folder of more lines than it shows, and asks on from that folder', () => {
    const text = said({ query: 'broad', from: 'wide/nope.ts' });
    expect(text).toMatch(/^refused: `wide\/nope\.ts` is not found\. 210 matching lines in 51 files reachable from `wide\/`, by path, most lines first:\n/u);
    expect(text).not.toContain('note:');
    expect(text).toContain('`docs_discover` with `from` `["wide/"]`');
    expect(text.split('\n').at(-1)).toBe('`docs_grep` with `query` `broad` and `from` `["wide/"]` and `limit` `210`: every line, nearest first');
    expect(ask({ query: 'broad', from: ['wide/'], limit: 210 })).not.toContain('more not shown');
    expect(() => grep.run(undefined, { query: 'broad', from: 'wide/nope.ts' }, { tree, shell: 'variance ask' })).toThrow(
      /\n`variance ask grep --query broad --from wide\/ --limit 210`: every line, nearest first$/u,
    );
  });

  it('names the folder from the root when the path is absolute', () => {
    expect(said({ query: 'needle', from: join(root, 'src/nope.ts') })).toContain('3 files reachable from `src/`, nearest first:');
  });

  it.each([
    ['no folder around it holds a match, though the root does', { query: 'needle', from: 'wide/index.ts' }],
    ['no folder around a missing path holds a match', { query: 'needle', from: 'wide/nope.ts' }],
    ['a top folder holds no match', { query: 'needle', from: 'wide/' }],
    ['a missing path has no folder around it', { query: 'needle', from: 'nope.ts' }],
    ['no folder around a missing path is in the tree', { query: 'needle', from: 'nope/nope.ts' }],
    ['a folder with a similar name holds the match', { query: 'needle', from: 'srcs/entry.ts' }],
    ['the path leaves the folder it names', { query: 'needle', from: 'src/../nope.ts' }],
    ['the path is spelled from here', { query: 'needle', from: './src/nope.ts' }],
    ['the path stands still', { query: 'needle', from: 'src/./nope.ts' }],
    ['a backslash is a character in the name', { query: 'needle', from: 'src\\nope.ts' }],
    ['the path is the root', { query: 'needle', from: './' }],
    ['two start points are said', { query: 'needle', from: ['src/leaves.ts', 'src/crowded.ts'] }],
    ['one of two start points is missing', { query: 'needle', from: 'src/leaves.ts', to: 'src/nope.ts' }],
    ['the start point answers', { query: 'needle', from: 'src/far.ts' }],
  ])('looks nowhere else when %s', (_, input) => {
    expect(said(input)).toBe(alone(input));
  });

  it.each([{ limit: 5 }, { offset: 0 }])('looks nowhere else when a page is said: %o', (page) => {
    expect(said({ query: 'needle', from: 'src/leaves.ts', ...page })).toMatch(/\n\nNothing in those files matches `needle`\.$/u);
    expect(said({ query: 'needle', from: 'src/nope.ts', ...page })).toMatch(/^refused: `grep` ran nothing: .+ everything under it\.$/u);
  });

  it('refuses a missing path as missing under a broken pattern', () => {
    expect(said({ query: '(', from: 'src/nope.ts' })).toBe(alone({ query: '(', from: 'src/nope.ts' }));
  });
});
