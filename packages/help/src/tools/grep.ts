import { spawnSync } from 'node:child_process';
import type { Tool } from '@variance-authority/mcp/tools';
import { START_POINT_SCHEMA, startPointArg, stringArg } from '@variance-authority/mcp/tools';
import { areaLine, areaOf } from './area.js';

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

/** Longer lines are cut: one match in a minified bundle is a megabyte of line. */
const WIDEST = 240;

/**
 * Bytes of paths per `rg` call. macOS allows 1 MiB of argv and environment
 * together, so a closure of tens of thousands of files is several calls.
 */
const ARGV_BYTES = 256 * 1024;

interface Hit {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

/** What ripgrep said about one batch of paths. */
interface Searched {
  readonly hits: readonly Hit[];
  readonly errors: readonly string[];
}

/** The closure, in batches that fit on a command line. */
function batches(files: readonly string[]): readonly (readonly string[])[] {
  const out: string[][] = [];
  let bytes = ARGV_BYTES;
  for (const file of files) {
    if (bytes + file.length + 1 > ARGV_BYTES) {
      out.push([]);
      bytes = 0;
    }
    out[out.length - 1]!.push(file);
    bytes += file.length + 1;
  }
  return out;
}

/** One `rg --json` over one batch, read back as hits and complaints. */
function rg(root: string, pattern: string, files: readonly string[]): Searched {
  const ran = spawnSync('rg', ['--json', `--regexp=${pattern}`, '--', ...files], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (ran.error !== undefined) {
    const missing = (ran.error as NodeJS.ErrnoException).code === 'ENOENT';
    throw new Error(
      missing
        ? '`grep` runs ripgrep on the files, and `rg` is not on PATH. Install ripgrep and ask again.'
        : `ripgrep could not be run: ${ran.error.message}`,
    );
  }
  // 0 is a match, 1 is none, 2 is an error — which ripgrep also gives when it
  // matched in some files and could not read others, so 2 is not a refusal
  // unless nothing came back with it.
  const errors = ran.stderr.split('\n').filter((line) => line.trim() !== '');
  if (ran.status === 2 && ran.stdout === '') throw new Error(`ripgrep refused the pattern: ${errors.join(' ')}`);

  const hits: Hit[] = [];
  for (const line of ran.stdout.split('\n')) {
    if (line === '') continue;
    const message = JSON.parse(line) as {
      type: string;
      data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } };
    };
    if (message.type !== 'match') continue;
    const file = message.data?.path?.text;
    const at = message.data?.line_number;
    if (file === undefined || at === undefined) continue;
    const text = (message.data?.lines?.text ?? '(not UTF-8)').replace(/\r?\n$/, '');
    hits.push({ file, line: at, text: text.length > WIDEST ? `${text.slice(0, WIDEST)}…` : text });
  }
  return { hits, errors };
}

const byCodeUnit = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

function limitArg(input: Readonly<Record<string, unknown>>): number {
  const said = input['limit'];
  return typeof said === 'number' && Number.isInteger(said) && said > 0 ? said : SHOWN;
}

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

    const hits: Hit[] = [];
    const errors: string[] = [];
    for (const batch of batches(ordered)) {
      const searched = rg(root, query, batch);
      hits.push(...searched.hits);
      errors.push(...searched.errors);
    }
    hits.sort((left, right) => distanceOf(left.file) - distanceOf(right.file) || byCodeUnit(left.file, right.file) || left.line - right.line);

    const header = [areaLine(area)];
    const unread =
      errors.length === 0
        ? []
        : ['', `ripgrep reported ${errors.length} ${errors.length === 1 ? 'error' : 'errors'} reading them; the first: ${errors[0]}`];

    if (hits.length === 0) {
      return [...header, ...unread, '', `Nothing in those files matches \`${query}\`.`].join('\n');
    }

    const limit = limitArg(input);
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
    if (hits.length > limit) lines.push('', `${hits.length - limit} more not shown; a higher \`limit\` shows them.`);
    return lines.join('\n');
  },
};
