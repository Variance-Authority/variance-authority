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
    'Ripgrep over the files a start point imports (`from`) or that import it (`to`), at any depth, ' +
    'matching lines nearest first. A start point is required: the file or folder you are in, or a top ' +
    'folder at the widest; one not found, or holding no match, is answered from the nearest folder ' +
    'around it that has one. Or give `test` to search only the files that test ran, each line marked ' +
    'ran or not taken. Use it for text and patterns; docs_search and docs_uses answer names.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'A ripgrep regular expression, passed unchanged.',
      },
      from: START_POINT_SCHEMA.from,
      to: START_POINT_SCHEMA.to,
      test: {
        type: 'string',
        description: 'Optional. A recorded test file, in place of `from` and `to`.',
      },
      name: {
        type: 'string',
        description: 'With `test`: the test\'s name or a word of it; optional when the file has one.',
      },
      limit: {
        type: 'integer',
        description: `Optional. Matching lines to show, the rest counted; ${SHOWN} when not said.`,
      },
      offset: {
        type: 'integer',
        minimum: 0,
        description: 'Rows to skip; an answer with more names the next.',
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
