/**
 * `docs_orient` — what the code around some files is.
 *
 * It starts from files somebody already has: the ones a stack trace, a ticket
 * or an editor names, or the ones `docs_search`, `docs_symbol` and `docs_grep`
 * found. Finding them is those tools' job. The first two answer from the index
 * `variance index` publishes and the third runs ripgrep over what one file
 * reaches, so orientation does not scan source text. This answers the graph
 * questions each of those files raises: the package it belongs to, the names
 * that cross that package's edge in both directions, the recorded cases that
 * ran it, and the commands that ask about one of the names it printed.
 *
 * The package graph and the recorded cases are the addon's, through
 * `@variance-authority/sense`: they read what an earlier `variance index` and
 * an earlier recorded run published, and nothing here scans or runs anything.
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
import { basename } from 'node:path';
import { codeMapPage, dependenciesAround, packagesAround, recordedCases } from '@variance-authority/sense';
import { formatCodeMapPage } from './code-map-format.js';
import { formatOrientation } from './orient-format.js';

/** Other packages shown per side, and names shown per package. */
const LIMITS = { rows: 5, names: 4 } as const;
/** Case titles shown per file. */
const TITLES = 3;

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
    'which find them. Says which package each file is in, what that package imports from other packages and ' +
    'what other packages import from it, as each package\'s share of that side with the names it takes, ' +
    'each name weighed against all the outside use of the package that exports it, ' +
    'which external packages the local imports from those files request, ' +
    'which recorded test cases ran each file or a test file declares, ' +
    'and the narrower questions to ask next. Reads the ' +
    'source index `variance index` publishes and the latest recorded run; does not scan source text or run tests.',
  inputSchema: {
    type: 'object',
    properties: {
      files: {
        type: 'array',
        items: { type: 'string' },
        description: 'Paths from the root, as git lists them. Every one is answered, in the order given.',
      },
      area: {
        type: 'string',
        description: 'The id of an area on the code map, as a page lists it (`4.1`). Without files or area, the top page.',
      },
    },
    additionalProperties: false,
  },

  run: (_subject, input, invocation) => {
    const files = filesOf(input);
    const area = typeof input['area'] === 'string' ? input['area'].trim() : undefined;
    const root = invocation?.root;
    if (root === undefined) {
      throw new Error('`orient` reads what a checkout published, and this host named no checkout to read');
    }
    if (files.length === 0) return mapPage(root, area === '' ? undefined : area);
    if (area !== undefined) {
      throw new Error(
        '`orient` reads either the graph around some files or one page of the code map, and was given both; ' +
          'ask with `files` alone, or with `area` alone.',
      );
    }
    const external = dependenciesAround(root, files, { rows: 8, names: 3 });
    return formatOrientation({
      files,
      around: packagesAround(root, files, LIMITS),
      external,
      // TODO: a file that only ran while its module evaluated is counted with
      // no case, because the cases whose files import it are the file graph's
      // answer and this builds no graph; `variance covering --file` builds one
      // and names them, so the answer points there instead of counting them.
      recorded: recordedCases(root, files, TITLES),
    });
  },
};

/** One page of the code map, or why there is none to print. */
function mapPage(root: string, area: string | undefined): string {
  const { index, answer } = codeMapPage(root, area);
  const files = 'With files in hand, `files` reads the graph around them.';
  if (answer === undefined) {
    return `No code map is kept beside the source index at ${index}; \`variance index\` folds one. ${files}`;
  }
  const { layers, page } = answer;
  if (layers === undefined || layers === null) {
    return `The source index at ${index} was folded into no code map, because ${answer.unmade ?? 'there is no package to fold'}. ${files}`;
  }
  if (page === undefined || page === null) {
    throw new Error(`the code map has no area \`${area ?? ''}\`; the top page, asked with no \`area\`, lists the areas`);
  }
  return formatCodeMapPage({ current: answer.current, layers, page }, basename(root));
}
