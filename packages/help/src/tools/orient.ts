/**
 * `docs_orient` — what the code around some files is. It starts from files
 * somebody already has, from a stack trace, a ticket, an editor or
 * `docs_search`, `docs_symbol` and `docs_grep`, and finds none itself; with no
 * files it prints the code map `variance index` prepares. Every reading is the
 * addon's, through `@variance-authority/sense`, from what an earlier `variance
 * index` and recorded run published; nothing here scans or runs anything.
 */

// compass: variance-authority.report.agent-surface

import type { Tool } from '@variance-authority/mcp/tools';
import { spellingOf } from '@variance-authority/mcp/tools';
import { basename } from 'node:path';
import { codeMapPage, journeysAround, orientAround, recordedCases, type JourneysAsk } from '@variance-authority/sense';
import { formatCodeMapPage, noCodeMap, unfoldedCodeMap } from './code-map-format.js';
import { formatOrientation, type OrientReading } from './orient-format.js';

/** Other packages shown per side, and names shown per package. */
const LIMITS = { rows: 5, names: 4 } as const;
/** Case titles shown per file. */
const TITLES = 3;
/** Lines of top-level declarations and their members shown per file; the rest are counted. */
const DECLARED_LINES = 40;

/** The files as they were said, each once, in the order said. */
export function filesOf(input: Readonly<Record<string, unknown>>): readonly string[] {
  const said = input['files'];
  const listed = typeof said === 'string' ? [said] : Array.isArray(said) ? said : [];
  const files = listed
    .filter((file): file is string => typeof file === 'string')
    .map((file) => file.trim().replace(/^\.\//u, ''))
    .filter((file) => file !== '');
  return [...new Set(files)];
}

/** Each file as said, split at a trailing `:<line>` into the path and the line asked about. */
export function asksOf(files: readonly string[]): readonly JourneysAsk[] {
  return files.map((said) => {
    const at = /^(.+):(\d+)$/u.exec(said);
    return at === null ? { file: said } : { file: at[1]!, line: Number(at[2]) };
  });
}

/**
 * Typed over nothing, like `docs_grep`: it reads no workspace value. The
 * checkout is the one the host names on the call, as `invocation.root`; with
 * none named it refuses, because the process's working directory is where the
 * host was launched and not necessarily the checkout it serves.
 */
export const orient: Tool<unknown> = {
  name: 'docs_orient',
  description:
    'With no files, the code map: packages grouped into areas and dependency layers; `area` opens one. With files you already hold, for each: its package, its top-level ' +
    'declarations and members, what crosses its package\'s edges, the external packages it requests, ' +
    'the recorded tests that ran it, its callers and callees as those tests walked them, and the ' +
    'narrower questions to ask next. It finds nothing itself and is the widest answer here. Reads ' +
    'what `variance index` and the latest recorded run published.',
  inputSchema: {
    type: 'object',
    properties: {
      files: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Paths from the root, as git lists them, each with an optional `:<line>`: the declarations it is in, and the calls of the function it is in.',
      },
      area: {
        type: 'string',
        description: 'An area id, as the code map lists it (`4.1`).',
      },
      declarations: {
        type: 'boolean',
        description: 'With files: every declaration entry of each external dependency, not the first three.',
      },
    },
    additionalProperties: false,
  },

  run: (_subject, input, invocation) => {
    const said = filesOf(input);
    const asks = asksOf(said);
    const files = [...new Set(asks.map((ask) => ask.file))];
    const area = typeof input['area'] === 'string' ? input['area'].trim() : undefined;
    const root = invocation?.root;
    if (root === undefined) {
      throw new Error('`orient` reads what a checkout published, and this host named no checkout to read');
    }
    const declarations = input['declarations'] === true;
    if (said.length === 0) {
      if (declarations) throw new Error('`--declarations` needs `--files`; a code-map page has no external dependency declarations.');
      return mapPage(root, area === '' ? undefined : area);
    }
    if (area !== undefined) {
      throw new Error(
        '`orient` reads either the graph around some files or one page of the code map, and was given both; ' +
          'ask with `files` alone, or with `area` alone.',
      );
    }
    const lines = asks.flatMap((ask) => (ask.line == null ? [] : [{ file: ask.file, line: ask.line }]));
    const { packages: around, external, declarations: declared, lines: held } = orientAround(root, files, LIMITS, { rows: 8, names: 3 }, DECLARED_LINES, lines);
    return formatOrientation({
      asks,
      declarations,
      around,
      ...(held === undefined ? {} : { lines: held }),
      ...(declared === undefined ? {} : { declared }),
      external: { ...external, declarationsQuestion: spellingOf(invocation).question(orient, { files: said, declarations: true }) },
      recorded: recordedCases(root, files, TITLES),
      ...journeysOf(root, asks),
    });
  },
};

/** The journeys part, or why it could not be read; the rest of the answer stands either way. */
function journeysOf(root: string, asks: readonly JourneysAsk[]): Pick<OrientReading, 'journeys' | 'journeysUnread'> {
  try {
    return { journeys: journeysAround(root, asks) };
  } catch (error) {
    return { journeysUnread: error instanceof Error ? error.message : String(error) };
  }
}

/** One page of the code map, or why there is none to print. */
function mapPage(root: string, area: string | undefined): string {
  const { index, answer } = codeMapPage(root, area);
  const files = 'With files in hand, `files` reads the graph around them.';
  if (answer === undefined) {
    return `${noCodeMap(index)} ${files}`;
  }
  const { layers, page } = answer;
  if (layers === undefined || layers === null) {
    return `${unfoldedCodeMap(index, answer.unmade ?? undefined)} ${files}`;
  }
  if (page === undefined || page === null) {
    throw new Error(`the code map has no area \`${area ?? ''}\`; the top page, asked with no \`area\`, lists the areas`);
  }
  return formatCodeMapPage({ current: answer.current, layers, page }, basename(root));
}
