import type { FileSet, Tool, ToolInvocation } from '@variance-authority/mcp/tools';
import { START_POINT_SCHEMA, limitOf, notShown, spellingOf, startPointArg, stringArg } from '@variance-authority/mcp/tools';
import { areaLine, areaOf, startPointNeeded } from './area.js';
import { formatGrepRan, grepRan } from './grep-ran.js';
import { ripgrep, type Hit } from './ripgrep.js';

/**
 * `docs_grep` — ripgrep, over the files a start point reaches.
 *
 * Text is not ours to search. ripgrep owns it: the pattern language, the
 * encodings, the binary detection, through its crates in the native addon. What
 * ripgrep cannot know is which files are in reach of the one being edited, and
 * that is the fact `search --from` already resolves. So this hands the closure
 * to ripgrep as its file list and reports what it found, nearest first, and adds
 * nothing to the matching — a regex here means what it means to `rg`.
 *
 * ## A start point is required
 *
 * The closure is the whole value: nearest first needs a place to measure from.
 * So a call without one is refused with how to say one, the root is refused so
 * the caller names a place, and a top folder is the widest single path.
 *
 * ## Nearest first
 *
 * ripgrep answers in the order the files were given, which is not distance.
 * The lines are regrouped by import distance from the start point, then by path
 * in code-unit order and line, so the same question gives the same bytes, and
 * the file one import away is read before the one nine away.
 *
 * ## Or a recorded test
 *
 * `test`, with `name` to choose one of its tests, replaces the start point: the
 * files searched are the ones that test entered, and each line is marked by
 * whether it ran — see `grep-ran.ts`. It is refused beside `from` or `to`, for
 * the two areas answer different questions.
 */

/** Matching lines shown when `limit` is not said. */
const SHOWN = 200;

const byCodeUnit = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

/**
 * Typed over nothing because it reads nothing of the workspace value: the tree
 * arrives on the invocation, and the text is ripgrep's.
 */
export const grep: Tool<unknown> = {
  name: 'docs_grep',
  description:
    'Run ripgrep over the files a start point reaches along the imports, and answer with the ' +
    'matching lines nearest first. `from` searches the files that path imports, at any depth; ' +
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
        description: `Matching lines to show. ${SHOWN} when not said; the rest are counted.`,
      },
    },
    required: ['query'],
    additionalProperties: false,
  },

  wants: (input) => startPointArg(input, 'from') !== undefined || startPointArg(input, 'to') !== undefined,

  run: (_help, input, invocation) => {
    const spell = spellingOf(invocation);
    const limit = limitOf(input, SHOWN, spell);
    const test = testOf(input, invocation);
    if (test !== undefined) return formatGrepRan(test.query, grepRan(test.root, test.query, test.file, test.name), limit, spell);
    const { query, area, hits, errors, distanceOf } = grepped(input, invocation);

    const header = [areaLine(area)];
    const unread =
      errors.length === 0
        ? []
        : ['', `ripgrep reported ${errors.length} ${errors.length === 1 ? 'error' : 'errors'} reading them; the first: ${errors[0]}`];

    if (hits.length === 0) {
      return [...header, ...unread, '', `Nothing in those files matches \`${query}\`.`].join('\n');
    }

    const matched = new Set(hits.map((hit) => hit.file)).size;
    const lines = [
      ...header,
      ...unread,
      '',
      `${hits.length} matching ${hits.length === 1 ? 'line' : 'lines'} in ${matched} ${matched === 1 ? 'file' : 'files'}, nearest first.`,
    ];
    let heading: number | undefined;
    for (const hit of hits.slice(0, limit)) {
      const distance = distanceOf(hit.file);
      if (distance !== heading) {
        heading = distance;
        lines.push('', `${distance} ${distance === 1 ? 'import' : 'imports'} away:`);
      }
      lines.push(`${hit.file}:${hit.line}:${hit.text}`);
    }
    if (hits.length > limit) lines.push('', notShown(hits.length - limit, spell));
    return lines.join('\n');
  },

  files: (_help, input, invocation): FileSet => {
    const test = testOf(input, invocation);
    const { hits, errors } =
      test === undefined
        ? grepped(input, invocation)
        : grepRan(test.root, test.query, test.file, test.name).answered.reduce<{ hits: Hit[]; errors: string[] }>(
            (all, marked) => ({
              hits: [...all.hits, ...marked.taken, ...marked.passed.map(({ hit }) => hit)],
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
 * The files a `grep` answer rests on: every file of the area it searched, for
 * a line in any of them may start or stop matching. A file that began importing
 * into the area after the generation, or was written under a folder the start
 * point names, is what a look at them cannot see.
 */
export function grepPrinted(_help: unknown, input: Readonly<Record<string, unknown>>, invocation?: ToolInvocation<unknown>): Iterable<string> {
  const test = testOf(input, invocation);
  if (test !== undefined) {
    return grepRan(test.root, test.query, test.file, test.name).answered.flatMap(({ ran }) => ran.modules.map((module) => module.file));
  }
  const area = areaOf(startPointArg(input, 'from'), startPointArg(input, 'to'), invocation?.tree);
  return area.refused === undefined ? area.files : [];
}

/** The recorded test the call names in place of a start point, or `undefined` when it names none. */
function testOf(input: Readonly<Record<string, unknown>>, invocation: ToolInvocation<unknown> | undefined) {
  const file = typeof input['test'] === 'string' ? input['test'].trim() : '';
  if (file === '') return undefined;
  if (startPointArg(input, 'from') !== undefined || startPointArg(input, 'to') !== undefined) {
    throw new Error('`grep` takes `--test` or a start point, not both: the files a test entered and the files a path reaches answer different questions');
  }
  const root = invocation?.root;
  if (root === undefined) throw new Error('`grep --test` reads what a checkout published, and this host named no checkout to read');
  const name = typeof input['name'] === 'string' && input['name'].trim() !== '' ? input['name'].trim() : undefined;
  return { query: stringArg(input, 'query'), root, file, name };
}

/** The lines `query` matches in the area a start point reaches, nearest first, or the refusal. */
function grepped(input: Readonly<Record<string, unknown>>, invocation: ToolInvocation<unknown> | undefined) {
  const query = stringArg(input, 'query');
  const from = startPointArg(input, 'from');
  const to = startPointArg(input, 'to');
  if (from === undefined && to === undefined) {
    throw new Error(`\`grep\` searches the files a start point reaches, and none was given. ${startPointNeeded(invocation)}`);
  }

  const area = areaOf(from, to, invocation?.tree);
  if (area.refused !== undefined || invocation?.tree === undefined) {
    throw new Error(
      `\`grep\` ran nothing: ${area.refused ?? 'no source tree was read'}. Say a real path from the root — ` +
        "`src/dispatch/read.ts` is that file, `src/dispatch/*` its folder's own files, `src/dispatch/` " +
        'everything under it.',
    );
  }
  // The walk names files from the graph's root, which a nested workspace sits below.
  const root = invocation.tree.graphRoot ?? invocation.tree.root;

  const distanceOf = (file: string): number => area.distance.get(file) ?? Number.POSITIVE_INFINITY;
  const ordered = [...area.files].sort((left, right) => distanceOf(left) - distanceOf(right) || byCodeUnit(left, right));

  const { hits: found, errors } = ripgrep(root, query, ordered);
  const hits: Hit[] = [...found];
  hits.sort((left, right) => distanceOf(left.file) - distanceOf(right.file) || byCodeUnit(left.file, right.file) || left.line - right.line);
  return { query, area, hits, errors, distanceOf };
}
