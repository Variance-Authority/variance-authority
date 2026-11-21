/**
 * `docs_orient` — what the code around some files is.
 *
 * It starts from files somebody already has: the ones a stack trace, a ticket
 * or an editor names, or the ones `docs_search`, `docs_symbol` and `docs_grep`
 * found. Finding them is those tools' job. The first two answer from the index
 * `variance index` publishes and the third runs ripgrep over what one file
 * reaches, so orientation does not scan source text. This answers the graph
 * questions each of those files raises: what it declares at its top level, the
 * package it belongs to, the names that cross that package's edge in both
 * directions, the recorded cases that ran it, the calls those cases took into
 * and out of it, and the commands that ask about one of the names it printed. A file asked as `path:line` narrows the
 * calls to the function holding that line.
 *
 * The package graph and the recorded cases are the addon's, through
 * `@variance-authority/sense`: they read what an earlier `variance index` and
 * an earlier recorded run published, and the calls are the journeys `variance
 * index` walked from that run; nothing here scans or runs anything.
 * A reading that was never published is said to be absent, with the command
 * that publishes it.
 *
 * Asked with no files, it prints the code map instead: the package graph folded
 * into nested areas, one page at a time, which `variance index` prepares beside
 * the source index. The top page is where a reader with nothing in hand starts,
 * and `area` opens one of the areas it lists.
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
    'With no files, prints the code map: the packages folded into a dozen or so areas per page, each with its size, ' +
    'its dependency layers, the packages most imports into it land on and the areas it imports from most; `area` ' +
    'opens one of those areas by its id. ' +
    'For files you already have — from a stack trace, a ticket, or docs_search, docs_symbol and docs_grep, ' +
    'which find them. Says which package each file is in, what each declares at its top level with its line and ' +
    'whether an export binds it, a class\'s or an interface\'s members under it, within a line budget that counts what it left out, ' +
    'what that package imports from other packages and ' +
    'what other packages import from it, as each package\'s share of that side with the names it takes, ' +
    'each name weighed against all the outside use of the package that exports it, ' +
    'which external packages the local imports from those files request, ' +
    'which recorded test cases ran each file or a test file declares, which functions in other files call into it and ' +
    'which it calls, as the recorded cases were walked over the static call graph, with how each call is known, the package ' +
    'flows those cases take through it, and the narrower questions to ask next. Reads the source index `variance index` ' +
    'publishes, the latest recorded run and the journeys `variance index` prepares from it; does not scan source text or ' +
    'run tests.',
  inputSchema: {
    type: 'object',
    properties: {
      files: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Paths from the root, as git lists them, each with an optional `:<line>`. Every one is answered, in the order given; ' +
          'a line narrows the journeys to the function holding it.',
      },
      area: {
        type: 'string',
        description: 'The id of an area on the code map, as a page lists it (`4.1`). Without files or area, the top page.',
      },
      declarations: {
        type: 'boolean',
        description:
          'With files, print every manifest declaration entry for each listed external dependency; otherwise the first three and a remaining count.',
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
    const { packages: around, external, declarations: declared } = orientAround(root, files, LIMITS, { rows: 8, names: 3 }, DECLARED_LINES);
    return formatOrientation({
      files,
      declarations,
      around,
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
