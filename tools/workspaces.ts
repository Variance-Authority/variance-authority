import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSync } from 'oxc-parser';

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
/**
 * The packages an adopter is told to import, one per way in (ADR-0024).
 *
 * A list rather than a discovered set, because being a surface is a *promise* —
 * that nobody has to look behind it — and a promise somebody makes is not a
 * property a directory scan can find. Adding a name here is the decision; the
 * check below is what stops it from quietly becoming false.
 */
export const SURFACES = [
  '@variance-authority/eyes',
  '@variance-authority/playwright-test',
  '@variance-authority/unit-test',
  '@variance-authority/storybook-collector',
  '@variance-authority/route-collector',
];

/**
 * What a surface additionally entitles a consumer to name.
 *
 * Not a reach-through. `core` holds the types a surface's own signatures are
 * written in — an adopter reading a verdict is already holding them — and `cli`
 * is the next step rather than a collaborator: the workflow the verdict feeds
 * into. Everything else a surface uses is its own business.
 */
export const NEXT_STEP = ['@variance-authority/core', '@variance-authority/cli'];

/**
 * What a surface may name because the adopter imports it somewhere else entirely.
 *
 * `event` is imported by the application, from the code a test is looking at, and
 * a surface cannot re-export its way out of that: the announcement has to reach
 * production without production depending on a test runner. So it is named
 * alongside a surface without being reached *through* one, and a README that
 * shows both halves is showing two sides of a boundary rather than two boxes an
 * adopter has to know to run a test.
 */
export const PRODUCT_SIDE = ['@variance-authority/event'];

export interface Workspace {
  readonly name: string;
  readonly dir: string;
  readonly manifest: Manifest;
  readonly imports: { readonly source: ReadonlySet<string>; readonly test: ReadonlySet<string> };
}

export interface Manifest {
  readonly name: string;
  readonly license?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly exports?: Readonly<Record<string, { readonly types?: string; readonly default?: string }>>;
  readonly bin?: Readonly<Record<string, string>>;
}

/**
 * Directories that hold what a build wrote, rather than what anybody imports.
 *
 * Only consulted where the scan is widened to a whole workspace — a case — and
 * it has to be, because `cases/incumbent-case` keeps a `dist/` of its own and
 * an installed tree lives under `node_modules/`. Reading either would attribute
 * a bundler's own requirements to the case that ran it.
 */
const OUTPUT = new Set(['node_modules', 'dist', 'coverage', 'storybook-static']);

export function sourceFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, out);
    // `.mjs` and `.cjs` too. A collector module is very often `.mjs` — the CLI
    // `import()`s it and an adopter reaches for the extension that says so — and
    // leaving them out meant the one file this repository holds up as *the* thing
    // an adopter writes was invisible to every import rule below.
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) out.push(path);
  }
  return out;
}

/**
 * The package a specifier names, ignoring the entrypoint.
 *
 * `@variance-authority/store/lfs` and `@variance-authority/store` are one
 * dependency. `node:fs/promises` is not a dependency at all — a host capability
 * rather than something anybody installs, and one the compiler already governs
 * through each package's `types` and `lib`. Neither is `/event.js`: a specifier
 * rooted at a slash is a URL a server answers, which names no package and would
 * otherwise be read as one called the empty string.
 */
export function packageOf(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return null;
  if (specifier.startsWith('node:')) return null;
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

/**
 * Import specifiers, and only import specifiers.
 *
 * Read from the module record `oxc` has already computed for the file — every
 * static import, every re-export, every literal `import()` — rather than from
 * the text. This tree holds fixtures whose template literals contain
 * `import x from 'y'` and rationales whose strings mention `from`; a string
 * that looks like a statement is not one, and only a parser knows the
 * difference.
 *
 * A parse error is thrown rather than rounded down to "no imports": a file this
 * rule cannot read is a file whose requirements it cannot vouch for.
 */
export function specifiersIn(file: string, text: string): readonly string[] {
  const { module: record, errors } = parseSync(file, text);
  if (errors.length > 0) throw new Error(`${file} could not be parsed: ${errors[0]!.message}`);

  const found: string[] = [];
  for (const entry of record.staticImports) found.push(entry.moduleRequest.value);
  for (const entry of record.staticExports) {
    for (const binding of entry.entries) {
      if (binding.moduleRequest !== null) found.push(binding.moduleRequest.value);
    }
  }
  for (const entry of record.dynamicImports) {
    // The record carries the span of the argument, not its value: an `import()`
    // of a variable names no package this rule can check.
    const literal = /^(['"])([^'"]+)\1$/.exec(text.slice(entry.moduleRequest.start, entry.moduleRequest.end));
    if (literal !== null) found.push(literal[2]!);
  }
  return found;
}

/**
 * Directories below a workspace that carry a `package.json` of their own.
 *
 * A file under one of these is not this workspace's code. `packages/package`
 * keeps a miniature workspace under `src/__fixtures__` — root manifest, members,
 * sources, cross-package imports — because the thing it reads *is* a workspace
 * and the only honest fixture for that is one. Nothing in there is compiled,
 * published or run: `export { measure } from 'alpha'` is a string its tests
 * expect the reader to classify, not an edge in this repository's graph.
 *
 * Deciding this by the presence of a manifest rather than by a directory name is
 * the same rule the reader itself follows. A `package.json` says whose code
 * something is, and declares its own dependencies — so rule 1 still applies to
 * that subtree, it is simply not ours to answer for.
 */
function nestedManifests(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(dir, entry.name);
    if (existsSync(join(path, 'package.json'))) out.push(path);
    else nestedManifests(path, out);
  }
  return out;
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

      // `src`, and `collector` — which is not a convention, it is a hole that was
      // open. A collector module is production code: the CLI `import()`s it by
      // the path a config names, at run time, in the adopter's process. Scanning
      // only `src` meant `cases/storybook-case/collector/` declared `playwright`,
      // `esbuild` and four workspace packages with **nothing checking any of
      // them** — the exact class of failure rule 1 exists to catch, in the one
      // directory this repository points at when asked what adoption costs.
      // And, for a case, every other directory it holds. A case is adopter code
      // by construction — the external runner's own config and specs, driven by
      // that runner's own binary — and it keeps them in directories named after
      // what they drive: `capture/`, `e2e/`, `page/`, `scripts/`. None of those
      // is `src`, so `cases/rstest-case` could declare `@rstest/playwright` and
      // `@variance-authority/playwright-test` with nothing checking either. A
      // package is not widened the same way: its non-`src` directories are build
      // scaffolding rather than the box, and the box is what rule 1 is about.
      const roots =
        group === 'cases'
          ? readdirSync(dir, { withFileTypes: true })
              .filter((entry) => entry.isDirectory() && !OUTPUT.has(entry.name) && !entry.name.startsWith('.'))
              .map((entry) => join(dir, entry.name))
          : [join(dir, 'src'), join(dir, 'collector')];
      const foreign = roots.flatMap((root) => nestedManifests(root));

      for (const file of roots.flatMap((root) => sourceFiles(root))) {
        // A fixture workspace answers for its own imports; see `nestedManifests`.
        if (foreign.some((nested) => file.startsWith(`${nested}/`))) continue;

        // `.spec.` and `.measure.` count as well as `.test.`, because the weaker
        // rule is about *when* code runs and not about which runner runs it or
        // which question it asks. A case driving a competitor's assertion
        // library does so from a file that competitor's runner collects, and
        // holding it to the production rule would put a second test runner in a
        // workspace's `dependencies`; a measurement builds its own worlds with
        // `jsdom` for the same reason a test does, and ships to nobody.
        //
        // A case's widened directories count as development whatever they are
        // named. `e2e/rstest.config.mjs` and `scripts/build.mjs` are not test
        // files by any pattern, and they are not production either: nothing
        // imports them but the external runner this case drives, during this
        // case. `collector/` is the exception that stays production, because
        // the CLI `import()`s one in an adopter's own process.
        const isTest =
          /\.(test|spec|measure)\.(ts|tsx|js|jsx)$/.test(file) ||
          file.includes('__fixtures__') ||
          (group === 'cases' &&
            !file.startsWith(`${join(dir, 'src')}/`) &&
            !file.startsWith(`${join(dir, 'collector')}/`));
        for (const specifier of specifiersIn(file, readFileSync(file, 'utf8'))) {
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

/**
 * Everything a package may reach for at build time, and everything at test time.
 *
 * A peer counts as declared, and it is the *stronger* declaration rather than a
 * loophole. Rule 1 exists because an undeclared import resolves in a workspace
 * and fails when somebody installs the package alone; a peer does not fail that
 * way — an installer resolves it, and warns rather than shrugging when it cannot.
 * It is also the only correct declaration for a runtime the consumer must not end
 * up with two copies of, which is exactly the case for a JSX runtime.
 */
export function declared(workspace: Workspace): { production: Set<string>; any: Set<string> } {
  const production = new Set([
    ...Object.keys(workspace.manifest.dependencies ?? {}),
    ...Object.keys(workspace.manifest.peerDependencies ?? {}),
  ]);
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
  '@variance-authority/case-playwright-storybook': ['react-dom'],
  '@variance-authority/case-storybook': ['react-dom'],
};
