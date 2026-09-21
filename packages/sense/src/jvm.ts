/**
 * What a Java or Kotlin file asks for and what it publishes.
 *
 * One module for two languages because they are two syntaxes over one
 * resolution algorithm, and the algorithm is the part that is hard. A JVM import
 * names a *package* and a thing in it, the package is a directory under a source
 * root, and a file's own package declaration is what says where the source root
 * is. Java and Kotlin differ in how the statement is written and in one rule
 * about filenames; nothing else about finding the file differs at all.
 *
 * ## Every import is a guess
 *
 * `import java.util.List` and `import com.ours.List` are the same statement. The
 * syntax carries nothing that says whether a package is this repository's or the
 * platform's, and the overwhelming majority of imports in a real JVM file are
 * neither — they are the standard library and the dependency graph. So every
 * request here is {@link Request.guessed}: one that resolves is an edge, and one
 * that does not is silence rather than a hole. A JVM file therefore never
 * reports an unresolved specifier, which is not a weakness of the reader but the
 * only honest reading of the language.
 *
 * ## The source root is derived, not configured
 *
 * `src/main/java` and `src/main/kotlin` are Maven and Gradle conventions, and a
 * convention list would be wrong for every project that does not hold to them.
 * The file says it instead: a file at `a/b/c/Thing.java` declaring
 * `package b.c` sits under the root `a`. One file per directory is read to
 * learn this, once per scan, and the answer is exact wherever the compiler's is.
 *
 * ## A package is implicit
 *
 * Types in the same package are visible with no import at all, so every file
 * asks for its own package as well as for what it wrote. Over a JVM codebase
 * this is the majority of the real edges, and leaving it out would report a
 * class and the class beside it as unrelated.
 *
 * ## The one difference: a Kotlin file need not be named after its class
 *
 * `import a.b.parse` may be a top-level function declared in any file of `a/b/`,
 * because Kotlin has top-level declarations and no filename rule. So when the
 * named file is not there, every Kotlin file in that package is the answer. Java
 * has the rule, so Java stops at the file.
 *
 * ## What is unknown
 *
 * A parse error **where an import could have been**, and a missing grammar. A
 * grammar recovers from syntax it cannot read by wrapping it in an `ERROR` node
 * and carrying on, so one unreadable expression inside one function body costs
 * nothing: every import in the file is still there to be read. Widening on that
 * would let a single unsupported form — one the grammar is simply a version
 * behind on — pull the whole repository into reach. An error hides an import
 * only when it sits where this reader looks — the top level, and inside the
 * `import_list` Kotlin wraps its imports in.
 *
 * Reflection is invisible, as it is to the compiler.
 */

import { missingGrammar, parserFor, type GrammarNode } from './grammar.js';
import type { Export, Read, Request } from './read.js';
import type { TreeWorld } from './world.js';

/** Extensions a JVM import can land on. A Kotlin file may import a Java class and back. */
const JVM_FILES = ['.java', '.kt'];

/** The suffix that makes a request name a package directory rather than a file. */
const WHOLE_PACKAGE = '.*';

export function readJava(file: string, source: string): Read {
  return readJvm(file, source, 'java');
}

export function readKotlin(file: string, source: string): Read {
  return readJvm(file, source, 'kotlin');
}

function readJvm(file: string, source: string, id: 'java' | 'kotlin'): Read {
  const parser = parserFor(id);
  if (parser === undefined) {
    return { requests: [], unknown: missingGrammar(file, id) };
  }

  const tree = parser.parse(source);
  if (tree === null) {
    return { requests: [], unknown: `${file} could not be parsed as ${id}.` };
  }

  const requests: Request[] = [];
  const exports: Export[] = [];
  const seen = new Set<string>();
  let broken = false;

  const want = (value: string, local: string, line: number): void => {
    if (value === '' || seen.has(value)) return;
    seen.add(value);
    requests.push({
      value,
      kind: 'imports',
      bindings: [{ imported: local, local, type: false, line }],
      line,
      // Always. See the module doc: nothing in the statement separates this
      // repository's packages from the platform's.
      guessed: true,
    });
  };

  const walk = (node: GrammarNode, top: boolean): void => {
    for (const child of node.namedChildren) {
      const line = child.startPosition.row + 1;
      // This walk descends only into `import_list`, so the levels it steps over
      // are exactly the ones an import could have been lost from.
      if (child.type === 'ERROR' || child.isMissing) broken = true;
      switch (child.type) {
        case 'package_declaration':
        case 'package_header': {
          const name = dotted(child);
          // The file's own package. Visible without an import, and the edge
          // nothing else in the file would ever produce.
          if (name !== undefined) want(`${name}${WHOLE_PACKAGE}`, '*', line);
          break;
        }

        case 'import_list': {
          walk(child, false);
          break;
        }

        case 'import_declaration':
        case 'import_header': {
          const name = dotted(child);
          if (name === undefined) break;
          // Kotlin gives the `*` a node; Java leaves it anonymous and ends the
          // statement with a semicolon, so the text is what has to be read.
          const wide = child.namedChildren.some((part) => part.type === 'wildcard_import')
            || /\*\s*;?\s*$/.test(child.text);
          const alias = child.namedChildren
            .find((part) => part.type === 'import_alias')?.namedChildren[0]?.text;
          const last = name.slice(name.lastIndexOf('.') + 1);
          want(wide ? `${name}${WHOLE_PACKAGE}` : name, alias ?? last, line);
          break;
        }

        default: {
          if (!top) break;
          const name = declared(child);
          if (name !== undefined) exports.push({ exported: name, local: name, type: false, line });
        }
      }
    }
  };

  // Kotlin wraps its imports in an `import_list`; Java lists them at the top.
  walk(tree.rootNode, true);

  return {
    requests,
    ...(exports.length === 0 ? {} : { exports }),
    ...(broken
      ? { unknown: `${file} did not parse cleanly as ${id}, so what it imports may be incomplete.` }
      : {}),
  };
}

/** Declarations a file publishes to its package and to anything importing it. */
const DECLARATIONS = new Set([
  'class_declaration',
  'interface_declaration',
  'enum_declaration',
  'record_declaration',
  'annotation_type_declaration',
  'object_declaration',
  'function_declaration',
  'property_declaration',
  'type_alias',
]);

function declared(node: GrammarNode): string | undefined {
  if (!DECLARATIONS.has(node.type)) return undefined;
  // Java names the field; Kotlin does not, so the first identifier-shaped child
  // is the name. Both are the node's own name and never a nested one.
  const field = node.childForFieldName('name');
  if (field !== null) return field.text;
  return node.namedChildren
    .find((child) => child.type === 'type_identifier' || child.type === 'simple_identifier')?.text;
}

/** The dotted name inside a package or import statement, however it is spelled. */
function dotted(node: GrammarNode): string | undefined {
  const name = node.namedChildren.find(
    (child) => child.type === 'scoped_identifier' || child.type === 'identifier',
  );
  if (name === undefined) return undefined;
  // Kotlin's `identifier` holds `simple_identifier` children with the dots
  // between them as anonymous nodes, so its own text is already the dotted name.
  // Java's `scoped_identifier` is the same shape. Whitespace is possible in
  // neither, but a line break inside one would be, so it is taken out.
  const text = name.text.replace(/\s+/g, '');
  return text === '' ? undefined : text;
}

/**
 * Every file a JVM import could mean. Empty for anything outside this repository.
 *
 * Many, not one: `import a.b.*` is a whole package, a file's own package is a
 * whole package, and a Kotlin name that is not a filename is every file in one.
 */
export function resolveJvm(input: {
  readonly from: string;
  readonly request: string;
  readonly world: TreeWorld;
}): readonly string[] {
  const { from, request, world } = input;
  const roots = rootIndex(world);

  if (request.endsWith(WHOLE_PACKAGE)) {
    const directory = request.slice(0, -WHOLE_PACKAGE.length).replace(/\./g, '/');
    return sourcesIn(world, roots, directory).filter((path) => path !== from);
  }

  const segments = request.split('.');
  // The longest prefix that is a file. `a.b.C` is `a/b/C`, and `a.b.C.Inner` or
  // a static `a.b.C.method` is the same file with a segment left over.
  for (let depth = segments.length; depth > 0; depth -= 1) {
    const relative = segments.slice(0, depth).join('/');
    for (const root of roots) {
      for (const extension of JVM_FILES) {
        const path = at(root, `${relative}${extension}`);
        if (world.has(path) && path !== from) return [path];
      }
    }
  }

  // Kotlin's exception: the name was never a filename. Its package is.
  if (segments.length > 1) {
    const directory = segments.slice(0, -1).join('/');
    const kotlin = sourcesIn(world, roots, directory).filter((path) => path.endsWith('.kt'));
    if (kotlin.length > 0) return kotlin.filter((path) => path !== from);
  }

  return [];
}

function sourcesIn(
  world: TreeWorld,
  roots: readonly string[],
  directory: string,
): readonly string[] {
  return roots.flatMap((root) =>
    world.under(at(root, directory)).filter((path) => JVM_FILES.some((end) => path.endsWith(end))));
}

function at(root: string, rest: string): string {
  return root === '' ? rest : `${root}/${rest}`;
}

/**
 * Every source root in the tree, worked out from what the files say they are.
 *
 * One file is read per directory that holds JVM sources — the package
 * declaration is in the first few lines and the rest of the file is not looked
 * at — and the root is that directory with the package's own path taken off the
 * end. A directory whose files declare no package, or declare one the path does
 * not end with, is its own root, which is what a flat layout and a default
 * package both are.
 */
function rootIndex(world: TreeWorld): readonly string[] {
  return world.index('jvm:roots', (tree) => {
    const directories = new Set<string>();
    for (const path of tree.below('')) {
      if (!JVM_FILES.some((end) => path.endsWith(end))) continue;
      const cut = path.lastIndexOf('/');
      directories.add(cut === -1 ? '' : path.slice(0, cut));
    }

    const roots = new Set<string>();
    for (const directory of directories) {
      const sample = tree.under(directory).find((path) =>
        JVM_FILES.some((end) => path.endsWith(end)));
      const declared = sample === undefined ? undefined : packageOf(tree.text(sample));
      const suffix = declared === undefined ? undefined : declared.replace(/\./g, '/');

      if (suffix === undefined) {
        roots.add(directory);
      } else if (directory === suffix) {
        roots.add('');
      } else if (directory.endsWith(`/${suffix}`)) {
        roots.add(directory.slice(0, -suffix.length - 1));
      } else {
        roots.add(directory);
      }
    }

    // Shortest first, so the outermost root is tried before a directory that is
    // only a root because nothing in it said otherwise.
    return [...roots].sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
  });
}

function packageOf(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  return /^[^\S\n]*package[^\S\n]+([\w.]+)/m.exec(text)?.[1];
}
