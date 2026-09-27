/**
 * `docs_orient` — where some words are, and what the code around them is.
 *
 * The first question somebody asks of a repository they do not know is not a
 * name, because they do not know the names yet. It is a few words from a
 * ticket. So this starts from the words and answers with the readings the
 * other questions would each need a name for: the files the words are in, the
 * packages those files belong to and the names that cross each package's edge
 * in both directions, the recorded cases that ran each file, and the commands
 * that ask about one of the names it printed.
 *
 * Text is git's. `git grep` over the tracked files answers where the words are,
 * with git's own view of what is tracked and what is binary, and the ranking on
 * top of it is deliberately crude — more of the words first, then more
 * matching lines — because it only has to choose which files the rest of the
 * answer reads about.
 *
 * The package graph and the recorded cases are the addon's, through
 * `@variance-authority/sense`: they read what an earlier `variance index` and
 * an earlier recorded run published, and nothing here scans or runs anything.
 * A reading that was never published is said to be absent, with the command
 * that publishes it.
 */

// compass: variance-authority.report.agent-surface

import { spawnSync } from 'node:child_process';
import type { Tool } from '@variance-authority/mcp/tools';
import { stringArg } from '@variance-authority/mcp/tools';
import { packagesAround, recordedCases } from '@variance-authority/sense';
import { formatOrientation, type Landing } from './orient-format.js';

/** Files shown when `limit` is not said. */
const SHOWN = 8;
/** Other packages shown per side, and names shown per package. */
const LIMITS = { rows: 5, names: 4 } as const;
/** Case titles shown per file. */
const TITLES = 3;

/** The words of a query, lower-cased once each, in the order written. */
export function wordsOf(query: string): readonly string[] {
  return [...new Set(query.toLowerCase().split(/\s+/u).filter((word) => word !== ''))];
}

/** Per tracked file, the lines containing `word`, ignoring case. */
function grepWord(root: string, word: string): ReadonlyMap<string, number> {
  const ran = spawnSync('git', ['grep', '--count', '-z', '-I', '--ignore-case', '--fixed-strings', '-e', word], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (ran.error !== undefined) throw new Error(`\`orient\` finds the words with \`git grep\`, which could not be run: ${ran.error.message}`);
  // 1 is no match; anything else but 0 is git refusing, and it says why.
  if (ran.status === 1) return new Map();
  if (ran.status !== 0) throw new Error(`\`git grep\` refused: ${ran.stderr.trim()}`);
  const counts = new Map<string, number>();
  for (const line of ran.stdout.split('\n')) {
    const at = line.indexOf('\0');
    if (at > 0) counts.set(line.slice(0, at), Number(line.slice(at + 1)));
  }
  return counts;
}

const byCodeUnit = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

/** Every file containing any of `words`, most words first, then most lines, then path. */
export function landings(root: string, words: readonly string[]): readonly Landing[] {
  const found = new Map<string, { words: number; lines: number }>();
  // TODO: the words are searched one after another, because a tool's `run` is
  // synchronous. On Kibana one word is about four seconds of reading files, and
  // two searched side by side took seven seconds rather than nine.
  for (const word of words) {
    for (const [file, lines] of grepWord(root, word)) {
      const seen = found.get(file) ?? { words: 0, lines: 0 };
      found.set(file, { words: seen.words + 1, lines: seen.lines + lines });
    }
  }
  return [...found]
    .map(([file, seen]) => ({ file, ...seen }))
    .sort((left, right) => right.words - left.words || right.lines - left.lines || byCodeUnit(left.file, right.file));
}

function limitArg(input: Readonly<Record<string, unknown>>): number {
  const said = input['limit'];
  return typeof said === 'number' && Number.isInteger(said) && said > 0 ? said : SHOWN;
}

/**
 * Typed over nothing, like `docs_grep`: it reads no workspace value. The
 * checkout is the working directory, or the root of a tree the host already
 * read.
 */
export const orient: Tool<unknown> = {
  name: 'docs_orient',
  description:
    'For words from a task when no name is known yet. Finds the tracked files that contain the words, ' +
    'then says which package each file is in, what that package imports from other packages and ' +
    'what other packages import from it, as each package\'s share of that side with the names it takes, ' +
    'each name weighed against all the outside use of the package that exports it, ' +
    'which recorded test cases ran each file or a test file declares, and the narrower questions to ask next. Reads the ' +
    'source index `variance index` publishes and the latest recorded run; runs nothing itself.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Words from the task, space-separated. Each is matched as plain text, ignoring case.',
      },
      limit: {
        type: 'integer',
        description: `Files to show. ${SHOWN} when not said; the rest are counted.`,
      },
    },
    required: ['query'],
    additionalProperties: false,
  },

  run: (_subject, input, invocation) => {
    const query = stringArg(input, 'query');
    // TODO: a call served by `variance-authority-help --root <dir>` reads the
    // working directory, not that root, unless the host read a tree; the
    // invocation has no field for the root on its own.
    const root = invocation?.tree?.root ?? process.cwd();
    const words = wordsOf(query);
    const found = landings(root, words);
    const shown = found.slice(0, limitArg(input));
    const files = shown.map((landing) => landing.file);
    const around = packagesAround(root, files, LIMITS);
    return formatOrientation({
      query,
      words,
      matched: found.length,
      shown,
      around,
      // TODO: a file that only ran while its module evaluated is counted with
      // no case, because the cases whose files import it are the file graph's
      // answer and this builds no graph; `variance covering --file` builds one
      // and names them, so the answer points there instead of counting them.
      ...(shown.length === 0 ? {} : { recorded: recordedCases(root, files, TITLES) }),
    });
  },
};
