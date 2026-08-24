import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { type Parses, parseFile } from './declare.js';
import { lineAt } from './doc.js';
import { requested } from './manifest.js';

/**
 * Which published names anything in this repository actually imports.
 *
 * [`surface.ts`](./surface.ts) answers what a workspace *offers*. That is the
 * whole answer for a breakage question and half of one for every other question
 * worth asking. A thousand offered names are not a thousand equally important
 * names: some are the front door, some are a type three call sites mention once,
 * and some have not been imported by anything since the commit that added them.
 *
 * The difference is readable off the same disk. Every package here, every
 * example, every case is a consumer, and each one says in its own source which
 * names it reached for. Joined against the offering, that produces the thing
 * this exists for — an **active** API, ranked by what is load-bearing rather
 * than by what happens to be exported.
 *
 * ## A door that was never opened
 *
 * A specifier naming a workspace package at a subpath the manifest does not
 * publish is recorded separately, and it is the finding worth having. It means
 * one of two things and both matter: something is reaching past the front door
 * into another package's internals, or the manifest has stopped describing what
 * the package is actually used for.
 *
 * ## What it under-reports, and says so
 *
 * A file that does not parse is named in `unreadable` rather than skipped
 * silently. The direction of the error is the reason: a missed import makes a
 * live name look dead, and a name that looks dead is a name somebody deletes.
 * A dynamic `import('@scope/pkg')` binds no names the module record can see, so
 * it counts against the package and against no name in it.
 */

/** One place a published name is imported. */
export interface Use {
  /** The package whose source imports it — the nearest manifest above the file. */
  readonly by: string;
  /** The importing file, relative to the workspace root. */
  readonly at: string;
  /** The 1-based line the import is written on. */
  readonly line: number;
  /** `import type { x }` and `import { type x }` alike. */
  readonly type: boolean;
}

/** A specifier that reaches into a package past what its `exports` map opens. */
export interface Deep {
  /** As written. */
  readonly specifier: string;
  readonly by: string;
  readonly at: string;
  readonly line: number;
}

/** What a repository does with what it publishes. */
export interface Usage {
  /** `<package> <subpath>` to imported name to every place that imports it. */
  readonly names: ReadonlyMap<string, ReadonlyMap<string, readonly Use[]>>;
  /** Specifiers naming a workspace package at a subpath it does not open. */
  readonly deep: readonly Deep[];
  /** Files whose imports could not be enumerated. Empty is the expected answer. */
  readonly unreadable: readonly string[];
}

export interface UsageOptions {
  /** Directory names never descended into, added to the defaults rather than replacing them. */
  readonly skip?: readonly string[];
}

/**
 * Directories that hold something other than source somebody wrote.
 *
 * A package's own build output is skipped by reading its `tsconfig.json`, which
 * is the authority on where that output lands; this list is for the ones no
 * manifest mentions.
 */
const SKIP: readonly string[] = ['node_modules', 'coverage', 'build', 'out'];

const MODULES = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);

/**
 * The imported name a module record entry names.
 *
 * Nothing, for `import * as ns` and `export * from`: both take whatever is
 * there, so the package is used and no single name in it is.
 */
function importedAs(kind: string, name: string | null): string | undefined {
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
 * the whole key says which of them came through a published door.
 */
export function readUsage(
  root: string,
  opened: ReadonlySet<string>,
  options: UsageOptions = {},
  parses: Parses = new Map(),
): Usage {
  const packages = new Set([...opened].map((key) => key.slice(0, key.indexOf(' '))));
  const names = new Map<string, Map<string, Use[]>>();
  const deep: Deep[] = [];
  const unreadable: string[] = [];

  walk(root, '', new Set([...SKIP, ...(options.skip ?? [])]), (file, by) => {
    const at = relative(root, file);

    let source;
    try {
      source = parseFile(parses, file, at);
    } catch {
      unreadable.push(at);
      return;
    }

    const record = (specifier: string, imported: string | undefined, type: boolean, offset: number): void => {
      const key = requested(specifier);
      if (!packages.has(key.slice(0, key.indexOf(' ')))) return;

      const line = lineAt(source.writing, offset);
      if (!opened.has(key)) {
        deep.push({ specifier, by, at, line });
        return;
      }
      if (imported === undefined) return;

      const held = names.get(key) ?? new Map<string, Use[]>();
      names.set(key, held);
      const uses = held.get(imported) ?? [];
      held.set(imported, uses);
      uses.push({ by, at, line, type });
    };

    for (const statement of source.parsed.module.staticImports) {
      const specifier = statement.moduleRequest.value;
      // `import '@scope/pkg'` binds nothing and is still a use of the package.
      if (statement.entries.length === 0) record(specifier, undefined, false, statement.start);
      for (const entry of statement.entries) {
        record(specifier, importedAs(entry.importName.kind, entry.importName.name), entry.isType, statement.start);
      }
    }

    for (const statement of source.parsed.module.staticExports) {
      for (const entry of statement.entries) {
        const specifier = entry.moduleRequest?.value;
        if (specifier === undefined) continue;
        record(specifier, importedAs(entry.importName.kind, entry.importName.name), entry.isType, statement.start);
      }
    }
  });

  return { names, deep, unreadable };
}
