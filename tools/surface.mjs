#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSync } from 'oxc-parser';
import { ResolverFactory } from 'oxc-resolver';
import { ROOT, offerings } from './manifests.mjs';

/**
 * What this repository offers an adopter, as one value.
 *
 * Two halves, and the split is the whole design. What a package *offers* comes
 * from its `package.json` — the subpaths its `exports` map opens, its `bin`, its
 * peers — because that manifest is the thing npm publishes and the thing another
 * project reads. What each entrypoint *reaches* comes from the source the
 * manifest points at, followed through the barrels, because `core` re-exports
 * eight groups which re-export forty files and a rule that stopped at the first
 * `export *` would be watching eight lines instead of a thousand names.
 *
 * This is the edge nothing else here watches. `tools/boundaries.check.ts`
 * governs who may depend on whom and `tools/surfaces.check.ts` governs how many
 * boxes an adopter has to know; both are rules about *shape*, and neither would
 * say a word if a rename dropped `digestValue` out of `@variance-authority/core`,
 * if a subpath stopped resolving, or if a package started shipping a bin. Those
 * are the changes somebody else's build finds out about.
 *
 * *Nothing derived.* The `types` targets point into `dist`, and `dist` is what a
 * build produced — so this maps each one back through the package's own
 * `rootDir`/`outDir` and reads the source. No `yarn build` is a precondition, and
 * the names recorded are the ones somebody wrote rather than the ones `tsc`
 * emitted. What that costs is named at `KINDS` and refused rather than guessed:
 * a declaration form this does not know is an error with a `file:line`, never a
 * quiet `unknown` that shrinks the surface without saying so.
 *
 * *Nothing hand-rolled.* `oxc-parser` supplies the module record — every export
 * entry with the name it publishes, the name it imports, and whether it is
 * type-only — and `oxc-resolver` follows relative specifiers, `.js` to `.ts`
 * included. Both are already dependencies of `packages/sense`, whose
 * `src/resolve.ts` is the reference for the options below.
 *
 * *What a source read cannot see.* A name and what kind of thing it is, never
 * its type. An emitted `.d.ts` states what the compiler inferred; source states
 * what somebody wrote, so `export const jsxDEV = runtime.jsxDEV` records here as
 * a const and nothing more where the emitted declaration carries its full
 * signature. A signature that changes under a name that does not is a change
 * this misses. That is a limitation rather than a reason to read `dist`, which
 * costs a build as a precondition and pays in stale output: read from source,
 * this recovers every name the emitted declarations have and one they do not.
 *
 * `node tools/surface.mjs` prints it; `--write` records it as the baseline.
 * `tools/surface.check.ts` is what compares the two.
 */

export const BASELINE = join(ROOT, 'tools/surface.baseline.json');

/**
 * What a top-level declaration is, said in one word.
 *
 * Total over the forms this repository contains, and fatal outside them. An
 * `enum`, a `namespace`, an `export =` or a `declare global` would each be a real
 * addition to what we offer, and the worst possible response is a surface that
 * omits it without saying so.
 */
const KINDS = {
  FunctionDeclaration: 'function',
  ClassDeclaration: 'class',
  TSInterfaceDeclaration: 'interface',
  TSTypeAliasDeclaration: 'type',
  TSEnumDeclaration: 'enum',
  TSModuleDeclaration: 'namespace',
};

/**
 * What a default export is, when it is an expression rather than a declaration.
 *
 * `export default function f() {}` is a declaration and `KINDS` answers it. The
 * one default export in this repository is an object literal — a Worker's
 * `{ fetch }` — and an object is what that entrypoint publishes.
 */
const DEFAULTS = {
  ObjectExpression: 'object',
  FunctionExpression: 'function',
  ArrowFunctionExpression: 'function',
  ClassExpression: 'class',
};

/** Relative specifiers only. A bare one names a package, and packages come from manifests. */
const resolver = new ResolverFactory({
  extensions: ['.ts', '.tsx', '.mts', '.cts'],
  // A file written under `nodenext` imports `./value.js` and means `./value.ts`.
  // Without this every relative specifier fails and the surface is eight names.
  extensionAlias: { '.js': ['.ts', '.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'] },
  conditionNames: ['types', 'import', 'default'],
  symlinks: true,
});

/** `<package name> <subpath>` to the source file that entrypoint begins at. */
const ENTRYPOINTS = new Map();

/** `@variance-authority/core/plan` as the pair a manifest can answer. */
function requested(specifier) {
  const parts = specifier.split('/');
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  return `${name} .${specifier.slice(name.length)}`;
}

/**
 * Where a specifier points, or nothing when it leaves this repository.
 *
 * A workspace package is answered from its manifest rather than resolved,
 * because resolving it would go through the `exports` map into `dist` — the built
 * thing this producer exists in order not to read.
 */
function target(from, specifier) {
  if (!specifier.startsWith('.')) return ENTRYPOINTS.get(requested(specifier));

  try {
    return resolver.sync(dirname(from), specifier).path;
  } catch {
    return undefined;
  }
}

const PARSED = new Map();

function parse(file) {
  const held = PARSED.get(file);
  if (held !== undefined) return held;

  const result = parseSync(file, readFileSync(file, 'utf8'));
  const first = result.errors[0];
  if (first !== undefined) throw new Error(`${at(file)} does not parse: ${first.message}`);

  PARSED.set(file, result);
  return result;
}

/** Every locally declared name in a file, to what kind of declaration it is. */
function declared(file) {
  const kinds = new Map();

  for (const node of parse(file).program.body) {
    if (node.type === 'ExportDefaultDeclaration') {
      const kind = KINDS[node.declaration.type] ?? DEFAULTS[node.declaration.type];
      if (kind === undefined) {
        throw new Error(`${at(file)} default-exports a \`${node.declaration.type}\`, which nothing here names`);
      }
      kinds.set('default', kind);
      continue;
    }

    const declaration = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
    if (declaration === null || declaration === undefined) continue;

    if (declaration.type === 'VariableDeclaration') {
      for (const one of declaration.declarations) bindings(one.id, kinds, declaration.kind);
      continue;
    }

    const kind = KINDS[declaration.type];
    if (kind !== undefined && declaration.id?.name !== undefined) kinds.set(declaration.id.name, kind);
  }

  return kinds;
}

/** Every name a declarator introduces, destructuring included. */
function bindings(pattern, into, kind) {
  if (pattern.type === 'Identifier') into.set(pattern.name, kind);
  else if (pattern.type === 'ObjectPattern') {
    for (const property of pattern.properties) {
      bindings(property.type === 'RestElement' ? property.argument : property.value, into, kind);
    }
  } else if (pattern.type === 'ArrayPattern') {
    for (const element of pattern.elements) if (element !== null) bindings(element, into, kind);
  }
}

function add(into, name, kind) {
  const held = into.get(name);
  if (held === undefined) into.set(name, new Set([kind]));
  else held.add(kind);
}

/**
 * Every name a file publishes, followed through its re-exports.
 *
 * Two structures, because they answer different questions. `REACHED` is a cache:
 * `format/index.ts` reaches `value.ts` twice on two adjacent lines — once for its
 * types and once for its functions — and a plain visited-set reads the second as
 * a cycle and returns nothing. `stack` is the cycle guard, and it unwinds.
 */
const REACHED = new Map();

function reach(file, stack = new Set()) {
  const held = REACHED.get(file);
  if (held !== undefined) return held;
  const found = new Map();
  if (stack.has(file)) return found;
  stack.add(file);

  const local = declared(file);

  for (const statement of parse(file).module.staticExports) {
    for (const entry of statement.entries) {
      const specifier = entry.moduleRequest?.value;
      const to = specifier === undefined ? undefined : target(file, specifier);

      // `export * from './x.js'` republishes a set this file never names.
      if (entry.exportName.kind === 'None') {
        if (to === undefined) add(found, `* from '${specifier}'`, 'foreign');
        else for (const [name, kinds] of reach(to, stack)) for (const k of kinds) add(found, name, k);
        continue;
      }

      const name = entry.exportName.name ?? 'default';

      // `export * as ns from './x.js'` publishes one object, not a set.
      if (entry.importName.kind === 'AllButDefault') {
        add(found, name, 'namespace');
        continue;
      }

      if (specifier === undefined) {
        const kind = local.get(entry.localName.name ?? name);
        if (kind === undefined) {
          throw new Error(`${at(file)} exports \`${name}\`, and no declaration here says what it is`);
        }
        add(found, name, kind);
        continue;
      }

      if (to === undefined) {
        add(found, name, 'foreign');
        continue;
      }

      const kinds = reach(to, stack).get(entry.importName.name ?? 'default');
      if (kinds === undefined) {
        throw new Error(`${at(file)} re-exports \`${name}\` from \`${specifier}\`, which does not publish it`);
      }
      for (const kind of kinds) add(found, name, kind);
    }
  }

  stack.delete(file);
  REACHED.set(file, found);
  return found;
}

function at(file) {
  return relative(ROOT, file);
}

export function surface() {
  const found = offerings();

  ENTRYPOINTS.clear();
  for (const pkg of found) {
    for (const entry of pkg.entries) ENTRYPOINTS.set(`${pkg.name} ${entry.subpath}`, entry.source);
  }

  const value = {};
  for (const pkg of found) {
    const names = {};
    for (const entry of pkg.entries) {
      const reachable = {};
      for (const [name, kinds] of [...reach(entry.source)].sort()) {
        reachable[name] = [...kinds].sort().join('+');
      }
      names[entry.subpath] = reachable;
    }
    value[pkg.name] = { declared: pkg.declared, names };
  }

  return value;
}

export function countOf(value) {
  return Object.values(value).reduce(
    (total, pkg) => total + Object.values(pkg.names).reduce((n, entry) => n + Object.keys(entry).length, 0),
    0,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const value = surface();
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (process.argv.includes('--write')) {
    writeFileSync(BASELINE, text, 'utf8');
    process.stdout.write(
      `surface: ${countOf(value)} names over ${Object.keys(value).length} packages, recorded\n`,
    );
  } else {
    process.stdout.write(text);
  }
}
