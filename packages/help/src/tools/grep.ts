import type { FileSet, Tool, ToolInvocation } from '@variance-authority/mcp/tools';
import { START_POINT_SCHEMA, limitOf, notShown, spellingOf, startPointArg, stringArg } from '@variance-authority/mcp/tools';
import { areaLine, areaOf } from './area.js';
import { ripgrep, type Hit } from './ripgrep.js';

/**
 * `docs_grep` — ripgrep, over the files a start point reaches.
 *
 * Text is not ours to search. ripgrep owns it: the pattern language, the
 * encodings, the binary detection, the user's own `RIPGREP_CONFIG_PATH`. What
 * ripgrep cannot know is which files are in reach of the one being edited, and
 * that is the fact `search --from` already resolves. So this hands the closure
 * to `rg` as its path list and reports what `rg` found, nearest first, and adds
 * nothing to the matching — a regex here means what it means at the shell.
 *
 * ## A start point is required
 *
 * Without one the question is `rg <pattern>`, which the reader can already ask
 * and which this would only answer slower. The closure is the whole value, so a
 * call without it is refused with the command that answers it.
 *
 * ## Nearest first
 *
 * ripgrep searches in parallel and prints in whatever order the threads finish.
 * The lines are regrouped by import distance from the start point, then by path
 * in code-unit order and line, so the same question gives the same bytes, and
 * the file one import away is read before the one nine away.
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
    '`to` the files that import it. The pattern is passed to `rg` unchanged, so it is a ' +
    'regular expression and your ripgrep config applies. A start point is required: for the ' +
    'whole checkout, run `rg <pattern>` yourself.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The pattern, exactly as `rg` takes it: a regular expression.',
      },
      from: START_POINT_SCHEMA.from,
      to: START_POINT_SCHEMA.to,
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
    const { hits, errors } = grepped(input, invocation);
    const files = new Map<string, number[]>();
    for (const hit of hits) {
      const lines = files.get(hit.file);
      if (lines === undefined) files.set(hit.file, [hit.line]);
      else lines.push(hit.line);
    }
    return { files, ...(errors.length === 0 ? {} : { unread: errors.map((error) => `ripgrep: ${error}`) }) };
  },
};

/** The lines `query` matches in the area a start point reaches, nearest first, or the refusal. */
function grepped(input: Readonly<Record<string, unknown>>, invocation: ToolInvocation<unknown> | undefined) {
  const query = stringArg(input, 'query');
  const from = startPointArg(input, 'from');
  const to = startPointArg(input, 'to');
  if (from === undefined && to === undefined) {
    throw new Error(
      `\`grep\` searches the files a start point reaches, and none was given. Pass \`--from\` or ` +
        `\`--to\` with a path from the root. For the whole checkout, run \`rg ${JSON.stringify(query)}\`.`,
    );
  }

  const area = areaOf(from, to, invocation?.tree);
  if (area.refused !== undefined || invocation?.tree === undefined) {
    throw new Error(
      `\`grep\` ran nothing: ${area.refused ?? 'no source tree was read'}. Say a real path from the root — ` +
        "`src/dispatch/read.ts` is that file, `src/dispatch/*` its folder's own files, `src/dispatch/` " +
        'everything under it.',
    );
  }
  const root = invocation.tree.root;

  const distanceOf = (file: string): number => area.distance.get(file) ?? Number.POSITIVE_INFINITY;
  const ordered = [...area.files].sort((left, right) => distanceOf(left) - distanceOf(right) || byCodeUnit(left, right));

  const { hits: found, errors } = ripgrep(root, query, ordered);
  const hits: Hit[] = [...found];
  hits.sort((left, right) => distanceOf(left.file) - distanceOf(right.file) || byCodeUnit(left.file, right.file) || left.line - right.line);
  return { query, area, hits, errors, distanceOf };
}
