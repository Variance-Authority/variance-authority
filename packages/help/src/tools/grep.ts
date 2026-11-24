import type { FileSet, Tool, ToolInvocation } from '@variance-authority/mcp/tools';
import { START_POINT_SCHEMA, nextPage, pageAt, pageOf, paged, pathsOf, saysStartPoint, spellingOf, startPointArg, stringArg } from '@variance-authority/mcp/tools';
import { testsRan } from '@variance-authority/sense';
import { areaLine, areaOf, startPointNeeded } from './area.js';
import { byFile } from './format.js';
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
 * ripgrep answers in the order it was given files, which is not distance, so
 * the lines are regrouped by import distance, then path in code-unit order and
 * line: the same question gives the same bytes, nearest first.
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
    if (tree?.scopedGrep !== undefined && saysStartPoint(input) && page.offset <= 0xffff_ffff && page.limit <= 0xffff_ffff) {
      return tree.scopedGrep({
        query: stringArg(input, 'query'),
        from: [...pathsOf(startPointArg(input, 'from'))],
        to: [...pathsOf(startPointArg(input, 'to'))],
        ...page,
        offsetFlag: spell.input('offset'),
      });
    }
    const { query, area, hits, errors, distanceOf } = grepped(input, invocation);

    const unread =
      errors.length === 0 ? [] : [`ripgrep reported ${errors.length} ${errors.length === 1 ? 'error' : 'errors'} reading them; the first: ${errors[0]}`];

    if (hits.length === 0) {
      return [areaLine(area), ...unread.flatMap((line) => ['', line]), '', `Nothing in those files matches \`${query}\`.`].join('\n');
    }

    const matched = new Set(hits.map((hit) => hit.file)).size;
    const lines = [
      `${hits.length} matching ${hits.length === 1 ? 'line' : 'lines'} in ${matched} ${matched === 1 ? 'file' : 'files'}, nearest first:`,
      ...pageAt(page, hits.length, spell),
    ];
    // A heading per distance, and under it the rows of one file said under its path once.
    const shown = paged(hits, page);
    for (let at = 0; at < shown.length; ) {
      const distance = distanceOf(shown[at]!.file);
      let end = at;
      while (end < shown.length && distanceOf(shown[end]!.file) === distance) end++;
      lines.push(`${distance} ${distance === 1 ? 'import' : 'imports'} away:`, ...byFile(shown.slice(at, end)));
      at = end;
    }
    // The area searched bounds every count above, so it is said after them, whole or not.
    lines.push(`note: ${areaLine(area)}`);
    for (const line of unread) lines.push(`note: ${line}`);
    lines.push(...nextPage(page, hits.length, spell));
    return lines.join('\n');
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
 * The files a `grep` answer rests on: every file of the area it searched, for
 * a line in any of them may start or stop matching. A file that began importing
 * into the area after the generation, or was written under a folder the start
 * point names, is what a look at them cannot see.
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
