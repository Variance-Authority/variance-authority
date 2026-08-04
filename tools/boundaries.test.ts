import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The layout rule, enforced rather than described.
 *
 * **The first cut between packages is what a consumer must supply, not what the
 * code does.** A browser, a React runtime, a PNG codec, a filesystem, a socket, a
 * database — each is a box, and code that needs one may not sit in a box with
 * code that needs another. A team extending their own Playwright tests should not
 * install a second browser to compare two images; a team keeping baselines
 * somewhere this project has never heard of should not install a codec to do it.
 *
 * Prose in an architecture document does not survive a hurried afternoon. What
 * survives is a red test, so the rule is checked here against the imports that
 * actually exist:
 *
 * 1. every import is declared, and every declaration is imported
 * 2. a third-party runtime requirement has exactly one owner
 * 3. the production graph is acyclic
 * 4. every entrypoint a package advertises resolves to something built
 * 5. every package has a README that states its requirement and its entrypoints
 *
 * Rule 1 is what rots first and rots invisibly: a package that imports what it
 * does not declare works fine in the workspace, where a hoisted `node_modules`
 * hands it over anyway, and fails the moment somebody installs it alone.
 *
 * Test files are held to a weaker version of rule 1 on purpose. A test may reach
 * for a real backend across a boundary its source may not cross — that is what
 * `devDependencies` are for — and holding tests to the production rule would push
 * suites towards mocks, which is a worse trade than the one being avoided.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Third-party requirements: what a consumer installs, as opposed to node's own. */
const OWNED_BY_ONE = ['playwright', 'pixelmatch', 'pngjs', 'react', 'react-dom', 'jsdom', 'sharp'];

interface Workspace {
  readonly name: string;
  readonly dir: string;
  readonly manifest: Manifest;
  readonly imports: { readonly source: ReadonlySet<string>; readonly test: ReadonlySet<string> };
}

interface Manifest {
  readonly name: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly exports?: Readonly<Record<string, { readonly types?: string; readonly default?: string }>>;
  readonly bin?: Readonly<Record<string, string>>;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
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
function packageOf(specifier: string): string | null {
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

function specifiersIn(text: string): readonly string[] {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  return PATTERNS.flatMap((pattern) => [...code.matchAll(pattern)].map((match) => match[1]!));
}

function workspaces(): readonly Workspace[] {
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

const ALL = workspaces();
const PACKAGES = ALL.filter((workspace) => workspace.dir.includes(`${ROOT}/packages/`));

/** Everything a package may reach for at build time, and everything at test time. */
function declared(workspace: Workspace): { production: Set<string>; any: Set<string> } {
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
const AMBIENT = new Set(['vitest', '@types/node', '@types/react', '@types/react-dom', 'typescript']);

/**
 * Declared-but-never-imported, on purpose, with the reason attached.
 *
 * A build tool can require a package nothing in the source names — a renderer a
 * bundler reaches for, a peer a framework resolves. Those are real requirements
 * and must stay declared. Writing them down here rather than exempting a whole
 * category keeps the escape hatch the size of the actual exception.
 */
const REQUIRED_WITHOUT_IMPORT: Readonly<Record<string, readonly string[]>> = {
  // Storybook's React renderer resolves this itself; no story file imports it.
  '@variance-authority/case-storybook': ['react-dom'],
};

describe('a package declares what it imports', () => {
  it.each(ALL.map((workspace) => [workspace.name, workspace] as const))(
    '%s imports nothing its manifest does not list',
    (_name, workspace) => {
      const { production } = declared(workspace);
      const undeclared = [...workspace.imports.source].filter(
        (dependency) => !production.has(dependency) && !AMBIENT.has(dependency),
      );

      // Not a tidiness complaint. In a workspace an undeclared import resolves
      // anyway — the hoisted tree hands it over — and the failure arrives when
      // somebody installs the package on its own.
      expect(undeclared).toEqual([]);
    },
  );

  it.each(ALL.map((workspace) => [workspace.name, workspace] as const))(
    '%s tests import nothing the manifest does not list',
    (_name, workspace) => {
      const { any } = declared(workspace);
      const undeclared = [...workspace.imports.test].filter(
        (dependency) => !any.has(dependency) && !AMBIENT.has(dependency),
      );

      expect(undeclared).toEqual([]);
    },
  );

  it.each(ALL.map((workspace) => [workspace.name, workspace] as const))(
    '%s lists nothing it does not import',
    (_name, workspace) => {
      const used = new Set([...workspace.imports.source, ...workspace.imports.test]);
      const excused = new Set(REQUIRED_WITHOUT_IMPORT[workspace.name] ?? []);
      const unused = Object.keys(workspace.manifest.dependencies ?? {}).filter(
        (dependency) => !used.has(dependency) && !excused.has(dependency),
      );

      // A stale declaration is the same failure read backwards: it says this
      // package requires something, and a reader deciding what a box costs them
      // believes it.
      expect(unused).toEqual([]);
    },
  );
});

describe('a requirement has one owner', () => {
  it.each(OWNED_BY_ONE)('%s is a production dependency of at most one package', (dependency) => {
    const owners = PACKAGES.filter((workspace) =>
      Object.keys(workspace.manifest.dependencies ?? {}).includes(dependency),
    ).map((workspace) => workspace.name);

    // The rule, stated as a number. Two owners means a consumer who wants one
    // of them installs both, which is the thing the layout exists to prevent.
    expect(owners.length).toBeLessThanOrEqual(1);
  });

  it('keeps the packages that require nothing requiring nothing', () => {
    // `core` and `raster` are the two boxes whose whole value is being free. If
    // either ever grows a dependency, every argument about cheap tiers and
    // extensible pipelines quietly stops being true.
    for (const name of ['@variance-authority/core', '@variance-authority/raster']) {
      const workspace = PACKAGES.find((candidate) => candidate.name === name);
      expect(workspace, `${name} is missing`).toBeDefined();

      const external = Object.keys(workspace!.manifest.dependencies ?? {}).filter(
        (dependency) => !dependency.startsWith('@variance-authority/'),
      );
      expect({ [name]: external }).toEqual({ [name]: [] });
    }
  });
});

describe('the production graph', () => {
  it('has no cycles', () => {
    const edges = new Map(
      ALL.map((workspace) => [
        workspace.name,
        Object.keys(workspace.manifest.dependencies ?? {}).filter((dependency) =>
          dependency.startsWith('@variance-authority/'),
        ),
      ]),
    );

    const state = new Map<string, 'visiting' | 'done'>();
    const cycles: string[] = [];

    const visit = (name: string, path: readonly string[]): void => {
      if (state.get(name) === 'done') return;
      if (state.get(name) === 'visiting') {
        cycles.push([...path.slice(path.indexOf(name)), name].join(' → '));
        return;
      }
      state.set(name, 'visiting');
      for (const next of edges.get(name) ?? []) visit(next, [...path, name]);
      state.set(name, 'done');
    };
    for (const name of edges.keys()) visit(name, []);

    expect(cycles).toEqual([]);
  });
});

describe('every advertised entrypoint exists', () => {
  it.each(PACKAGES.map((workspace) => [workspace.name, workspace] as const))(
    '%s resolves each of its exports',
    (_name, workspace) => {
      const missing: string[] = [];
      for (const [entry, target] of Object.entries(workspace.manifest.exports ?? {})) {
        for (const path of [target.types, target.default]) {
          if (path !== undefined && !existsSync(join(workspace.dir, path))) {
            missing.push(`${entry} → ${path}`);
          }
        }
      }
      for (const path of Object.values(workspace.manifest.bin ?? {})) {
        if (!existsSync(join(workspace.dir, path))) missing.push(`bin → ${path}`);
      }

      // An entrypoint is a promise to a consumer, and a promise nobody checks is
      // discovered by the consumer. Requires a build first, which is how the
      // suite is run.
      expect(missing).toEqual([]);
    },
  );
});

/** The `**Requires:` paragraph, which is everything before the second blank line. */
function requirement(workspace: Workspace): string {
  const text = readFileSync(join(workspace.dir, 'README.md'), 'utf8');
  const start = text.indexOf('**Requires:');
  if (start === -1) return '';

  const end = text.indexOf('\n\n', start);
  return end === -1 ? text.slice(start) : text.slice(start, end);
}

/**
 * A source file stays text, so the tools that read it keep reading it.
 *
 * Seven files here carried a literal NUL byte — a key separator, written as the
 * byte rather than as an escape. Semantically identical, and it costs the one
 * thing this repository cannot afford: `grep` classifies those files as binary
 * and prints **nothing** for a pattern that is present, `file` calls them `data`,
 * and `git diff` showed four of them as "Binary files differ", so a change to
 * them was invisible in review. Every one of those is a search that returns
 * nothing looking exactly like a search that found nothing — which is the failure
 * this whole project is built to refuse, arriving in the codebase itself.
 *
 * It cost real time: a search for `scopeKey` in the file that defines it came
 * back empty, twice, during the work that found this.
 */
describe('source stays greppable', () => {
  const NUL = String.fromCharCode(0);

  it.each(
    execFileSync('git', ['ls-files', '*.ts', '*.tsx', '*.js', '*.jsx', '*.mjs', '*.cjs'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
      .trim()
      .split('\n'),
  )('%s contains no literal NUL', (file) => {
    const text = readFileSync(join(ROOT, file), 'utf8');

    // A `\u0000` escape is the same value and stays readable. `\0` is not the
    // fix: followed by a digit it is an octal escape.
    expect(text.includes(NUL)).toBe(false);
  });
});

describe('every package says what it is', () => {
  it.each(ALL.map((workspace) => [workspace.name, workspace] as const))(
    '%s has a README',
    (_name, workspace) => {
      const path = join(workspace.dir, 'README.md');
      expect(existsSync(path), `${workspace.dir}/README.md is missing`).toBe(true);
    },
  );

  it.each(PACKAGES.map((workspace) => [workspace.name, workspace] as const))(
    '%s states its requirement before anything else',
    (_name, workspace) => {
      // "**Requires:" is the sentence the layout rule turns on. A README that
      // does not answer *what must be true before this works* is a README
      // describing features, which is the shape the boundary argues against.
      // Examples and cases are exempt: nobody installs them.
      expect(requirement(workspace), `${workspace.name} states no requirement`).not.toBe('');
    },
  );

  it.each(PACKAGES.map((workspace) => [workspace.name, workspace] as const))(
    '%s does not restate its manifest in prose',
    (_name, workspace) => {
      // The requirement is what `package.json` **cannot** say: a browser binary
      // an install does not fetch, a directory this process can write, a service
      // already running, a tree `react-dom` has rendered. Naming a dependency
      // here instead duplicates a fact that is machine-readable and already
      // checked above — and a prose copy of an enforced fact only ever drifts
      // away from it.
      const declared = Object.keys(workspace.manifest.dependencies ?? {}).filter(
        (dependency) => !dependency.startsWith('@variance-authority/'),
      );
      const restated = declared.filter((dependency) =>
        new RegExp(`\\b${dependency.replace(/[/-]/g, '.')}\\b`).test(requirement(workspace)),
      );

      expect(restated).toEqual([]);
    },
  );

  it.each(PACKAGES.map((workspace) => [workspace.name, workspace] as const))(
    '%s documents every entrypoint it advertises',
    (_name, workspace) => {
      const entries = Object.keys(workspace.manifest.exports ?? {}).filter((entry) => entry !== '.');
      if (entries.length === 0) return;

      const text = readFileSync(join(workspace.dir, 'README.md'), 'utf8');
      const undocumented = entries.filter(
        (entry) => !text.includes(`/${entry.replace(/^\.\//, '')}`),
      );

      // An entrypoint is a promise, and an undocumented one is a promise made to
      // nobody: a consumer reaches for the default and installs the requirement
      // the split existed to spare them.
      expect(undocumented).toEqual([]);
    },
  );
});

/**
 * The one table a reader picks a package out of has to use the package's name.
 *
 * ADR-0023 renamed the review service from `cloudflare` to `tribunal` and argued
 * the case in the ADR's own title: a service is named for what it is, not for the
 * host it happens to run on. The rename reached the manifest, the entrypoints and
 * every exported symbol — and did not reach the root README, whose package table
 * went on labelling the row `cloudflare` while linking to `packages/tribunal`.
 *
 * Nothing caught it. The rules above check that a README *states* a requirement
 * and documents its entrypoints; the documentation gate checks that the link
 * *resolves*, and `packages/tribunal` resolves fine. A label is the one part of
 * the row nothing read, so it drifted in the one direction that matters — the
 * name a reader would type.
 */
describe('the root README calls every package by its name', () => {
  const README = readFileSync(join(ROOT, 'README.md'), 'utf8');

  it('finds package rows to check, so a reformatted table cannot empty this rule', () => {
    expect([...README.matchAll(/\[`([^`]+)`\]\(packages\/([\w-]+)\)/g)].length).toBeGreaterThan(10);
  });

  it('labels each row with the manifest name', () => {
    const wrong: string[] = [];

    for (const [, label, dir] of README.matchAll(/\[`([^`]+)`\]\(packages\/([\w-]+)\)/g)) {
      const manifest = join(ROOT, 'packages', dir!, 'package.json');
      if (!existsSync(manifest)) {
        wrong.push(`packages/${dir} does not exist`);
        continue;
      }

      // Either spelling is a name. The table writes the bare segment for
      // density and the prose writes the specifier a consumer would install;
      // both are the package calling itself what it is, and only a third
      // spelling is the drift this exists to catch.
      const name = (JSON.parse(readFileSync(manifest, 'utf8')) as Manifest).name;
      if (label !== name && label !== name.split('/').pop()) {
        wrong.push(`packages/${dir} is labelled \`${label}\`, not \`${name}\``);
      }
    }

    expect(wrong).toEqual([]);
  });
});

/**
 * A pinned browser image is a declared requirement, and it must match the
 * dependency it will be running.
 *
 * Three files pin `mcr.microsoft.com/playwright:<tag>` — the Linux verification
 * image, the example workflow, and the Bitbucket recipe in the CLI README — and
 * every one of them was pinned to `v1.49.0` while the lockfile resolved
 * `playwright` to 1.62.1. The tag is what decides which browser build is baked
 * into `/ms-playwright`; the resolved package is what decides which build
 * `chromium.executablePath()` goes looking for. When they disagree the path does
 * not exist.
 *
 * **And nothing goes red.** The browser suites are gated on
 * `existsSync(executablePath())`, so a mismatched image *skips all ten of them*
 * and reports a green run — which for the Linux harness means it would have
 * confirmed portability without executing a single cross-platform measurement.
 * That is the failure this repository exists to refuse, and it was sitting in the
 * harness the same day it was repaired for a different one.
 *
 * The version is read from the lockfile rather than from `package.json`, because
 * `^1.49.0` is the range and the resolution is what gets installed.
 */
describe('a pinned browser image matches the playwright it runs', () => {
  const resolved = /^"playwright@npm:[^"]*":\n  version: (\S+)$/m.exec(
    readFileSync(join(ROOT, 'yarn.lock'), 'utf8'),
  )?.[1];

  const pins = execFileSync('git', ['grep', '-n', 'mcr.microsoft.com/playwright:'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    // This file names the registry to find the pins, and is not one.
    .filter((line) => !line.startsWith('tools/'));

  it('reads a resolved playwright version out of the lockfile', () => {
    expect(resolved).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('finds the pins, so a moved file cannot empty this rule', () => {
    expect(pins.length).toBeGreaterThan(0);
  });

  it.each(pins)('%s', (line) => {
    const tag = /mcr\.microsoft\.com\/playwright:v([\d.]+)-/.exec(line)?.[1];

    expect(tag, `${line} pins no \`vX.Y.Z-\` tag`).toBeDefined();
    expect(tag, 'the image ships a browser build this playwright will not look for').toBe(resolved);
  });
});
