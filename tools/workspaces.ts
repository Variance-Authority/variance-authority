import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The workspace graph, read from disk once.
 *
 * Shared by every rule that has an opinion about package shape. Extracted when
 * `boundaries.test.ts` passed 600 lines and became a file its own size rule
 * would have failed — the enumeration is the half of it that nothing else was
 * asserting on, so it left.
 */

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Third-party requirements: what a consumer installs, as opposed to node's own. */
export const OWNED_BY_ONE = ['playwright', 'pixelmatch', 'pngjs', 'react', 'react-dom', 'jsdom', 'sharp'];

export interface Workspace {
  readonly name: string;
  readonly dir: string;
  readonly manifest: Manifest;
  readonly imports: { readonly source: ReadonlySet<string>; readonly test: ReadonlySet<string> };
}

export interface Manifest {
  readonly name: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly exports?: Readonly<Record<string, { readonly types?: string; readonly default?: string }>>;
  readonly bin?: Readonly<Record<string, string>>;
}

export function sourceFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) out.push(path);
  }
  return out;
}

/**
 * The package a specifier names, ignoring the entrypoint.
 *
 * `@variance-authority/store/lfs` and `@variance-authority/store` are one
 * dependency. `node:fs/promises` is not a dependency at all — a host capability
 * rather than something anybody installs, and one the compiler already governs
 * through each package's `types` and `lib`.
 */
export function packageOf(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('node:')) return null;
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

/**
 * Import specifiers, and only import specifiers.
 *
 * Comments go first, because this repository's comments talk about packages by
 * name constantly and a checker that reads prose reports imports nobody wrote.
 * What is left is matched at line starts: a statement cannot cross a `;`, so an
 * `export const` cannot reach a `from` several lines below it.
 */
const PATTERNS = [
  /^[ \t]*(?:import|export)\b[^;]*?\bfrom[ \t]*['"]([^'"]+)['"]/gm,
  /^[ \t]*import[ \t]*['"]([^'"]+)['"]/gm,
  /\bimport\([ \t]*['"]([^'"]+)['"][ \t]*\)/g,
];

export function specifiersIn(text: string): readonly string[] {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  return PATTERNS.flatMap((pattern) => [...code.matchAll(pattern)].map((match) => match[1]!));
}

export function workspaces(): readonly Workspace[] {
  const found: Workspace[] = [];
  for (const group of ['packages', 'examples', 'cases']) {
    const groupDir = join(ROOT, group);
    if (!existsSync(groupDir)) continue;
    for (const name of readdirSync(groupDir)) {
      const dir = join(groupDir, name);
      const manifestPath = join(dir, 'package.json');
      if (!statSync(dir).isDirectory() || !existsSync(manifestPath)) continue;

      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
      const source = new Set<string>();
      const test = new Set<string>();

      for (const file of sourceFiles(join(dir, 'src'))) {
        // `.spec.` counts as well as `.test.`, because the weaker rule is about
        // *when* code runs and not about which runner runs it. A case driving a
        // competitor's assertion library does so from a file that competitor's
        // runner collects, and holding it to the production rule would put a
        // second test runner in a workspace's `dependencies`.
        const isTest = /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(file) || file.includes('__fixtures__');
        for (const specifier of specifiersIn(readFileSync(file, 'utf8'))) {
          const owner = packageOf(specifier);
          if (owner === null || owner === manifest.name) continue;
          (isTest ? test : source).add(owner);
        }
      }
      found.push({ name: manifest.name, dir, manifest, imports: { source, test } });
    }
  }
  return found;
}

export const ALL = workspaces();
export const PACKAGES = ALL.filter((workspace) => workspace.dir.includes(`${ROOT}/packages/`));

/** Everything a package may reach for at build time, and everything at test time. */
export function declared(workspace: Workspace): { production: Set<string>; any: Set<string> } {
  const production = new Set(Object.keys(workspace.manifest.dependencies ?? {}));
  const any = new Set([...production, ...Object.keys(workspace.manifest.devDependencies ?? {})]);
  return { production, any };
}

/**
 * Devtools and type-only packages the root provides for every workspace.
 *
 * Listed rather than inferred, so adding one is a decision somebody made rather
 * than a hole that opened.
 */
export const AMBIENT = new Set(['vitest', '@types/node', '@types/react', '@types/react-dom', 'typescript']);

/**
 * Declared-but-never-imported, on purpose, with the reason attached.
 *
 * A build tool can require a package nothing in the source names — a renderer a
 * bundler reaches for, a peer a framework resolves. Those are real requirements
 * and must stay declared. Writing them down here rather than exempting a whole
 * category keeps the escape hatch the size of the actual exception.
 */
export const REQUIRED_WITHOUT_IMPORT: Readonly<Record<string, readonly string[]>> = {
  // Storybook's React renderer resolves this itself; no story file imports it.
  '@variance-authority/case-storybook': ['react-dom'],
};
