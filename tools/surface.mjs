#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * What this repository offers an adopter, as one value.
 *
 * Every package that is published, every entrypoint its `exports` map opens, and
 * every name reachable through that entrypoint — followed through the barrels,
 * because `core` re-exports seven groups which re-export forty files, and a rule
 * that stopped at the first `export *` would be watching eight lines instead of
 * a thousand names.
 *
 * This is the edge nothing else here watches. `tools/boundaries.check.ts`
 * governs who may depend on whom and `tools/surfaces.check.ts` governs how many
 * boxes an adopter has to know; both are rules about *shape*, and neither would
 * say a word if a rename dropped `digestValue` out of `@variance-authority/core`,
 * if a subpath stopped resolving, or if a package started shipping a bin. Those
 * are the changes somebody else's build finds out about.
 *
 * *Why it parses rather than asks the compiler.* TypeScript 7 publishes its API
 * under `unstable/`, and this is a producer that has to keep working — the same
 * argument `tools/unrun.mjs` makes for having no build step and no dependency. A
 * `.d.ts` that `tsc` emitted is regular enough to read: the barrels are
 * `export … from`, the leaves are `export declare`, and both are matched below.
 * The cost is real and worth naming: this reads *declarations*, so a name is a
 * name and its type is not compared. A signature that changed while its name
 * stayed put is invisible here, and that is the next rung rather than a bug.
 *
 * *Where it stops.* A name re-exported from outside the workspace — `JSX` from
 * `react/jsx-dev-runtime` — is recorded with the kind `foreign`, and a wholesale
 * `export * from 'react/jsx-runtime'` is recorded as the forwarding line itself.
 * Both say the same thing: this is an edge we offer and cannot see through. The
 * kind `unknown` means something else entirely — the parser met a form it does
 * not read — and a surface with one in it is a bug here, not a fact about us.
 *
 * `node tools/surface.mjs` prints it; `--write` records it as the baseline.
 * `tools/surface.check.ts` is what compares the two.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BASELINE = join(ROOT, 'tools/surface.baseline.json');

/** A declaration that introduces a name, and what kind of thing it introduces. */
const DECLARATIONS = [
  [/(?:^|\n)\s*(?:export\s+)?declare\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g, 'class'],
  [/(?:^|\n)\s*(?:export\s+)?declare\s+function\s+([A-Za-z_$][\w$]*)/g, 'function'],
  [/(?:^|\n)\s*(?:export\s+)?declare\s+(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/g, 'enum'],
  [/(?:^|\n)\s*(?:export\s+)?declare\s+namespace\s+([A-Za-z_$][\w$]*)/g, 'namespace'],
  [/(?:^|\n)\s*(?:export\s+)?declare\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g, 'const'],
  [/(?:^|\n)\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/g, 'interface'],
  [/(?:^|\n)\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*[<=]/g, 'type'],
];

/** The same list, restricted to the ones written `export …` at the top level. */
const EXPORTED = DECLARATIONS.map(([pattern, kind]) => [
  new RegExp(pattern.source.replace('(?:export\\s+)?', 'export\\s+'), 'g'),
  kind,
]);

/** `export { a, b as c }` and `export type { … }`, with or without a source. */
const CLAUSE = /(?:^|\n)\s*export\s+(type\s+)?\{([^}]*)\}\s*(?:from\s*'([^']+)')?\s*;/g;
const STAR = /(?:^|\n)\s*export\s+\*\s+from\s*'([^']+)'\s*;/g;
/** `import { a, type b as c } from '…'` — what a bare `export { … }` can name. */
const IMPORT = /(?:^|\n)\s*import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*'([^']+)'\s*;/g;

/** Comments go first: this repository's declarations carry more prose than code. */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** `{ a, type b as c }` as pairs of the name declared and the name bound. */
function* clause(list) {
  for (const item of list.split(',')) {
    const parts = item.trim().replace(/^type\s+/, '').split(/\s+as\s+/);
    const original = parts[0]?.trim();
    const bound = (parts[1] ?? parts[0])?.trim();
    if (original === undefined || bound === undefined || original === '') continue;
    yield [original, bound];
  }
}

/**
 * The declaration file a specifier opens, or `null` when it leaves the workspace.
 *
 * Relative first, then across packages: `cli` re-exports `settle` from
 * `@variance-authority/raster`, and a resolver that only walked directories
 * would have called one of our own names foreign.
 */
function declarationFile(from, specifier) {
  if (specifier.startsWith('.')) {
    const base = resolve(dirname(from), specifier.replace(/\.js$/, ''));
    for (const candidate of [`${base}.d.ts`, join(base, 'index.d.ts')]) {
      if (existsSync(candidate)) return candidate;
    }
    return null;
  }
  const parts = specifier.split('/');
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  const pkg = workspace().get(name);
  if (pkg === undefined) return null;
  const rest = specifier.slice(name.length);
  return entrypoints(pkg).find((entry) => entry.subpath === `.${rest}`)?.file ?? null;
}

function add(into, name, kind) {
  const held = into.get(name);
  if (held === undefined) into.set(name, new Set([kind]));
  else held.add(kind);
}

/**
 * Every name a declaration file exports, followed through its re-exports.
 *
 * Two structures, because they answer different questions and sharing one broke
 * this. `RESOLVED` is a cache: `format/index.d.ts` reaches `value.d.ts` twice on
 * two adjacent lines — once for its types and once for its functions — and a
 * plain visited-set reads the second one as a cycle and returns nothing, which
 * is how `shapeValue` came back as `unknown`. `stack` is the cycle guard, and it
 * unwinds.
 */
const RESOLVED = new Map();

function exportsOf(file, stack = new Set()) {
  const held = RESOLVED.get(file);
  if (held !== undefined) return held;
  const names = new Map();
  if (stack.has(file)) return names;
  stack.add(file);

  const text = code(readFileSync(file, 'utf8'));

  // Local declarations, exported or not: a bare `export { … }` names them.
  const local = new Map();
  for (const [pattern, kind] of DECLARATIONS) {
    for (const match of text.matchAll(pattern)) add(local, match[1], kind);
  }
  for (const [pattern, kind] of EXPORTED) {
    for (const match of text.matchAll(pattern)) add(names, match[1], kind);
  }

  // A name can also arrive imported and leave on the next line: `core/attribute`
  // imports `StackFrame` from `format/provenance` and then re-exports it bare.
  const borrowed = new Map();
  for (const match of text.matchAll(IMPORT)) {
    for (const [original, bound] of clause(match[1])) {
      borrowed.set(bound, { original, specifier: match[2] });
    }
  }

  for (const match of text.matchAll(STAR)) {
    const target = declarationFile(file, match[1]);
    if (target === null) {
      add(names, `* from '${match[1]}'`, 'foreign');
      continue;
    }
    for (const [name, kinds] of exportsOf(target, stack)) {
      for (const kind of kinds) add(names, name, kind);
    }
  }

  for (const match of text.matchAll(CLAUSE)) {
    const target = match[3] === undefined ? null : declarationFile(file, match[3]);
    const away = match[3] !== undefined && target === null;
    const from = target === null ? local : exportsOf(target, stack);
    for (const [original, exposed] of clause(match[2])) {
      const kinds = away ? ['foreign'] : (from.get(original) ?? through(file, borrowed, original, stack));
      for (const kind of kinds) add(names, exposed, kind);
    }
  }

  stack.delete(file);
  RESOLVED.set(file, names);
  return names;
}

/** A name this file imported and re-exports: follow it to where it was declared. */
function through(file, borrowed, name, stack) {
  const held = borrowed.get(name);
  if (held === undefined) return ['unknown'];
  const target = declarationFile(file, held.specifier);
  if (target === null) return ['foreign'];
  return exportsOf(target, stack).get(held.original) ?? ['unknown'];
}

function packages() {
  const dir = join(ROOT, 'packages');
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isDirectory())
    .filter((name) => existsSync(join(dir, name, 'package.json')))
    .map((name) => ({
      dir: join(dir, name),
      manifest: JSON.parse(readFileSync(join(dir, name, 'package.json'), 'utf8')),
    }));
}

/**
 * Every workspace package by name, private ones included — a published package
 * may re-export from a private one, and the name it forwards is public either way.
 */
const WORKSPACE = new Map();

function workspace() {
  if (WORKSPACE.size === 0) {
    for (const pkg of packages()) WORKSPACE.set(pkg.manifest.name, pkg);
  }
  return WORKSPACE;
}

/** The `types` file each subpath opens, when the map declares one. */
function entrypoints(pkg) {
  const found = [];
  for (const [subpath, condition] of Object.entries(pkg.manifest.exports ?? {})) {
    const types = typeof condition === 'string' ? null : condition?.types;
    if (typeof types !== 'string') continue;
    found.push({ subpath, types, file: resolve(pkg.dir, types) });
  }
  return found;
}

export function surface() {
  const found = packages().filter(({ manifest }) => manifest.private !== true);
  const missing = found
    .flatMap((pkg) => entrypoints(pkg))
    .filter((entry) => !existsSync(entry.file))
    .map((entry) => entry.file.slice(ROOT.length + 1));

  if (missing.length > 0) {
    throw new Error(
      `no built types for ${missing.length} entrypoint(s), starting at ${missing[0]}. ` +
        'Run `yarn build` first: the published surface is the built one, not the one ' +
        'the source implies.',
    );
  }

  const value = {};
  for (const pkg of found) {
    const opened = {};
    for (const entry of entrypoints(pkg)) {
      const names = {};
      for (const [name, kinds] of [...exportsOf(entry.file)].sort()) {
        names[name] = [...kinds].sort().join('+');
      }
      opened[entry.subpath] = { types: entry.types, exports: names };
    }
    value[pkg.manifest.name] = {
      entrypoints: opened,
      ...(pkg.manifest.bin === undefined ? {} : { bin: pkg.manifest.bin }),
      ...(pkg.manifest.peerDependencies === undefined
        ? {}
        : { peerDependencies: pkg.manifest.peerDependencies }),
    };
  }
  return value;
}

export function countOf(value) {
  return Object.values(value).reduce(
    (total, pkg) =>
      total +
      Object.values(pkg.entrypoints).reduce(
        (inner, entry) => inner + Object.keys(entry.exports).length,
        0,
      ),
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
