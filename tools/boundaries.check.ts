import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALL,
  AMBIENT,
  REQUIRED_WITHOUT_IMPORT,
  PACKAGES,
  ROOT,
  declared,
  type Workspace,
} from './workspaces.js';

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



describe('the boxes that require nothing', () => {
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
      // discovered by the consumer.
      //
      // The remedy is in the assertion rather than in this comment because the
      // two causes look identical in a report and only one of them is a defect.
      // These paths point into `dist/`, so an unbuilt checkout fails every row
      // at once — which reads as a repository that advertises entrypoints it
      // does not have, and sends the reader to edit a manifest that is correct.
      expect(missing, 'unbuilt, or the manifest is wrong: `yarn build` first').toEqual([]);
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
      .split('\n')
      .filter((file) => existsSync(join(ROOT, file))),
  )('%s contains no literal NUL', (file) => {
    const text = readFileSync(join(ROOT, file), 'utf8');

    // A `\u0000` escape is the same value and stays readable. `\0` is not the
    // fix: followed by a digit it is an octal escape.
    expect(text.includes(NUL)).toBe(false);
  });
});

/**
 * The packages whose name collides with a dependency's, and why each is right.
 *
 * A name may come from a requirement the manifest cannot state, from what the
 * thing is, or from a target it serves — never from a library it imports
 * ([ADR-0042](../docs/context/adr/0042-a-package-is-named-for-what-it-is-for.md)).
 * Only the third kind can collide, because the suite a package plugs into is
 * usually also the package that suite ships, so a collision has to be argued
 * rather than assumed.
 *
 * The sentence is the entry. One that could be written about the library instead
 * of the target is the one that is wrong, and it is the only thing standing
 * between this list and the exemption list it must never become.
 */
const SERVES: Record<string, string> = {
  '@variance-authority/playwright':
    'a Playwright suite, whose requirement is a browser binary an install does not fetch',
  '@variance-authority/playwright-test':
    'a run of the Playwright test runner, entered through its fixture protocol',
  '@variance-authority/png-sharp':
    "a runtime that can load a compiled native addon, on sharp's published platform matrix — " +
    'the vendor is the requirement here, which is what makes this the one exception',
};

/** `playwright-test` from `@playwright/test`, `sharp` from `sharp`. */
function shortName(specifier: string): string {
  return specifier.startsWith('@') ? specifier.split('/').slice(1).join('-') : specifier;
}

/** Every third-party dependency sharing a hyphen-separated word with the name. */
function vendorsInName(workspace: Workspace): string[] {
  const words = new Set(shortName(workspace.name).split('-'));
  const requirements = {
    ...workspace.manifest.dependencies,
    ...workspace.manifest.peerDependencies,
  };

  return Object.keys(requirements)
    .filter((dependency) => !dependency.startsWith('@variance-authority/'))
    .filter((dependency) => shortName(dependency).split('-').some((word) => words.has(word)));
}

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
    '%s is not named for a library it imports',
    (_name, workspace) => {
      // The rule above says the *requirement paragraph* may not name a
      // dependency. This says the same of the name over it, and they are not the
      // same rule: `packages/oxc` stated its requirement correctly — a readable
      // checkout — and was still named for its parser
      // ([ADR-0042](../docs/context/adr/0042-a-package-is-named-for-what-it-is-for.md)).
      // A collision is not automatically wrong — a package may be named for the
      // suite it plugs into, which is usually also the package that suite ships.
      // It is wrong until somebody writes down which of the two it is.
      expect(vendorsInName(workspace).length === 0 || workspace.name in SERVES).toBe(true);
    },
  );

  it('finds the collisions, so the list of arguments cannot describe nothing', () => {
    const colliding = PACKAGES.filter((workspace) => vendorsInName(workspace).length > 0).map(
      (workspace) => workspace.name,
    );

    // Equality in both directions on purpose. A missing entry is the rule not
    // being applied; a surviving entry for a package that no longer collides is
    // an argument nobody is making any more, and that is how an exemption list
    // starts.
    expect(colliding.sort()).toEqual(Object.keys(SERVES).sort());
  });

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
