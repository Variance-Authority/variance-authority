import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSync } from 'oxc-parser';
import { describe, expect, it } from 'vitest';

/**
 * The platform matrix is one decision, held in four places.
 *
 * A prebuilt addon reaches a consumer through an arrangement nothing verifies at
 * install time: the loader names a package, the manifest lists it as an optional
 * dependency, a directory under `npm/` carries its manifest, and that manifest's
 * `os`, `cpu` and `libc` decide whether a package manager unpacks it. Every one
 * of those can be edited alone, and three of the four failures are silent —
 * an optional dependency that is not installed is not an error, a binary that is
 * not resolved is caught by the loader, and the scan simply runs in TypeScript
 * at a fraction of the speed somebody was promised.
 *
 * The loader's table is read out of its source rather than imported from
 * `dist/`, so this answers on a checkout that has not been built and so that
 * nothing here reaches into another package by relative path.
 *
 * That is the whole reason this file exists. The acceleration failing open is
 * what makes a three-platform matrix safe to ship (ADR-0065) and is also what
 * makes a broken one invisible, so the arrangement is asserted here rather than
 * discovered in a benchmark six weeks later.
 *
 * What it does not assert is that a binary is present. Nothing builds one on a
 * machine without `cargo`, and `release.yml` is where a publish is held to
 * having all three.
 */

/**
 * The scope and stem every platform package's name is built from.
 *
 * Spelled once rather than inline, because the inline form is the published
 * name with a trailing hyphen — a package that does not exist, which
 * `docs-claims.check.ts` is right to say so about.
 */
const STEM = '@variance-authority/sense';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SENSE = join(ROOT, 'packages/sense');
const NPM = join(SENSE, 'npm');

interface PlatformManifest {
  readonly name: string;
  readonly version: string;
  readonly main?: string;
  readonly files?: readonly string[];
  readonly os?: readonly string[];
  readonly cpu?: readonly string[];
  readonly libc?: readonly string[];
  readonly license?: string;
  readonly scripts?: Readonly<Record<string, string>>;
}

function manifest<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

const sense = manifest<{
  readonly version: string;
  readonly license: string;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly files: readonly string[];
}>(join(SENSE, 'package.json'));

/**
 * A named top-level object literal of string values, read from a file's AST.
 *
 * A regular expression over TypeScript is how a check starts agreeing with a
 * file it is not reading; the parser this repository already depends on is
 * cheaper than the first edge case.
 */
function tableIn(path: string, name: string): Record<string, string> {
  const { program } = parseSync(path, readFileSync(path, 'utf8'));
  for (const statement of program.body) {
    const declaration =
      statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
    if (declaration?.type !== 'VariableDeclaration') continue;
    for (const declarator of declaration.declarations) {
      if (declarator.id.type !== 'Identifier' || declarator.id.name !== name) continue;
      if (declarator.init?.type !== 'ObjectExpression') break;

      return valued(declarator.init);
    }
  }
  throw new Error(`${path} declares no \`${name}\` object`);
}

function valued(node: { properties: readonly unknown[] }): Record<string, string> {
  const table: Record<string, string> = {};
  for (const property of node.properties as readonly {
    type: string;
    key: { type: string; value?: unknown; name?: string };
    value: { type: string; value?: unknown };
  }[]) {
    if (property.type !== 'Property' || property.value.type !== 'Literal') continue;
    const key =
      property.key.type === 'Identifier' ? property.key.name : String(property.key.value);
    if (key === undefined) continue;
    table[key] = String(property.value.value);
  }

  return table;
}

const PLATFORMS = tableIn(join(SENSE, 'src/addon.ts'), 'PLATFORMS');

const directories = readdirSync(NPM).sort();

describe('the platform packages', () => {
  it('is the set the loader names, in both directions', () => {
    expect(directories.map((name) => `${STEM}-${name}`)).toEqual(
      Object.values(PLATFORMS).sort(),
    );
  });

  /**
   * Asked of the platform packages among the optional dependencies, not of the
   * whole list.
   *
   * `optionalDependencies` holds two different arrangements that happen to share
   * a manifest key. The platform packages are one decision spread over four
   * places and are what this file exists to hold together. The tree-sitter
   * grammars are the other: a grammar that is not installed makes its language
   * *unreadable* rather than edgeless, which
   * [`grammar.ts`](../packages/sense/src/grammar.ts) reports as `unknown` and
   * every consumer widens on (ADR-0066). That is a supported state, so a
   * grammar belongs here — and a rule that read the key as a whole would refuse
   * every language added after the first.
   */
  it('is what the manifest declares optional', () => {
    const optional = sense.optionalDependencies ?? {};
    const platforms = Object.values(PLATFORMS);

    expect(Object.keys(optional).filter((name) => name.startsWith(`${STEM}-`)).sort()).toEqual(
      [...platforms].sort(),
    );
    expect(platforms.map((name) => optional[name])).toEqual(platforms.map(() => 'workspace:*'));
  });

  it('is keyed by the platform that loads it', () => {
    for (const [key, name] of Object.entries(PLATFORMS)) {
      const directory = name.slice(`${STEM}-`.length);
      expect(directory.startsWith(key), `${name} is loaded on ${key}`).toBe(true);
    }
  });

  describe.each(directories)('%s', (directory) => {
    const platform = manifest<PlatformManifest>(join(NPM, directory, 'package.json'));
    const [os, cpu] = directory.split('-');

    it('names the directory it sits in', () => {
      expect(platform.name).toBe(`${STEM}-${directory}`);
    });

    it('declares the platform its bytes were built for', () => {
      expect(platform.os).toEqual([os]);
      expect(platform.cpu).toEqual([cpu]);
      // Only Linux has two of them, and only there does a package manager need
      // telling: a glibc binary unpacked onto musl loads into an error.
      expect(platform.libc).toEqual(directory.endsWith('-gnu') ? ['glibc'] : undefined);
    });

    it('publishes its binary and nothing else', () => {
      expect(platform.main).toBe('scan.node');
      expect(platform.files).toEqual(['scan.node']);
    });

    it('refuses to pack without a usable binary', () => {
      expect(platform.scripts?.prepack).toBe('node ../../scripts/verify-native-pack.mjs');
    });

    it('moves with the package that loads it', () => {
      expect(platform.version).toBe(sense.version);
      expect(platform.license).toBe(sense.license);
    });

    it('is documented where npm will show it', () => {
      expect(existsSync(join(NPM, directory, 'README.md'))).toBe(true);
    });
  });
});

describe('the package that loads them', () => {
  it('ships no addon of its own', () => {
    // `dist/native/` is where a build for an unpublished platform lands, which
    // is this checkout's business and not a consumer's.
    expect(sense.files).toContain('!dist/native');
  });
});
