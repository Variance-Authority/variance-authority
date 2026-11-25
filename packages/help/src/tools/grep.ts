import type { FileSet, Tool, ToolInvocation } from '@variance-authority/mcp/tools';
import { START_POINT_SCHEMA, pageOf, pathsOf, saysStartPoint, spellingOf, startPointArg, stringArg } from '@variance-authority/mcp/tools';
import { testsRan } from '@variance-authority/sense';
import { areaOf, startPointNeeded } from './area.js';
import { formatGrepRan, grepRan } from './grep-ran.js';
import { ripgrep, type Hit } from './ripgrep.js';

/**
 * `docs_grep` — ripgrep, over the files a start point reaches, or the files one
 * recorded test entered (`grep-ran.ts`).
 *
 * Text is ripgrep's: its pattern language, encodings and binary detection,
 * unchanged. What it cannot know is which files are in reach, and `search
 * --from` already resolves that, so the closure is ripgrep's file list. The
 * closure is the whole value, so a call without a start point is refused, and
 * the root too: a top folder is the widest single path.
 *
 * The answer is the addon's (`help_grep_answer.rs`): the lines by import
 * distance, or the first of them and the paths they are all in when nobody
 * said how many lines to show and there are too many to.
 */

/** Matching lines shown when `limit` is not said; past it a scoped answer is the nearest few, its paths and their counts. */
const SHOWN = 20;

/**
 * Typed over nothing because it reads nothing of the workspace value: the tree
 * arrives on the invocation, and the text is ripgrep's.
 */
export const grep: Tool<unknown> = {
  name: 'docs_grep',
  description:
    'Run ripgrep over the files a start point reaches along the imports, and answer with the ' +
    'matching lines nearest first; past ' +
    `${SHOWN} of them, and no \`limit\` or \`offset\` said, with the nearest few, then the paths they are ` +
    'all in, the line count of each, and what lists them. One start point that is not found or holds no match, and no ' +
    '`limit` or `offset` said, is answered from the nearest folder around it that has ' +
    'one. `from` searches the files that path imports, at any depth; ' +
    '`to` the files that import it. The pattern is ripgrep\'s, unchanged: a ' +
    'regular expression. A start point is required: name the file or ' +
    'folder you are working in, or a top folder at the widest. Or name a recorded test with `test` ' +
    '(and `name` for one of its tests) instead: the files searched are those the test entered, and ' +
    'each line is marked ran, or not taken with the branch or function the test did not enter.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The pattern, exactly as ripgrep takes it: a regular expression.',
      },
      from: START_POINT_SCHEMA.from,
      to: START_POINT_SCHEMA.to,
      test: {
        type: 'string',
        description: 'A recorded test file, in place of `from` and `to`: search only the files its test entered.',
      },
      name: {
        type: 'string',
        description: 'With `test`, optional when the file declares one recorded test: the test\'s name, or a word of it.',
      },
      limit: {
        type: 'integer',
        description: `Matching lines to show; the rest are counted. Not said, the answer shows ${SHOWN} lines, and with a start point an answer of more is the nearest few and its paths.`,
      },
      offset: {
        type: 'integer',
        minimum: 0,
        description: 'Rows to skip before the first shown; an answer with more names the next. 0 when not said.',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },

  wants: saysStartPoint,

  run: (_help, input, invocation) => {
    const spell = spellingOf(invocation);
    const page = pageOf(input, SHOWN, spell);
    const test = testOf(input, invocation);
    if (test !== undefined) return formatGrepRan(test.query, grepRan(test.root, test.query, test.file, test.name), page, spell);
    const tree = invocation?.tree;
    const query = stringArg(input, 'query');
    if (!saysStartPoint(input)) throw noStartPoint(invocation);
    if (tree === undefined) throw ranNothing(areaOf(startPointArg(input, 'from'), startPointArg(input, 'to'), undefined).refused);
    return tree.scopedGrep({
      query,
      from: [...pathsOf(startPointArg(input, 'from'))],
      to: [...pathsOf(startPointArg(input, 'to'))],
      // The page is said only where the caller said it: an answer past an unsaid one collapses.
      ...(input['limit'] === undefined ? {} : { limit: page.limit }),
      ...(input['offset'] === undefined ? {} : { offset: page.offset }),
      ...(invocation?.shell === undefined ? {} : { shell: invocation.shell }),
    });
  },

  files: (_help, input, invocation): FileSet => {
    const test = testOf(input, invocation);
    const { hits, errors } =
      test === undefined
        ? grepped(input, invocation)
        : grepRan(test.root, test.query, test.file, test.name).answered.reduce<{ hits: Hit[]; errors: string[] }>(
            (all, marked) => ({
              hits: [...all.hits, ...marked.taken, ...marked.passed.map(({ hit }) => hit), ...marked.written],
              errors: [...all.errors, ...marked.errors],
            }),
            { hits: [], errors: [] },
          );
    const files = new Map<string, number[]>();
    for (const hit of hits) {
      const lines = files.get(hit.file);
      if (lines === undefined) files.set(hit.file, [hit.line]);
      else lines.push(hit.line);
    }
    return { files, ...(errors.length === 0 ? {} : { unread: errors.map((error) => `ripgrep: ${error}`) }) };
  },
};

/**
 * The files a `grep` answer rests on: every file of the area it was asked
 * about, for a line in any of them may start or stop matching. A file that began
 * importing into the area after the generation, or was written under a folder
 * the start point names, is what a look at them cannot see. A folder around it,
 * answered from where that area holds no match, is not among them.
 */
export function grepPrinted(_help: unknown, input: Readonly<Record<string, unknown>>, invocation?: ToolInvocation<unknown>): Iterable<string> {
  const test = testOf(input, invocation);
  if (test !== undefined) {
    return testsRan(test.root, test.file, test.name).flatMap(({ ran }) => ran.modules.map((module) => module.file));
  }
  const area = areaOf(startPointArg(input, 'from'), startPointArg(input, 'to'), invocation?.tree);
  return area.refused === undefined ? area.files : [];
}

/** The recorded test the call names in place of a start point, or `undefined` when it names none. */
function testOf(input: Readonly<Record<string, unknown>>, invocation: ToolInvocation<unknown> | undefined) {
  const file = typeof input['test'] === 'string' ? input['test'].trim() : '';
  if (file === '') {
    if (typeof input['name'] === 'string' && input['name'].trim() !== '') throw new Error('`--name` picks a test in the `--test` file, and no `--test` was given');
    return undefined;
  }
  if (startPointArg(input, 'from') !== undefined || startPointArg(input, 'to') !== undefined) {
    throw new Error('`grep` takes `--test` or a start point, not both: the files a test entered and the files a path reaches answer different questions');
  }
  const root = invocation?.root;
  if (root === undefined) throw new Error('`grep --test` reads what a checkout published, and this host named no checkout to read');
  const name = typeof input['name'] === 'string' && input['name'].trim() !== '' ? input['name'].trim() : undefined;
  return { query: stringArg(input, 'query'), root, file, name };
}

/** The lines `query` matches in the area a start point reaches, or the refusal. */
function grepped(input: Readonly<Record<string, unknown>>, invocation: ToolInvocation<unknown> | undefined) {
  const query = stringArg(input, 'query');
  if (!saysStartPoint(input)) throw noStartPoint(invocation);

  const area = areaOf(startPointArg(input, 'from'), startPointArg(input, 'to'), invocation?.tree);
  if (area.refused !== undefined || invocation?.tree === undefined) throw ranNothing(area.refused);
  // The walk names files from the graph's root, which a nested workspace sits below.
  const root = invocation.tree.graphRoot ?? invocation.tree.root;

  return ripgrep(root, query, [...area.files]);
}

function noStartPoint(invocation: ToolInvocation<unknown> | undefined): Error {
  return new Error(`\`grep\` searches the files a start point reaches, and none was given. ${startPointNeeded(invocation)}`);
}

function ranNothing(refused = 'no source tree was read'): Error {
  return new Error(
    `\`grep\` ran nothing: ${refused}. Say a real path from the root — ` +
      "`src/dispatch/read.ts` is that file, `src/dispatch/*` its folder's own files, `src/dispatch/` " +
      'everything under it.',
  );
}
