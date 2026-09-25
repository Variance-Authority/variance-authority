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
 * A parse error **where an import could have been**, and a missing grammar. A
 * grammar recovers from syntax it cannot read by wrapping it in an `ERROR` node
 * and carrying on, so one unreadable expression inside one function body costs
 * nothing: every import in the file is still there to be read. Marking the file
 * unknown over that would report a single unsupported form — one the grammar is
 * simply a version behind on — as imports nobody could read, when every one of
 * them was. An error hides an import
 * only when it sits where this reader looks, which for Swift is the top level,
 * because that is the only place an `import` is allowed.
 *
 * `@_exported import` re-exports a module through this one and is read as an
 * ordinary import, which under-reports the transitive reach by exactly one hop.
 */

import { native, nativeRefusal } from './native.js';
import type { TreeWorld } from './world.js';

/** The request a file makes for its own target: the files it sees without asking. */
const OWN_TARGET = '*';

const SWIFT_FILE = '.swift';
const MANIFEST = 'Package.swift';

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

type Target = { readonly name: string; readonly path: string };

/**
 * The `.target(name:path:)` calls in a manifest, read with the addon's Swift grammar.
 *
 * Nothing when the addon was built without its grammars: the conventional
 * layout [`targetIndex`](#targetIndex) laid down first is then the whole answer,
 * as it is for a manifest that does not parse.
 */
function declaredTargets(text: string | undefined): readonly Target[] {
  if (text === undefined) return [];
  const addon = native();
  if (addon === undefined) {
    throw new Error(`sense: reading Package.swift needs the native addon, which did not load: ${nativeRefusal()}`);
  }
  const answer = addon.swiftTargets(text);
  return answer === null ? [] : JSON.parse(answer) as Target[];
}
