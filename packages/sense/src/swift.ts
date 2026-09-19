/**
 * What a Swift file asks for and what it publishes.
 *
 * Swift is the language that does not have the edge this package is built on.
 * `import Core` names a **module**, and a module is a whole target — tens or
 * hundreds of files compiled together. Nothing in the statement, and nothing
 * anywhere in the file, says which of those files the symbol came from. Within a
 * target it is worse: files see each other with no import at all, so a Swift file
 * names none of the files it depends on and cannot be made to
 * ([ADR-0066](../../../docs/context/adr/0066-a-language-is-a-reader-not-a-sense.md)).
 *
 * ## So the target is the answer, projected onto files
 *
 * An `import` becomes an edge to **every file in that target**, and a file's own
 * target becomes edges to every file beside it. Both are true statements at the
 * grain the language actually has: a change to any file in `Core` can change
 * what `Core` publishes, so anything that imported `Core` may be affected by it.
 * The projection over-reaches in the way selection is allowed to over-reach —
 * a test that did not need running is cost, and a test that needed running and
 * was not run is the failure this package exists to refuse.
 *
 * Measured on a 708-file, 51-target SwiftPM package: the largest target is 78
 * files, and same-target visibility is 20,756 edges — about twenty-nine per
 * file. The shape is affordable because targets are small on purpose; a
 * repository that put everything in one target would pay for it, and so would
 * its compiler.
 *
 * ## `Package.swift` is a program, and is read as one
 *
 * There is no manifest format to parse. Targets are declared by calling
 * `.target(name:path:)` inside Swift source, the `path:` is frequently not the
 * default, and the default itself — `Sources/<name>` — is only a default. Since
 * a Swift grammar is already loaded to read every other file, the manifest is
 * read with it, and the conventional layout is the fallback for a manifest that
 * could not be read rather than the rule.
 *
 * ## What is unknown
 *
 * A parse error, and a missing grammar. `@_exported import` re-exports a module
 * through this one and is read as an ordinary import, which under-reports the
 * transitive reach by exactly one hop.
 */

import { missingGrammar, parserFor, type GrammarNode } from './grammar.js';
import type { Export, Read, Request } from './read.js';
import type { TreeWorld } from './world.js';

/** The request a file makes for its own target: the files it sees without asking. */
const OWN_TARGET = '*';

const SWIFT_FILE = '.swift';
const MANIFEST = 'Package.swift';

export function readSwift(file: string, source: string): Read {
  const parser = parserFor('swift');
  if (parser === undefined) {
    return { requests: [], unknown: missingGrammar(file, 'swift') };
  }

  const tree = parser.parse(source);
  if (tree === null) {
    return { requests: [], unknown: `${file} could not be parsed as Swift.` };
  }

  const requests: Request[] = [];
  const exports: Export[] = [];
  const seen = new Set<string>();

  const want = (value: string, local: string, line: number): void => {
    if (value === '' || seen.has(value)) return;
    seen.add(value);
    requests.push({
      value,
      kind: 'imports',
      bindings: [{ imported: local, local, type: false, line }],
      line,
      // Always. A module name is not a path, `Foundation` and `Core` are written
      // identically, and the target a name belongs to is a fact about the tree.
      guessed: true,
    });
  };

  // The files beside this one, which it sees with no statement of any kind.
  want(OWN_TARGET, OWN_TARGET, 1);

  for (const child of tree.rootNode.namedChildren) {
    const line = child.startPosition.row + 1;
    if (child.type === 'import_declaration') {
      const name = child.namedChildren.find((part) => part.type === 'identifier');
      // `import struct Answer.Lens` names the module `Answer`; the rest of the
      // path is a symbol inside it, and there is no file grain below the module.
      const module = name?.namedChildren[0]?.text ?? name?.text.split('.')[0];
      if (module !== undefined) want(module, module, line);
      continue;
    }
    const name = declared(child);
    if (name !== undefined) exports.push({ exported: name, local: name, type: false, line });
  }

  return {
    requests,
    ...(exports.length === 0 ? {} : { exports }),
    ...(tree.rootNode.hasError
      ? { unknown: `${file} did not parse cleanly as Swift, so what it imports may be incomplete.` }
      : {}),
  };
}

/**
 * Top-level declarations this file publishes.
 *
 * `class_declaration` is every nominal type in this grammar — `struct`, `class`,
 * `enum` and `actor` all reach it — and the keyword that separates them is an
 * anonymous node. Nothing here needs to tell them apart.
 */
const DECLARATIONS = new Set([
  'class_declaration',
  'protocol_declaration',
  'typealias_declaration',
  'function_declaration',
  'property_declaration',
]);

function declared(node: GrammarNode): string | undefined {
  if (!DECLARATIONS.has(node.type)) return undefined;
  const name = node.namedChildren.find(
    (child) => child.type === 'type_identifier' || child.type === 'simple_identifier',
  );
  if (name !== undefined) return name.text;
  // `let value = 1` binds through a pattern rather than naming itself.
  return node.namedChildren
    .find((child) => child.type === 'pattern')
    ?.namedChildren.find((child) => child.type === 'simple_identifier')?.text;
}

/** Swift requests never name a path, so a Swift request is never a hole. */
export function isSwiftRelative(): boolean {
  return false;
}

/** Every file a Swift module name reaches, which is every file in its target. */
export function resolveSwift(input: {
  readonly from: string;
  readonly request: string;
  readonly world: TreeWorld;
}): readonly string[] {
  const { from, request, world } = input;
  // A manifest is a build description, not a member of what it describes. Left
  // in, it sits under no target, falls back to the repository root, and joins
  // every Swift file in the tree to every other one.
  if (isManifest(from)) return [];

  const targets = targetIndex(world);
  if (request !== OWN_TARGET) {
    const declared = targets.byName.get(request);
    return declared === undefined ? [] : sourcesUnder(world, declared, from, true);
  }

  const own = targets.directories.find((at) => from.startsWith(`${at}/`));
  if (own !== undefined) return sourcesUnder(world, own, from, true);

  // A Swift file no package claims — an Xcode project, a loose script, a target
  // declared somewhere this could not read. Its own directory is the narrowest
  // thing certainly true of it, and only the files beside it: without a
  // manifest saying so, nothing says a subdirectory compiles with it.
  const cut = from.lastIndexOf('/');
  return sourcesUnder(world, cut === -1 ? '' : from.slice(0, cut), from, false);
}

function isManifest(path: string): boolean {
  return path === MANIFEST || path.endsWith(`/${MANIFEST}`);
}

function sourcesUnder(
  world: TreeWorld,
  directory: string,
  from: string,
  deep: boolean,
): readonly string[] {
  const paths = deep ? world.below(directory) : world.under(directory);
  return paths.filter((path) =>
    path.endsWith(SWIFT_FILE) && path !== from && !isManifest(path));
}

interface Targets {
  /** Module name → the directory its sources sit under. */
  readonly byName: ReadonlyMap<string, string>;
  /** Every target directory, longest first, so the innermost wins. */
  readonly directories: readonly string[];
}

function targetIndex(world: TreeWorld): Targets {
  return world.index('swift:targets', (tree) => {
    const byName = new Map<string, string>();

    for (const manifest of tree.below('')) {
      if (manifest !== MANIFEST && !manifest.endsWith(`/${MANIFEST}`)) continue;
      const at = manifest.slice(0, Math.max(0, manifest.length - MANIFEST.length - 1));

      // The convention first, so a manifest that could not be read still
      // produces targets, and a declared `path:` overwrites the guess after.
      for (const kind of ['Sources', 'Tests']) {
        for (const path of tree.below(under(at, kind))) {
          const rest = path.slice(under(at, kind).length + 1);
          const slash = rest.indexOf('/');
          if (slash > 0) byName.set(rest.slice(0, slash), under(at, `${kind}/${rest.slice(0, slash)}`));
        }
      }

      for (const target of declaredTargets(tree.text(manifest))) {
        byName.set(target.name, under(at, target.path));
      }
    }

    return {
      byName,
      directories: [...new Set(byName.values())].sort((a, b) => b.length - a.length),
    };
  });
}

function under(at: string, rest: string): string {
  return at === '' ? rest : `${at}/${rest}`;
}

/** The `.target(name:path:)` calls in a manifest, read with the Swift grammar. */
function declaredTargets(
  text: string | undefined,
): readonly { readonly name: string; readonly path: string }[] {
  const parser = parserFor('swift');
  if (text === undefined || parser === undefined) return [];
  const tree = parser.parse(text);
  if (tree === null) return [];

  const found: { name: string; path: string }[] = [];

  const visit = (node: GrammarNode): void => {
    if (node.type === 'call_expression') {
      const callee = calleeOf(node);
      if (callee !== undefined && callee.toLowerCase().endsWith('target')) {
        const args = node.namedChildren
          .find((child) => child.type === 'call_suffix')
          ?.namedChildren.find((child) => child.type === 'value_arguments');
        const name = argument(args, 'name');
        if (name !== undefined) {
          // SwiftPM's own defaults, which are what a target with no `path:` means.
          const fallback = callee === 'testTarget' ? `Tests/${name}` : `Sources/${name}`;
          found.push({ name, path: argument(args, 'path') ?? fallback });
        }
      }
    }
    for (const child of node.namedChildren) visit(child);
  };

  visit(tree.rootNode);
  return found;
}

/** `.target` parses as a prefix expression: the dot is the prefix and the name follows. */
function calleeOf(call: GrammarNode): string | undefined {
  const head = call.namedChildren[0];
  if (head === undefined) return undefined;
  if (head.type === 'simple_identifier') return head.text;
  if (head.type === 'prefix_expression') {
    return head.namedChildren.find((child) => child.type === 'simple_identifier')?.text;
  }
  return undefined;
}

function argument(args: GrammarNode | undefined, label: string): string | undefined {
  if (args === undefined) return undefined;
  for (const value of args.namedChildren) {
    if (value.type !== 'value_argument') continue;
    const written = value.namedChildren.find((child) => child.type === 'value_argument_label');
    if (written?.text !== label) continue;
    const literal = value.namedChildren.find((child) => child.type === 'line_string_literal');
    if (literal === undefined) return undefined;
    return literal.namedChildren.map((part) => part.text).join('');
  }
  return undefined;
}
