/**
 * `docs_orient` — what the code around some files is.
 *
 * It starts from files somebody already has: the ones a stack trace, a ticket
 * or an editor names, or the ones `docs_search`, `docs_symbol` and `docs_grep`
 * found. Finding them is those tools' job. The first two answer from the index
 * `variance index` publishes and the third runs ripgrep over what one file
 * reaches, so nothing here reads the text of a file. This answers the graph
 * questions each of those files raises: the package it belongs to, the names
 * that cross that package's edge in both directions, the recorded cases that
 * ran it, and the commands that ask about one of the names it printed.
 *
 * The package graph and the recorded cases are the addon's, through
 * `@variance-authority/sense`: they read what an earlier `variance index` and
 * an earlier recorded run published, and nothing here scans or runs anything.
 * A reading that was never published is said to be absent, with the command
 * that publishes it.
 */

// compass: variance-authority.report.agent-surface

import type { Tool } from '@variance-authority/mcp/tools';
import { packagesAround, recordedCases } from '@variance-authority/sense';
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
    'For files you already have — from a stack trace, a ticket, or docs_search, docs_symbol and docs_grep, ' +
    'which find them. Says which package each file is in, what that package imports from other packages and ' +
    'what other packages import from it, as each package\'s share of that side with the names it takes, ' +
    'each name weighed against all the outside use of the package that exports it, ' +
    'which recorded test cases ran each file or a test file declares, and the narrower questions to ask next. Reads the ' +
    'source index `variance index` publishes and the latest recorded run; reads no file\'s text and runs nothing itself.',
  inputSchema: {
    type: 'object',
    properties: {
      files: {
        type: 'array',
        items: { type: 'string' },
        description: 'Paths from the root, as git lists them. Every one is answered, in the order given.',
      },
    },
    required: ['files'],
    additionalProperties: false,
  },

  run: (_subject, input, invocation) => {
    const files = filesOf(input);
    if (files.length === 0) {
      throw new Error(
        '`orient` reads the graph around files you already have, and none was given. ' +
          '`search --query <name>` and `symbol --name <name>` name the file a name is declared in; ' +
          '`grep --query <pattern> --from <path>` names the files a pattern is in.',
      );
    }
    const root = invocation?.root;
    if (root === undefined) {
      throw new Error('`orient` reads what a checkout published, and this host named no checkout to read');
    }
    return formatOrientation({
      files,
      around: packagesAround(root, files, LIMITS),
      // TODO: a file that only ran while its module evaluated is counted with
      // no case, because the cases whose files import it are the file graph's
      // answer and this builds no graph; `variance covering --file` builds one
      // and names them, so the answer points there instead of counting them.
      recorded: recordedCases(root, files, TITLES),
    });
  },
};
