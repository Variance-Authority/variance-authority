import type { FileSet, Tool, ToolInvocation } from '@variance-authority/mcp/tools';
import { limitOf, spellingOf } from '@variance-authority/mcp/tools';
import type { Help } from '@variance-authority/package/help';
import { fileSetOf, foundAnswer, nativeAnswer } from './native-answer.js';

/**
 * `docs_uses` — how this repository actually writes a name.
 *
 * The second of the two questions somebody has about a symbol, and the one a
 * signature cannot answer. `docs_symbol` says what the thing is supposed to be;
 * this says where it is already being done, which is the answer that survives a
 * doc comment going stale, and the only one that carries the conventions nobody
 * wrote down.
 *
 * ## Nearest, by how much of the path is shared
 *
 * Sites come back ordered by how many leading path segments they share with
 * `from` — the file the asker is working in. Not import distance: this question
 * asks where a known name is imported, and its `from` only chooses which exact
 * sites to show first. The graph belongs to `docs_search`, where a start point
 * removes names outside a closure. Shared segments are readable off the two
 * strings. The claim here is the modest one it can support — *this import site
 * is written near the code you are in* — and a caller that passes no
 * `from` is told the sites in path order rather than a made-up ranking.
 *
 * ## A story is pointed at, not quoted
 *
 * A story or a test is a file written to show the thing being used, which is
 * what an example is, and both are named here with a line to open. What comes
 * back is the path, not the source. Serving the source would spend a context
 * window re-transmitting a file the caller can read in one cheap operation, and
 * it would answer with the file as it was when this reading was taken.
 *
 * ## A module held whole is named as such
 *
 * A name read off `import()` or off `import * as` is a site like any other, and
 * it is marked, because the line that reads the name is not the line that loads
 * it. An `import()` loads the module when that call runs, so whether the name
 * is there at all can depend on a path the program takes. A read off the
 * module's `default`, which holds the name only when the module is CommonJS,
 * and a module passed on whole, where this reading does not follow it, are each
 * listed as a site that may read the name and counted apart from the imports:
 * neither is a use of it.
 *
 * ## An import by path is a site
 *
 * A name no entry publishes is still used when another package imports the file
 * that exports it. That import is listed like any other, saying whether it is a
 * deep import — past the entry its package declares — or an import from a
 * package that declares none.
 *
 * ## An import within the package is a site
 *
 * The Help value records the imports that cross a package. The rest are read
 * off the source index: every import that resolved to the file declaring the
 * name, or to a file that passes it on with `export … from`, which is followed
 * under the name it exports and is not itself a use. An import of the name
 * under another name says which. A name a file exports and no entry publishes
 * is answered from there alone. Asked for one specifier of a package, an
 * import through another specifier of it is left to that one.
 *
 * An index that is missing or does not read leaves the imports by package path
 * standing, and the answer says the rest were not read and why.
 *
 * ## A use in the declaring file is a site
 *
 * The file that declares a name uses it by scope, and no import says so: a
 * call, a value, a type, a path `self::name`, a test module's `use super::*`.
 * The scan reads those lines with the file's parse, by the reader's scope
 * rules, so a parameter, a local or an inner item of the same name is another
 * name and its lines are not listed, and neither is the declaration. They are
 * listed after the imports, under the file, for an exported name and for one
 * the file keeps to itself. The TypeScript, JavaScript and Rust readers record
 * them.
 *
 * ## A member is declared, not imported
 *
 * A method or property of an interface, a type literal or a class is reached
 * through a value, so no import names it, and this question, which answers by
 * imports, lists its declarations as well, each on its container: after the
 * imports when an export has the name too, alone when none does. The scan
 * records every member declaration with the file's parse, so reading them is a
 * lookup in the source index.
 *
 * Each declaration on a named container is followed by its uses: the lines
 * that read, write or destructure the member through a value whose type the
 * line writes as that container — an annotation, an `as`, a `satisfies`. The
 * type's name is joined to its declaration the way an import is, so two
 * containers that share a member's name each get their own uses, and a value
 * typed as neither is a use of neither. What a type checker would infer is the
 * checker's of the declaration's language: the answer says so and names the
 * declaration to ask it about.
 */

/** Sites of one kind shown when `limit` is not said: how many are worth naming before the list stops being read. */
const SHOWN = 12;

export const uses: Tool<Help> = {
  name: 'docs_uses',
  description:
    'Every file:line in the workspace that imports one exported name, including reads through ' +
    '`import()` or `import * as`, marked with the line that loads the module, and imports that ' +
    'name the file by path, marked as such. Imports within the exporting package are read from the ' +
    'source index, through each `export … from` that passes the name on, so a ' +
    'name exported and not published is answered too. A site is marked `(as x)` where its import or a re-export ' +
    'renames the name, and with the lines its file uses what the import binds on. The imports inside the declaring package and the ones from ' +
    'other packages are counted and listed apart. The lines of the declaring file that use the name are listed after the imports. A member of an interface, a type literal or a class by that ' +
    'name is listed with its declarations, after the imports, each with the lines that read, write or destructure ' +
    'it through a value whose type is written as its container and the members of the classes that write `implements` of it, ' +
    "and the declaration to ask its language's find-references and go-to-implementation about for the uses and implementations no line types. A top-level " +
    'name a file declares and does not export is answered with its kind, where it is declared and who can reach it there, and ' +
    'one a file only binds to a value defined elsewhere as a binding, never as another declaration. Stories ' +
    'and tests are listed apart. `from`, the file you are in, sorts sites by shared path; `limit` says how many sites of ' +
    'each kind are shown. A name only passed on with `export … from` is followed to the declaration it reaches. ' +
    'A name an entry publishes only inside `export * as ns` is said to be published as `ns.name`, and a read ' +
    'through a namespace inside a namespace or one passed on as `default` is a site. ' +
    'Each file declaring the name declares another thing: the answer lists every one with its own imports, kept ' +
    'apart, and `file`, the file one is declared in or a file passing it on, answers for that declaration alone.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The exported name or member name, matched exactly; `Container.member` asks for that container\'s member.' },
      package: { type: 'string', description: 'Only answer from this package, by name or by specifier. Optional.' },
      from: {
        type: 'string',
        description:
          'The file you are working in, relative to the workspace root. Sites written near it ' +
          'are listed first. This orders the sites and never removes one — every site of the ' +
          'name still comes back. Unlike `from` on docs_search, it is not a start point and no ' +
          'import graph is walked: nearness here is how many leading path segments two files ' +
          'share. Optional.',
      },
      file: {
        type: 'string',
        description:
          'The file the name is declared in, or a file that passes it on with `export … from`, relative to the workspace root, ' +
          'to answer for that declaration alone among namesakes. Optional.',
      },
      limit: { type: 'integer', description: `Sites of each kind to show. ${SHOWN} when not said; the rest are counted.` },
    },
    required: ['name'],
    additionalProperties: false,
  },

  run(help, input, invocation) {
    return foundAnswer('uses', help, invocation, input, limitOf(input, SHOWN, spellingOf(invocation))).text;
  },

  files: usesFiles,
};

/**
 * Every file importing the name, at each line that does, or every file
 * declaring it as a member, read as `run` reads them; an index that did not
 * read leaves the imports within the package unread.
 */
function usesFiles(help: Help, input: Readonly<Record<string, unknown>>, invocation?: ToolInvocation<Help>): FileSet {
  return fileSetOf(foundAnswer('uses', help, invocation, input, SHOWN));
}

/**
 * The files a `uses` answer rests on: those that declare and publish the name,
 * and each it lists or counts, all rows and not only those shown. A name no file
 * here declares has only the files it lists; a new importer no listed file
 * reveals is the one thing a look at them cannot see.
 */
export function usesPrinted(help: Help, input: Readonly<Record<string, unknown>>, invocation?: ToolInvocation<Help>): Iterable<string> {
  return nativeAnswer('uses', help, invocation, input, SHOWN).restsOn ?? [];
}
