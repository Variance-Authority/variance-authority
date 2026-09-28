/** Public declarations from the installed package a source file actually requests. */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { ResolverFactory } from 'oxc-resolver';
import type { DeclarationKind } from './declare.js';
import { createDependencyReader, namesReachedBy } from './reach.js';

const resolver = new ResolverFactory({ conditionNames: ['types', 'import', 'default'] });

export interface DependencyIdentity {
  readonly name: string;
  readonly version: string;
  readonly manifest: string;
}

export interface DependencyApiName {
  readonly name: string;
  readonly kind: DeclarationKind;
  readonly at: string;
  readonly line: number;
  readonly signature?: string;
  readonly doc?: string;
}

/** The public declaration reading of one specifier from one importer. */
export interface DependencyApi {
  /** The installed runtime package, as resolved from the importing file. */
  readonly runtime?: DependencyIdentity;
  /** The declaration provider can be an `@types` package at another version. */
  readonly declarations?: DependencyIdentity;
  readonly entrypoint?: string;
  readonly names?: readonly DependencyApiName[];
  /** Every declaration and manifest byte sequence this reading depends on. */
  readonly sources?: readonly { readonly at: string; readonly digest: string }[];
  /** Why an identity or public declaration surface could not be read. */
  readonly unavailable?: string;
}

function digest(file: string): string | undefined {
  try { return createHash('sha256').update(readFileSync(file)).digest('hex'); } catch { return undefined; }
}

function sources(root: string, files: Iterable<string>): readonly { at: string; digest: string }[] {
  return [...new Set(files)].sort().flatMap((file) => {
    const value = digest(file);
    return value === undefined ? [] : [{ at: relative(root, file), digest: value }];
  });
}

function identity(root: string, file: string | undefined): DependencyIdentity | undefined {
  if (file === undefined) return undefined;
  try {
    const read: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof read !== 'object' || read === null) return undefined;
    const manifest = read as Record<string, unknown>;
    if (typeof manifest['name'] !== 'string' || typeof manifest['version'] !== 'string') return undefined;
    return { name: manifest['name'], version: manifest['version'], manifest: relative(root, file) };
  } catch { return undefined; }
}

/**
 * Resolve from the importer, because two workspaces can install different
 * versions under the same written specifier. The runtime and declaration
 * resolutions are both the install's answers; neither is inferred from a root
 * manifest or the lockfile.
 */
export function readDependencyApi(root: string, importer: string, specifier: string, previous?: DependencyApi): DependencyApi {
  const from = resolve(root, importer);
  let runtimePath: string | undefined;
  let runtimeManifest: string | undefined;
  try {
    const resolved = resolver.sync(dirname(from), specifier);
    runtimePath = resolved.path;
    runtimeManifest = resolved.packageJsonPath;
  } catch { /* The declaration resolution can still name an @types provider. */ }
  const runtime = identity(root, runtimeManifest);

  let declarationPath: string | undefined;
  let declarationManifest: string | undefined;
  try {
    const resolved = resolver.resolveDtsSync(from, specifier);
    declarationPath = resolved.path;
    declarationManifest = resolved.packageJsonPath;
  } catch { /* Missing declarations are reported below. */ }
  const declarations = identity(root, declarationManifest);
  const sourceManifests = [runtimeManifest, declarationManifest].filter((file): file is string => file !== undefined);
  if (declarationPath === undefined) {
    return {
      ...(runtime === undefined ? {} : { runtime }),
      unavailable: runtimePath === undefined
        ? `the project resolver could not resolve \`${specifier}\` from ${importer}`
        : `the project resolver found no declarations for \`${specifier}\` from ${importer}`,
    };
  }

  const entrypoint = relative(root, declarationPath);
  if (previous?.entrypoint === entrypoint && isDeepStrictEqual(previous.runtime, runtime)
    && isDeepStrictEqual(previous.declarations, declarations) && previous.sources !== undefined
    && previous.sources.every((source) => digest(resolve(root, source.at)) === source.digest)) {
    return previous;
  }

  try {
    const reader = createDependencyReader(root);
    const names = [...namesReachedBy(reader, declarationPath)].flatMap(([name, kinds]) =>
      [...kinds].map(([kind, declaration]) => ({ name, kind, at: declaration.at, line: declaration.line,
        ...(declaration.signature === undefined ? {} : { signature: declaration.signature }),
        ...(declaration.doc === undefined ? {} : { doc: declaration.doc }) })));
    names.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 :
      left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : 0);
    return {
      ...(runtime === undefined ? {} : { runtime }),
      ...(declarations === undefined ? {} : { declarations }),
      entrypoint, names, sources: sources(root, [...sourceManifests, ...(reader.dependencyManifests ?? []), ...reader.parses.keys()]),
      ...(names.length > 0 ? {} : { unavailable: `the declarations for \`${specifier}\` publish no names this reader can enumerate` }),
    };
  } catch (error) {
    return {
      ...(runtime === undefined ? {} : { runtime }),
      ...(declarations === undefined ? {} : { declarations }),
      entrypoint,
      unavailable: `the declarations for \`${specifier}\` could not be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
