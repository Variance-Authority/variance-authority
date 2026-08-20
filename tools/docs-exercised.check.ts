import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './markdown.js';

/**
 * An export a README tells an adopter to call, and whether anything calls it.
 *
 * Two failures this catches are the same failure seen from either end. A
 * documented export nothing exercises may be broken and the suite would be
 * green; a documented export nothing *calls* is a second implementation of
 * something the product does elsewhere, and the product's copy is the one that
 * gets fixed. `summarizeObservation` was both: exported, documented, called by
 * nothing, while `playwright-test` grew a private formatter for the same job and
 * the two drifted apart in what they printed.
 *
 * The rule is deliberately shallow — it asks whether the name occurs in a test,
 * not whether the test is about it. A rule that graded relevance would be a rule
 * someone deletes the first time it is wrong.
 */

const TRACKED = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
  .trim()
  .split('\n');

/** A file whose job is to run the product, rather than to be the product. */
function isExercise(file: string): boolean {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) || file.endsWith('.check.ts');
}

/** A file that only forwards a name it did not define. */
function isBarrel(file: string): boolean {
  return /(^|\/)index\.tsx?$/.test(file);
}

const SOURCES = TRACKED.filter(
  (file) => /^packages\/[^/]+\/src\/.+\.tsx?$/.test(file) && !isExercise(file) && !isBarrel(file),
);

const EXERCISES = TRACKED.filter(isExercise).map((file) => readFileSync(join(ROOT, file), 'utf8'));

interface Documented {
  readonly dir: string;
  readonly file: string;
  readonly name: string;
}

/**
 * Every value a package README names in backticks and its own source exports.
 *
 * Types are not included. A type is exercised by whatever compiles against it,
 * and `tools/doc-examples.mjs` already type-checks every fenced block, so an
 * unusable type fails there rather than here.
 */
const DOCUMENTED: readonly Documented[] = SOURCES.flatMap((file) => {
  const dir = file.slice(0, file.indexOf('/src/'));
  const readme = join(ROOT, dir, 'README.md');
  if (!existsSync(readme)) return [];
  const prose = readFileSync(readme, 'utf8');

  const source = readFileSync(join(ROOT, file), 'utf8');
  const names = [...source.matchAll(/^export (?:async function|function|const|class) (\w+)/gm)].map(
    (match) => match[1]!,
  );

  return names
    .filter((name) => prose.includes(`\`${name}\``))
    .map((name) => ({ dir, file, name }));
});

function exercised(name: string): boolean {
  return EXERCISES.some((text) => new RegExp(`\\b${name}\\b`).test(text));
}

/**
 * How many documented-but-unexercised exports each package is still carrying.
 *
 * A budget rather than a suppression, on the same terms as `OPTION_DEBT`: a
 * package absent from this map must exercise every export its README names, and
 * a package in it may only ever get closer to zero.
 *
 * All four entries are the same shape of debt — an export whose only honest test
 * needs something the unit suite does not have.
 *
 * - `playwright-test` — `bundlePageAgent` reads build output, and `AGENT` and
 *   `AGENT_VERSION` are page scope. All three are exercised by
 *   `direct.chromium.test.ts` through the fixture, which is a browser suite and
 *   names none of them.
 * - `playwright` — `captureOnce` and `fetchModules` both open a browser.
 * - `session` — the instrument no package depends on yet.
 * - `tribunal` — `applySchema` migrates a D1 database, and nothing here has one.
 *
 * A browser is not an excuse: `network.chromium.test.ts` and
 * `engines.chromium.test.ts` are both in this repository and both run. What is
 * true is that a browser test naming these by name is a longer job than the
 * afternoon that added this rule, and a budget records that without pretending
 * the work is done.
 */
const EXERCISE_DEBT: Readonly<Record<string, number>> = {
  'packages/playwright': 2,
  'packages/playwright-test': 3,
  'packages/session': 2,
  'packages/tribunal': 1,
};

const OWED = new Map<string, number>();
for (const entry of DOCUMENTED) {
  if (exercised(entry.name)) continue;
  OWED.set(entry.dir, (OWED.get(entry.dir) ?? 0) + 1);
}

describe('every export a README names is exercised somewhere', () => {
  it('finds documented exports to check, so this rule cannot pass by reading nothing', () => {
    expect(SOURCES.length).toBeGreaterThan(100);
    expect(EXERCISES.length).toBeGreaterThan(100);
    expect(DOCUMENTED.length).toBeGreaterThan(80);
  });

  it.each(DOCUMENTED.filter((entry) => !(entry.dir in EXERCISE_DEBT)).map((entry) => [entry.file, entry.name] as const))(
    '%s exports `%s`, and something runs it',
    (_file, name) => {
      expect(exercised(name), `\`${name}\` is documented and no test names it`).toBe(true);
    },
  );

  it.each(Object.keys(EXERCISE_DEBT))('%s exercises more of what it documents, never less', (dir) => {
    expect(
      OWED.get(dir) ?? 0,
      'lower the budget in EXERCISE_DEBT when this shrinks, and delete the entry when it reaches zero',
    ).toBeLessThanOrEqual(EXERCISE_DEBT[dir]!);
  });
});
