import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { type Parses, everyBindingIn, parseFile } from './declare.js';
import { lineAt } from './doc.js';
import { readImportTargets } from './manifest.js';
import { type Bound, type Exported, ownBinding, type Recorded, type Usage, type UsageOptions, usageFrom } from './use.js';

/**
 * [`use.ts`](./use.ts) read off a checkout's disk: every module file walked,
 * parsed with oxc, and its import and export statements turned into the
 * `Recorded` files `usageFrom` joins against what the manifests open.
 */

/**
 * Directories that hold something other than source somebody wrote.
 *
 * A package's own build output is skipped by reading its `tsconfig.json`, which
 * is the authority on where that output lands; this list is for the ones no
 * manifest mentions. `dist` is on it as well as in the manifests, because a
 * directory that holds a bundler's output is not always a package with a
 * `tsconfig.json` to ask — the site's is a Next build, and reading it reports a
 * chunk's hundred minified re-exports as a hundred names somebody wrote.
 */
const SKIP: readonly string[] = ['node_modules', 'coverage', 'build', 'dist', 'out'];

const MODULES = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);

/**
 * The name a module record entry names, on either side of the record.
 *
 * Nothing, for `import * as ns` and `export * from`: both take whatever is
 * there, so the other module is used and no single name in it is.
 */
function nameOf(kind: string, name: string | null): string | undefined {
  if (kind === 'Name') return name ?? undefined;
  if (kind === 'Default') return 'default';
  return undefined;
}

/** The build directory a package's own `tsconfig.json` declares, if it declares one. */
function built(dir: string): string | undefined {
  const config = join(dir, 'tsconfig.json');
  if (!existsSync(config)) return undefined;
  const { compilerOptions } = JSON.parse(readFileSync(config, 'utf8')) as {
    compilerOptions?: { outDir?: string };
  };
  return compilerOptions?.outDir?.replace(/^\.\//, '').split('/')[0];
}

/**
 * Every module file under a root, each attributed to the package that owns it.
 *
 * Ownership is the nearest manifest above the file, which is what makes an
 * example directory a consumer with a name rather than an anonymous caller.
 */
function walk(
  dir: string,
  owner: string,
  skip: ReadonlySet<string>,
  found: (file: string, owner: string) => void,
): void {
  let here = owner;
  const ignore = new Set(skip);

  const manifest = join(dir, 'package.json');
  if (existsSync(manifest)) {
    const name = (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown }).name;
    if (typeof name === 'string') here = name;
    const out = built(dir);
    if (out !== undefined) ignore.add(out);
  }

  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )) {
    if (entry.name.startsWith('.') || ignore.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, here, ignore, found);
    else if (MODULES.has(extname(entry.name))) found(path, here);
  }
}

/**
 * Read what a repository imports from what it publishes.
 *
 * `opened` is every `<package> <subpath>` a manifest answers, and it does double
 * duty: the package half says which specifiers are worth following at all, and
 * the whole key says which of them came through a published door. A package the
 * manifests declare no entry for is followed as well, and every import of it is
 * listed under `byPath`.
 */
export function readUsage(
  root: string,
  opened: ReadonlySet<string>,
  options: UsageOptions = {},
  parses: Parses = new Map(),
): Usage {
  const files: Recorded[] = [];

  walk(root, '', new Set([...SKIP, ...(options.skip ?? [])]), (file, owner) => {
    const at = relative(root, file);

    let source;
    try {
      source = parseFile(parses, file, at);
    } catch (error) {
      files.push({ at, by: owner, requests: [], unknown: `${error instanceof Error ? error.message : String(error)}` });
      return;
    }

    // One entry per specifier per statement. `export { a, b } from './x'` carries
    // its specifier per entry rather than per statement, so a statement's entries
    // can name two modules and the grouping has to be by what was named.
    const requests = new Map<string, { line: number; names: Bound[] }>();

    const requestAt = (specifier: string, offset: number) => {
      const line = lineAt(source.writing, offset);
      const held = requests.get(`${specifier}\u0000${line}`) ?? { line, names: [] };
      requests.set(`${specifier}\u0000${line}`, held);
      return held;
    };

    // The names this file imports, which an export of the same name binds nothing of its own by.
    const importedHere = new Set<string>();
    for (const statement of source.parsed.module.staticImports) {
      const held = requestAt(statement.moduleRequest.value, statement.start);
      for (const entry of statement.entries) {
        const imported = nameOf(entry.importName.kind, entry.importName.name);
        const local = entry.localName.value;
        importedHere.add(local);
        if (imported !== undefined) held.names.push({ imported, ...(local === imported ? {} : { local }), type: entry.isType, line: held.line });
      }
    }

    const publishes: Exported[] = [];
    // `export { x }` has no comment of its own: its doc is above what it binds,
    // and its kind is that declaration's.
    // One name may be declared twice, `const Kind` and `type Kind`: an export
    // takes the declaration on its own line, else the first.
    let declared: ReturnType<typeof everyBindingIn> | undefined;
    const bound = (local: string | null, line: number) => {
      const named = local === null ? undefined : (declared ??= everyBindingIn(source)).get(local);
      return named?.find((one) => one.line === line) ?? named?.[0];
    };
    for (const statement of source.parsed.module.staticExports) {
      const line = lineAt(source.writing, statement.start);
      const above = source.writing.docs.get(statement.start);
      for (const entry of statement.entries) {
        // `export * from './x'` names nothing here: the set is whatever the other
        // file publishes, and inventing a name would claim one never written.
        const exported = nameOf(entry.exportName.kind, entry.exportName.name);
        const own = entry.moduleRequest === null ? ownBinding(entry.localName.name, importedHere) : undefined;
        const binds = own === undefined ? undefined : bound(entry.localName.name, line);
        const doc = above ?? binds?.doc;
        if (exported !== undefined) {
          publishes.push({
            name: exported,
            line,
            type: entry.isType,
            ...(own === undefined ? {} : { bound: own }),
            ...(binds === undefined ? {} : { declaration: binds.kind }),
            ...(doc === undefined ? {} : { doc }),
          });
        }

        const specifier = entry.moduleRequest?.value;
        if (specifier === undefined) continue;
        const held = requestAt(specifier, statement.start);
        const imported = nameOf(entry.importName.kind, entry.importName.name);
        if (imported !== undefined) held.names.push({ imported, ...(exported === undefined || exported === imported ? {} : { local: exported }), type: entry.isType, line: held.line });
      }
    }

    files.push({
      at,
      by: owner,
      publishes,
      requests: [...requests].map(([key, held]) => ({
        specifier: key.slice(0, key.indexOf('\u0000')),
        line: held.line,
        names: held.names,
      })),
    });
  });

  return usageFrom(opened, files, readImportTargets(root));
}
