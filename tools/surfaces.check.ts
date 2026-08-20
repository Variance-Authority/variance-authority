import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NEXT_STEP, PACKAGES, ROOT, SURFACES, type Manifest } from './workspaces.js';

/**
 * What an adopter is told to import, and what that promise costs to keep.
 *
 * Split out of `boundaries.check.ts`, which enforces the package graph on its
 * own terms — who declares what, what resolves, what a box is named for. This
 * file asks the reader's question instead: how many boxes does somebody have to
 * know to use this, and does the page that sends them there still point at a
 * real recipe.
 */


/**
 * The Law of Demeter, applied to the package graph (ADR-0024).
 *
 * This replaced "a third-party requirement has at most one owner", which held for
 * fourteen packages and then stopped answering the question anybody had. When two
 * adoption surfaces landed, the only thing that had changed was **how many boxes
 * an adopter has to know** — and the old rule was green before and after, because
 * neither surface declares `playwright`. It could not see the improvement it was
 * supposed to be protecting: a collector that imported five variance packages
 * became one that imports one.
 *
 * What is checked is the two kinds of adopter-facing code this repository holds.
 * A README example is the thing somebody copies; a `collector/` directory is
 * adopter code by definition, since the CLI imports it by a path a config names.
 */
function variancePackagesIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(/from\s+['"](@variance-authority\/[\w-]+)/g)) {
    found.add(match[1]!);
  }
  return found;
}

/** Every fenced example in a README, whatever language it claims. */
function fencedCode(text: string): string {
  return [...text.matchAll(/^```[\w-]*\n([\s\S]*?)^```/gm)].map((match) => match[1] ?? '').join('\n');
}

/**
 * Adopter-facing files that still name a box behind a surface, and why.
 *
 * A budget rather than a suppression, on the same terms as `EXERCISE_DEBT`: a
 * file absent from here is held to the rule outright, and a file in here may only
 * ever lose entries.
 *
 * One entry, and it records a gap rather than an excuse. The CLI's collector path
 * has four surfaces — Playwright Test, unit captures, Storybook, routes — and
 * none of them is *fixtures you render yourself*. `examples/agent-claim` is the
 * first example to take that path, and it renders both revisions of its own
 * design system in one browser, which is what ephemeral retention requires and
 * what no surface here offers. It reaches `@variance-authority/playwright` for
 * the harness, and the honest fix is a surface that pairs a harness with a page
 * agent, not a re-export bolted onto a box named for a test runner the example
 * does not use.
 *
 * Delete the entry when that surface exists, or when the example moves onto one.
 */
const REACH_THROUGH_DEBT: Readonly<Record<string, readonly string[]>> = {
  'examples/agent-claim/collector/index.mjs': ['@variance-authority/playwright'],
};

describe('adopter-facing code knows one package', () => {
  // The surfaces *and* the next-step packages. `cli` is not a reach-through for
  // an adopter to import, and its own README example is still something somebody
  // copies — so the example is held to the rule even though the package is on the
  // allowed side of it.
  const facing: (readonly [string, string])[] = [
    ...[...SURFACES, ...NEXT_STEP].map((surface) => {
      const workspace = PACKAGES.find((candidate) => candidate.name === surface);
      const path = workspace === undefined ? '' : join(workspace.dir, 'README.md');
      return [`${surface} README`, path === '' || !existsSync(path) ? '' : fencedCode(readFileSync(path, 'utf8'))] as const;
    }),
    ...execFileSync('git', ['ls-files', '*/collector/*', 'collector/*'], { cwd: ROOT, encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter((file) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file))
      .map((file) => [file, readFileSync(join(ROOT, file), 'utf8')] as const),
  ];

  it('finds adopter-facing code to check, so this cannot pass by reading nothing', () => {
    expect(facing.length).toBeGreaterThan(1);
    expect(facing.every(([, text]) => text !== '')).toBe(true);
  });

  it('carries no debt for a file that has stopped reaching through', () => {
    // The half that makes it a budget. Without it the entry outlives the reason
    // for it, and the rule quietly stops applying to a file nobody is thinking
    // about any more.
    const stale = Object.entries(REACH_THROUGH_DEBT)
      .filter(([file, allowed]) => {
        const entry = facing.find(([where]) => where === file);
        if (entry === undefined) return true;
        const named = variancePackagesIn(entry[1]);
        return !allowed.every((name) => named.has(name));
      })
      .map(([file]) => file);

    expect(stale).toEqual([]);
  });

  it.each(facing)('%s names at most one surface, and no collaborator', (where, text) => {
    const allowed = REACH_THROUGH_DEBT[where] ?? [];
    const named = [...variancePackagesIn(text)].filter(
      (name) => !NEXT_STEP.includes(name) && !allowed.includes(name),
    );
    const reachThrough = named.filter((name) => !SURFACES.includes(name));

    // A surface that leaves an adopter importing `playwright`, `dom` or
    // `storybook` has not finished being a surface. The fix is a re-export, not
    // an exception here.
    expect({ reachThrough, surfaces: named.length }).toEqual({
      reachThrough: [],
      surfaces: named.length > 1 ? 1 : named.length,
    });
  });
});
/**
 * The root README is a consumer decision page, not a workspace inventory.
 * Every adoption path it recommends must point to a concrete integration
 * recipe and call that package by the name a reader can install.
 */
describe('the root README names every supported adoption path', () => {
  const README = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const links = [
    ...README.matchAll(/\[`([^`]+)`[^\]]*\]\(packages\/([\w-]+)\/README\.md#[^)]+\)/g),
  ];

  it('links each supported path to its integration recipe', () => {
    expect(links.map(([, label]) => label)).toEqual([
      '@variance-authority/playwright-test',
      '@variance-authority/storybook-collector',
      '@variance-authority/route-collector',
      '@variance-authority/observe',
    ]);
  });

  it('labels each recipe with the manifest name', () => {
    const wrong: string[] = [];

    for (const [, label, dir] of links) {
      const manifest = join(ROOT, 'packages', dir!, 'package.json');
      if (!existsSync(manifest)) {
        wrong.push(`packages/${dir} does not exist`);
        continue;
      }

      const name = (JSON.parse(readFileSync(manifest, 'utf8')) as Manifest).name;
      if (label !== name) {
        wrong.push(`packages/${dir} is labelled \`${label}\`, not \`${name}\``);
      }
    }

    expect(wrong).toEqual([]);
  });
});
