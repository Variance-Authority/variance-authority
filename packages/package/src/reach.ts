import { dirname, relative } from 'node:path';
import { ResolverFactory } from 'oxc-resolver';
import {
  type Declaration,
  type DeclarationKind,
  type Parses,
  around,
  declarationOf,
  declarationsIn,
  parseFile,
} from './declare.js';
import { headOf } from './doc.js';
import { requested } from './manifest.js';

/**
 * Every name an entrypoint publishes, followed through its re-exports.
 *
 * A barrel is the normal shape of an entrypoint and it is the reason a rule that
 * reads one file is worthless: `@variance-authority/core` re-exports eight groups
 * which re-export forty files, so stopping at the first `export *` would watch
 * eight lines instead of a thousand names.
 */

/**
 * A name, and every kind of thing it turns out to be.
 *
 * Keyed by kind rather than held as a list, because a barrel reaches the same
 * name twice — once for the interface and once for the `const` of the same name
 * — and the second arrival of a kind already recorded is the same declaration,
 * not a second one.
 */
export type Names = Map<string, Map<DeclarationKind, Declaration>>;

/**
 * Relative specifiers only. A bare one names a package, and packages are
 * answered from the manifests — resolving one would go through its `exports` map
 * into a built directory, which is the thing this refuses to read.
 */
const RESOLVER = new ResolverFactory({
  extensions: ['.ts', '.tsx', '.mts', '.cts'],
  // A file written under `nodenext` imports `./value.js` and means `./value.ts`.
  // Without this every relative specifier fails and the surface is eight names.
  extensionAlias: { '.js': ['.ts', '.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'] },
  conditionNames: ['types', 'import', 'default'],
  symlinks: true,
});

/**
 * One read of one workspace.
 *
 * The caches are here rather than in module scope because two reads of two
 * checkouts are two different questions, and a parse held across them would
 * answer the second with the first one's files.
 */
export interface Reader {
  readonly root: string;
  readonly parses: Parses;
  readonly reached: Map<string, Names>;
  /** `<package name> <subpath>` to the source that entrypoint begins at. */
  readonly entrypoints: ReadonlyMap<string, string>;
}

/**
 * Begin one read, with the entrypoints it is allowed to resolve through.
 *
 * The map is supplied rather than discovered because what a package publishes is
 * a manifest decision. A specifier that is not relative reaches only what
 * `exports` names, and a reader that resolved those itself would report names no
 * installer can reach. So an empty map is the honest default: nothing but
 * relative specifiers resolves, which is what reading a single package means.
 */
export function createReader(root: string, entrypoints: ReadonlyMap<string, string> = new Map()): Reader {
  return { root, parses: new Map(), reached: new Map(), entrypoints };
}

/** Where a specifier points, or nothing when it leaves this workspace. */
function targetOf(reader: Reader, from: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return reader.entrypoints.get(requested(specifier));

  try {
    return RESOLVER.sync(dirname(from), specifier).path;
  } catch {
    return undefined;
  }
}

function add(into: Names, name: string, declaration: Declaration): void {
  const held = into.get(name);
  if (held === undefined) into.set(name, new Map([[declaration.kind, declaration]]));
  else if (!held.has(declaration.kind)) held.set(declaration.kind, declaration);
}

/**
 * Every name a file publishes.
 *
 * Two structures, because they answer different questions. `reached` is a cache:
 * a barrel reaches the same file twice on two adjacent lines — once for its
 * types and once for its functions — and a plain visited-set reads the second as
 * a cycle and returns nothing. `stack` is the cycle guard, and it unwinds.
 */
export function namesReachedBy(reader: Reader, file: string, stack: Set<string> = new Set()): Names {
  const held = reader.reached.get(file);
  if (held !== undefined) return held;
  const found: Names = new Map();
  if (stack.has(file)) return found;
  stack.add(file);

  const at = relative(reader.root, file);
  const source = parseFile(reader.parses, file, at);
  const local = declarationsIn(source);

  for (const statement of source.parsed.module.staticExports) {
    // A name this file does not declare is still written *somewhere*, and the
    // re-export is that somewhere: the statement carries the place, and a doc
    // block above it carries whatever the barrel wanted to say about the name.
    const context = around(source, statement.start);
    const written = headOf(source.text, statement.start, statement.end);

    for (const entry of statement.entries) {
      const specifier = entry.moduleRequest?.value;
      const to = specifier === undefined ? undefined : targetOf(reader, file, specifier);

      // `export * from './x.js'` republishes a set this file never names.
      if (entry.exportName.kind === 'None') {
        if (to === undefined) {
          add(found, `* from '${specifier}'`, declarationOf(source, context, 'foreign', written));
        } else for (const [name, kinds] of namesReachedBy(reader, to, stack)) {
          for (const declaration of kinds.values()) add(found, name, declaration);
        }
        continue;
      }

      const name = entry.exportName.name ?? 'default';

      // `export * as ns from './x.js'` publishes one object, not a set. `All`
      // rather than `AllButDefault` is the whole distinction the module record
      // draws here: a bare `export *` omits the default and is answered above,
      // and a namespace object carries it.
      if (entry.importName.kind === 'All') {
        add(found, name, declarationOf(source, context, 'namespace-object', written));
        continue;
      }

      if (specifier === undefined) {
        const declaration = local.get(entry.localName.name ?? name);
        if (declaration === undefined) {
          throw new Error(`${at} exports \`${name}\`, and no declaration there says what it is`);
        }
        add(found, name, declaration);
        continue;
      }

      if (to === undefined) {
        add(found, name, declarationOf(source, context, 'foreign', written));
        continue;
      }

      const kinds = namesReachedBy(reader, to, stack).get(entry.importName.name ?? 'default');
      if (kinds === undefined) {
        throw new Error(`${at} re-exports \`${name}\` from \`${specifier}\`, which does not publish it`);
      }
      for (const declaration of kinds.values()) add(found, name, declaration);
    }
  }

  stack.delete(file);
  reader.reached.set(file, found);
  return found;
}
