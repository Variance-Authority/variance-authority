import type { FileSet, Tool, ToolInvocation } from '@variance-authority/mcp/tools';
import { limitOf, START_POINT_SCHEMA, spellingOf } from '@variance-authority/mcp/tools';
import type { Help } from '@variance-authority/package/help';
import { DECLARED_CAP } from './declared.js';
import { FoundNothing } from './find.js';
import { fileSetOf, foundAnswer } from './native-answer.js';
import { eachAnswer, eachDeclared, joinedFiles } from './symbol-names.js';

/** Installed declarations shown when the question says no `limit`. */
const INSTALLED_CAP = 100;

/**
 * `docs_symbol` — what a name is and where it is declared, in full.
 *
 * Answered for every declaration of the name, each by its file and line, and
 * each for every specifier that publishes it rather than for the first: a
 * declaration reachable from a barrel and from a subpath is one thing with two
 * import lines, and picking one of them for the caller would make the line they
 * write depend on which door this reading walked through first. Two files that
 * declare the name are two things, each answered with its own doors and imports.
 */
export const symbol: Tool<Help> = {
  name: 'docs_symbol',
  description:
    'Everything known about each name asked, matched exactly: what it is, the import line that ' +
    'reaches it, where it is declared, its signature and documentation, which packages import it, where an import renames it, and the members an interface, ' +
    'type or class declares. It answers exported, unpublished and file-local names, `as` bindings, ' +
    'members as `Container.member`, and installed third-party declarations when the API catalogue is ' +
    'published. Use docs_search when you do not know the exact name, docs_uses for where it is ' +
    'imported.',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: ['array', 'string'],
        items: { type: 'string' },
        description: 'A name or an array of them, each matched exactly; `Container.member` for a member. Answered in the order given.',
      },
      package: { type: 'string', description: 'Optional. Answer only from this package, by name or specifier.' },
      from: {
        ...START_POINT_SCHEMA.from,
        description:
          'Optional. A source path: an installed third-party name is answered as the manifest owning it ' +
          'resolves it, with its version and whether the code already imports it.',
      },
      line: {
        type: 'string',
        description:
          'Optional. `<file>:<line>` of a line using the name: declarations are ordered by how closely the tests ' +
          'that ran each match the tests that ran the line.',
      },
      limit: {
        type: 'integer',
        description: `Optional. Rows per list, the rest counted; ${DECLARED_CAP} declarations of each kind and ${INSTALLED_CAP} installed when not said.`,
      },
    },
    required: ['name'],
    additionalProperties: false,
  },

  // Several names are each answered as one is, in the order asked.
  run(help, input, invocation) {
    // Refused before any name is read, so a bad `limit` is said once.
    const limit = limitOf(input, DECLARED_CAP, spellingOf(invocation));
    return eachAnswer(input, (one) => answered(help, one, invocation, input['limit'] === undefined ? undefined : limit).text);
  },

  // The files of this checkout that declare the names, each at its line, by the
  // same reading `run` answers from; an installed declaration is
  // not a file of the checkout, so a name only a dependency declares is unfound.
  files(help, input, invocation): FileSet {
    return joinedFiles(eachDeclared(input, (one) => {
      const answer = answered(help, one, invocation, undefined);
      if (answer.files == null) throw new FoundNothing(answer.absent ?? answer.text);
      return fileSetOf(answer);
    }));
  },
};

/** {@link symbol}'s answer about one name, thrown as {@link FoundNothing} when nothing declares it. */
function answered(help: Help, input: Readonly<Record<string, unknown>>, invocation: ToolInvocation<Help> | undefined, limit: number | undefined) {
  return foundAnswer('symbol', help, invocation, input, limit);
}

/**
 * The files an answer about a name rests on, to be compared with the checkout:
 * those {@link symbol}'s `files` gives, every export of the name, whose imports
 * the answer counts, and for a published declaration each entry and each barrel
 * between that entry and its file, through which the answer teaches its import.
 */
export function restsOn(help: Help, input: Readonly<Record<string, unknown>>, invocation?: ToolInvocation<Help>): Iterable<string> {
  return eachDeclared(input, (one) => {
    const answer = answered(help, one, invocation, undefined);
    if (answer.restsOn == null) throw new FoundNothing(answer.absent ?? answer.text);
    return answer.restsOn;
  }).flat();
}
