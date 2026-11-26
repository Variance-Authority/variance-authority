import type { FileSet, Tool, ToolInvocation } from '@variance-authority/mcp/tools';
import { limitOf, START_POINT_SCHEMA, spellingOf } from '@variance-authority/mcp/tools';
import type { Help } from '@variance-authority/package/help';
import { DECLARED_CAP } from './declared.js';
import { FoundNothing } from './find.js';
import { foundAnswer } from './native-answer.js';
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
    'Everything known about each name asked, in the order asked: what it is, the import line that reaches it, the ' +
    'file and line that declares it, its full signature, its documentation — or, where nothing is ' +
    'written above it, the README passage that names it — which packages import it, where an import ' +
    'renames it, and the members an interface, a type alias or a class declares, one line each. An export ' +
    'that only passes the name on with `export … from` is followed to the declaration it reaches. Names are ' +
    'matched exactly, including a name exported and not published, answered with where it is declared, a ' +
    'name a file declares and does not export, at its top level or inside a function, answered with where it is written and, inside a function, the function that holds it, a ' +
    'name a file only binds to a value defined elsewhere, answered after the declarations as a binding, a ' +
    'name an import binds with `as`, answered with that import and the original it names, a ' +
    'member of an interface, a type literal or a class, answered with its container and where it is declared, and ' +
    'installed third-party declarations when the API catalogue is ' +
    'published, and, given `from`, as the workspace that owns that path resolves them; use docs_search ' +
    'when the exact name is not known, docs_uses for local import sites.',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: ['array', 'string'],
        items: { type: 'string' },
        description:
          'The names, each matched exactly; `Container.member` asks for that container\'s member. Each is answered as one is, in the ' +
          'order given, a blank line apart, and a name nothing declares is said in its place. One name may be given as a string.',
      },
      package: { type: 'string', description: 'Only answer from this package, by name or by specifier. Optional.' },
      from: {
        ...START_POINT_SCHEMA.from,
        description:
          'Optional. A path in the source tree. An installed third-party name is answered as the manifest that owns ' +
          'that path resolves it: its version and signature there, whether the code already imports it, and where ' +
          'else it is declared when it is not usable there.',
      },
      line: {
        type: 'string',
        description:
          'Optional. `<file>:<line>`, a line that uses the name: its declarations are ordered by how closely the tests ' +
          'that entered each match the recorded tests that ran the line. Overlap of tests, not proof of which one the line called.',
      },
      limit: {
        type: 'integer',
        description: `Rows to show in each list of the answer. ${DECLARED_CAP} declarations of each kind and ${INSTALLED_CAP} installed ones when not said; the rest are counted.`,
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
      const files = new Map(answer.files.map(({ file, lines }) => [file, [...lines]]));
      return { files, ...(answer.unread.length === 0 ? {} : { unread: [...answer.unread] }) };
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
