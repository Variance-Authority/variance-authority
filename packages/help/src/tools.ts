import type { Served, Tool } from '@variance-authority/mcp/tools';
import type { Help } from '@variance-authority/package/help';
import { snapshotLine } from './caught-up.js';
import { operatorError } from './operator.js';
import { workspaceGeneration } from './read.js';
import { discover } from './tools/discover.js';
import { entrypoint } from './tools/entrypoint.js';
import { FoundNothing } from './tools/find.js';
import { gaps } from './tools/gaps.js';
import { grep } from './tools/grep.js';
import { intersectionOf } from './tools/intersection.js';
import { journeyMapTool } from './tools/journey-map.js';
import { testCompositionTool } from './tools/test-composition.js';
import { orient } from './tools/orient.js';
import { packages } from './tools/packages.js';
import { search } from './tools/search.js';
import { stack } from './tools/stack.js';
import { slowestTests } from './tools/slowest-tests.js';
import { symbol } from './tools/symbol.js';
import { uses } from './tools/uses.js';

/**
 * `tool`, its answer dated by the workspace generation it was read from. With
 * `unseen`, that generation was never compared with the checkout: the date says
 * so, and a refusal adds that the name may only be newer than it.
 */
function dated(tool: Tool<Help>, unseen: boolean): Tool<Help> {
  return {
    ...tool,
    run(subject, input, invocation) {
      const at = workspaceGeneration(subject);
      let answer: string;
      try {
        answer = tool.run(subject, input, invocation);
      } catch (refusal) {
        // A name refused by a generation nothing compared with the checkout
        // may only be newer than it, and the refusal says so. A name found
        // nothing for is an answer, which its surface dates as it gives it.
        if (!unseen || at === undefined || refusal instanceof FoundNothing) throw refusal;
        const said = `${refusal instanceof Error ? refusal.message : String(refusal)}\n\n${snapshotLine(at, true)}`;
        const operator = (refusal as { readonly varianceOperatorError?: unknown } | undefined)?.varianceOperatorError === true;
        throw operator ? operatorError(said, { cause: refusal }) : new Error(said, { cause: refusal });
      }
      return at === undefined ? answer : `${answer}\n${snapshotLine(at, unseen)}`;
    },
  };
}

/**
 * The questions that are asked alone, in the order they are meant to be asked in.
 * `HELP_TOOLS` is this order with `docs_intersection`, which crosses them.
 */
const ALONE: readonly Tool<Help>[] =
  [packages, entrypoint, symbol, uses, search, grep, discover, orient, slowestTests, journeyMapTool, testCompositionTool, stack, gaps];

/** Every question above, crossed; built over the list so a question that joins it can be an operand. */
const intersection = intersectionOf<Help>(ALONE);

/**
 * The questions shell dispatch and the server share, in the order they are meant to be asked in.
 *
 * `docs_packages` needs nothing and counts, one row per package or specifier,
 * each row the argument `docs_entrypoint` takes; `docs_entrypoint` and
 * `docs_search` narrow to a name; `docs_symbol` spends the length. That shape is
 * the whole design: a model that has to guess a package name to ask its first
 * question will guess, and a wrong guess costs a turn and reads exactly like a
 * workspace that does not publish the thing.
 *
 * `docs_uses` follows `docs_symbol` because it is the other half of one
 * question. A signature says what a name is *supposed* to be; where the
 * repository already writes it says what using it actually looks like here, and
 * the two are separate tools rather than one long answer because a reader who
 * knows the API and wants the local convention should not have to buy the
 * signature again to get it.
 *
 * `docs_grep` is the one that is not about names. Text belongs to ripgrep, and
 * the only thing added is the fact ripgrep cannot hold: which files a start
 * point reaches. It comes after `docs_search` because a name is the cheaper
 * answer, and a pattern is what is left when nothing is named.
 *
 * `docs_discover` crosses what the questions above answer one at a time:
 * the files a path reaches, that import a name, that declare one, whose path
 * or text matches — each read whole, and only the files in every one of them
 * answered. It comes after `docs_grep` because each of its sets is a question
 * that could be asked alone, and is worth asking alone first.
 *
 * `docs_intersection` crosses whole questions rather than the sets one question
 * names: each operand is any question above whose answer is a set of files,
 * asked with its own input and read uncapped, and the answer is the files all
 * of them answer. It follows `docs_discover` because a crossing `discover` can
 * name in one call is cheaper asked there.
 *
 * `docs_orient` is the widest, and comes after both for the same reason: it
 * starts from files the tools above found and answers with everything around
 * them — packages, the names crossing their edges, the recorded cases that ran
 * them — which is the most to read when a name would have done. It finds
 * nothing itself. Its answer ends in the narrower questions above, spelled with
 * the names it printed.
 *
 * `docs_slowest_tests` is about the suite rather than the source: which test
 * files the latest recorded run says took longest, as the runner timed them.
 * It sits here because it reads the same recording `docs_orient` reads.
 * `docs_journey_map` reads it too, around one file: the code the tests that
 * entered that file went on to enter, nearest first. `docs_test_composition`
 * reads it around one test: the smaller tests inside it, the larger ones
 * holding it, and what none of its pieces entered.
 *
 * `docs_stack` answers what a location may import that nobody wrote: the
 * third-party packages its owning manifest declares, read from the published
 * dependency lexicon rather than from the source.
 *
 * `docs_gaps` is the one that is not for using the library. It is for the person
 * maintaining it, and it lives here rather than in a lint rule because the
 * reading that ranks it is the same reading, and an agent that has just been
 * told a name is undocumented is the agent best placed to write the paragraph.
 */
export const HELP_TOOLS: readonly Tool<Help>[] =
  [packages, entrypoint, symbol, uses, search, grep, discover, intersection, orient, slowestTests, journeyMapTool, testCompositionTool, stack, gaps];


export const SERVER_NAME = 'variance-authority-help';
export const SERVER_VERSION = '0.0.0';

/** What a server answers with: every tool above, over one workspace's reading. */
export const HELP: Served<Help> = {
  name: SERVER_NAME,
  version: SERVER_VERSION,
  tools: HELP_TOOLS.map((tool) => dated(tool, false)),
};

/**
 * The same, for a server that answers from the published generation without
 * comparing it with the checkout: every answer's date says so.
 */
export const UNCOMPARED_HELP: Served<Help> = { ...HELP, tools: HELP_TOOLS.map((tool) => dated(tool, true)) };

export { discover, entrypoint, gaps, grep, intersection, journeyMapTool, orient, packages, search, slowestTests, stack, symbol, testCompositionTool, uses };
export { namesWanted } from './tools/intersection.js';
export { formatOrientation, type OrientReading } from './tools/orient-format.js';
export { answerSearch, searchIndexOf } from './tools/search.js';
export type {
  ExportedMatch,
  InArea,
  Matches,
  PublishedMatch,
  SearchAnswer,
  SearchArea,
  SearchQuestion,
} from './tools/search-answer.js';
export { searchNames } from './tools/search-answer.js';
export { importingOf, type ImportingOf, type ImportingOne } from './tools/published-match.js';
export type { ImportedIn } from './tools/uses-count.js';
export type { Help };
export { audience, block, importing, line, reach, said } from './tools/format.js';
export { sharedSegments } from './tools/shared-segments.js';
export { doorOf, entriesNamed, isPackage, openingOf, packageOf, specifierOf, unfound } from './tools/find.js';
