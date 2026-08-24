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

// Do not let this check satisfy itself. Its debt commentary necessarily names
// the exports it is accounting for, and this rule is intentionally shallow.
const EXERCISES = TRACKED.filter(
  (file) => isExercise(file) && file !== 'tools/docs-exercised.check.ts',
).map((file) => readFileSync(join(ROOT, file), 'utf8'));

interface Documented {
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
    .map((name) => ({ file, name }));
});

function exercised(name: string): boolean {
  return EXERCISES.some((text) => new RegExp(`\\b${name}\\b`).test(text));
}

describe('every export a README names is exercised somewhere', () => {
  it('finds documented exports to check, so this rule cannot pass by reading nothing', () => {
    expect(SOURCES.length).toBeGreaterThan(100);
    expect(EXERCISES.length).toBeGreaterThan(100);
    expect(DOCUMENTED.length).toBeGreaterThan(80);
  });

  it.each(DOCUMENTED.map((entry) => [entry.file, entry.name] as const))(
    '%s exports `%s`, and something runs it',
    (_file, name) => {
      expect(exercised(name), `\`${name}\` is documented and no test names it`).toBe(true);
    },
  );
});
