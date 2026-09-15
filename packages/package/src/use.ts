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

/**
 * What kind of file reached for a name.
 *
 * A story and a test are not ordinary consumers. Both exist to *show* the thing
 * being used, which is what an example is, and a reader asking how a name is
 * written has a different question from a reader asking who depends on it. The
 * distinction is carried here rather than recovered from the path downstream,
 * because two ends deciding separately what counts as a story is two answers.
 */
export type UseKind = 'story' | 'test' | 'source';

/** Filename markers, read off the segment rather than the whole path. */
const STORY = ['.stories.'];
const TEST = ['.test.', '.spec.', '.check.'];

/** Which kind of file a path is, by the marker its own filename carries. */
export function kindOf(at: string): UseKind {
  const file = at.slice(at.lastIndexOf('/') + 1);
  if (STORY.some((mark) => file.includes(mark))) return 'story';
  if (TEST.some((mark) => file.includes(mark))) return 'test';
  return 'source';
}

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
  /** Whether the importing file is a story, a test, or ordinary source. */
  readonly kind: UseKind;
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
  /**
   * Every place a name is exported, published or not.
   *
   * The published surface is the part of this a manifest opens a door to, and it
   * is much the smaller part — this workspace publishes hundreds of names and
   * exports three thousand. The rest is not private: it is what one file in a
   * package takes from another, and it is the answer to *where is the thing that
   * does X* whenever X was never something to publish.
   */
  readonly exported: readonly Named[];
  /** Files whose imports could not be enumerated. Empty is the expected answer. */
  readonly unreadable: readonly string[];
}

/**
 * One place a name is exported.
 *
 * The mirror of {@link Use}, which is one place a name is imported, and it
 * carries the same four coordinates for the same reason: a reader told a name
 * exists needs a file and a line to open, and a ranking needs to know whether the
 * file that wrote it is source, a test or a story.
 */
export interface Named {
  /** The name as the file publishes it. `default` for a default export. */
  readonly name: string;
  /** The exporting file, relative to the workspace root. */
  readonly at: string;
  /** The package whose source it is — the nearest manifest above the file. */
  readonly by: string;
  /** The 1-based line the export statement is written on. */
  readonly line: number;
  /** `export type { x }` and `export { type x }` alike. */
  readonly type: boolean;
  /** Whether the exporting file is a story, a test, or ordinary source. */
  readonly kind: UseKind;
}

export interface UsageOptions {
  /** Directory names never descended into, added to the defaults rather than replacing them. */
  readonly skip?: readonly string[];
}

/**
 * One name a request binds.
 *
 * `imported` is the name under which the other module publishes it, which is
 * what a published surface is keyed by. A default import is `default`; a
 * namespace import binds no single name and so contributes no entry at all.
 */
export interface Bound {
  readonly imported: string;
  /** `import type { x }` and `import { type x }` alike. */
  readonly type: boolean;
  /** The 1-based line the statement binding it is written on. */
  readonly line: number;
}

/** One specifier a file writes, and what it takes from it. */
export interface Requested {
  /** As written. */
  readonly specifier: string;
  /** The 1-based line it is first written on. */
  readonly line: number;
  /**
   * The names it binds.
   *
   * Empty is a real answer with three causes — a side-effect import, a namespace
   * import, and a dynamic one — and all three mean the same thing here: the
   * package is used and no single name in it is.
   */
  readonly names: readonly Bound[];
}

/**
 * What one file's bytes said, however they were read.
 *
 * The join below needs four things per file and nothing else: which package owns
 * it, what it asked for, what it publishes, and whether the asking could be
 * enumerated at all. Stated as data rather than taken from a parser, so a caller
 * that already holds a cached reading of the repository can hand it over instead
 * of paying for a second walk ([`readUsage`](#readUsage) is the caller that has
 * no such cache).
 */
export interface Recorded {
  /** The file, relative to the workspace root. */
  readonly at: string;
  /** The package whose source it is — the nearest manifest above it. */
  readonly by: string;
  readonly requests: readonly Requested[];
  /**
   * The names it exports, in the order it writes them.
   *
   * Absent means nothing was read, which is how a caller that cannot answer the
   * question says so; a file that genuinely exports nothing is empty. Nothing
   * downstream distinguishes the two today, and the shape leaves room to.
   */
  readonly publishes?: readonly Exported[];
  /**
   * Why the imports could not be fully enumerated, when they could not.
   *
   * Partial rather than absent: a file can parse and still hold one specifier
   * nothing could read. Whatever `requests` does hold is still joined, and the
   * file is still named in `unreadable` so the under-reporting is visible.
   */
  readonly unknown?: string;
}

/** One name a file exports, before it is attributed to a package. */
export interface Exported {
  /** The name as the file publishes it. `default` for a default export. */
  readonly name: string;
  /** The 1-based line the export statement is written on. */
  readonly line: number;
  /** `export type { x }` and `export { type x }` alike. */
  readonly type: boolean;
}

/**
 * Join files against what the workspace opens.
 *
 * The whole of what `readUsage` does once it has the imports, and separate from
 * the reading for the reason `Recorded` exists: two callers arrive here holding
 * the same facts read two different ways, and only one of them had to walk.
 */
export function usageFrom(opened: ReadonlySet<string>, files: Iterable<Recorded>): Usage {
  const packages = new Set([...opened].map((key) => key.slice(0, key.indexOf(' '))));
  const names = new Map<string, Map<string, Use[]>>();
  const deep: Deep[] = [];
  const exported: Named[] = [];
  const unreadable: string[] = [];

  for (const file of files) {
    const { at, by } = file;
    // Named and still read. `unknown` covers a file that would not parse at all
    // and a file that parsed with one specifier this could not follow, and
    // rounding the second down to the first would drop every import the file
    // does write — which is the direction of error this whole reading avoids.
    if (file.unknown !== undefined) unreadable.push(at);

    const kind = kindOf(at);

    for (const published of file.publishes ?? []) {
      exported.push({ name: published.name, at, by, line: published.line, type: published.type, kind });
    }

    for (const asked of file.requests) {
      const key = requested(asked.specifier);
      if (!packages.has(key.slice(0, key.indexOf(' ')))) continue;

      if (!opened.has(key)) {
        deep.push({ specifier: asked.specifier, by, at, line: asked.line });
        continue;
      }

      const held = names.get(key) ?? new Map<string, Use[]>();
      names.set(key, held);
      for (const bound of asked.names) {
        const uses = held.get(bound.imported) ?? [];
        held.set(bound.imported, uses);
        uses.push({ by, at, line: bound.line, type: bound.type, kind });
      }
    }
  }

  return { names, deep, exported, unreadable };
}

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
 * the whole key says which of them came through a published door.
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

    for (const statement of source.parsed.module.staticImports) {
      const held = requestAt(statement.moduleRequest.value, statement.start);
      for (const entry of statement.entries) {
        const imported = nameOf(entry.importName.kind, entry.importName.name);
        if (imported !== undefined) held.names.push({ imported, type: entry.isType, line: held.line });
      }
    }

    const publishes: Exported[] = [];

    for (const statement of source.parsed.module.staticExports) {
      const line = lineAt(source.writing, statement.start);
      for (const entry of statement.entries) {
        // `export * from './x'` names nothing here: the set is whatever the
        // other file publishes, and inventing a name for it would claim one
        // this file never wrote.
        const exported = nameOf(entry.exportName.kind, entry.exportName.name);
        if (exported !== undefined) publishes.push({ name: exported, line, type: entry.isType });

        const specifier = entry.moduleRequest?.value;
        if (specifier === undefined) continue;
        const held = requestAt(specifier, statement.start);
        const imported = nameOf(entry.importName.kind, entry.importName.name);
        if (imported !== undefined) held.names.push({ imported, type: entry.isType, line: held.line });
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

  return usageFrom(opened, files);
}
