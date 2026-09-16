import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A suite that does not run says so, and says what would make it run.
 *
 * Ten test files need a Chromium this repository does not install, and on a
 * machine without one they skip roughly two hundred tests. That is the correct
 * behaviour — the alternative is a red suite about a missing binary — and it is
 * also the most dangerous shape a check can take, because **a green run with two
 * hundred silent skips is indistinguishable from a green run**. `cases/README.md`
 * has claimed "both cases skip loudly, with the command attached" since before it
 * was true.
 *
 * It was not true. When this was written, four of the ten files announced
 * themselves and six printed nothing at all; three of those six carried an
 * `it.skip('needs a Chromium download: …')` placeholder, which reads like an
 * announcement in the source and emits nothing, because vitest's default reporter
 * — the one CI runs — never prints a skipped test's name. Two hundred and six
 * skipped tests, fifty-four of them explained.
 *
 * So the rule is checked here rather than described there.
 *
 * ## Why this is static
 *
 * The obvious implementation is to run the suite and assert that every fully
 * skipped file emitted something. That check is **vacuous on any machine with a
 * browser** — nothing skips, so it asserts nothing — which is every machine where
 * this project's measurements were made, and it would only ever bite in CI. A
 * check that passes by not applying is the failure this repository exists to
 * argue against, so this reads the source instead and runs identically everywhere.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The command that makes the skipped suites run, spelled exactly as they must
 * spell it — or `installCommand(...)`, which prints it from the declared engine
 * list in `packages/playwright/src/engines.ts`.
 *
 * The second spelling exists because one suite's remedy is not a constant: it
 * installs whichever engines were declared, so writing `chromium` there would be
 * a literal that goes stale the moment the declaration changes.
 */
const REMEDIES: readonly string[] = ['npx playwright install chromium', 'installCommand('];

/**
 * The gate, and therefore the files.
 *
 * Every browser-gated suite decides the same way — `existsSync(chromium.executablePath())`
 * — so the gate is what discovers them. A filename convention would not: `harness.test.ts`
 * is gated and carries no `chromium` in its name.
 */
const GATES: readonly string[] = [
  // `executablePath()`, not `chromium.executablePath()`. The narrower spelling
  // was the hole this file's own comment predicted: a suite that gates on
  // whichever engines are installed asks `engine.executablePath()` through a
  // variable, gates correctly, announces correctly — and was discovered by
  // nothing, so the rule that exists to prevent silent skips would have silently
  // stopped covering it.
  'executablePath()',
  // The same hole, reopened when the gate moved behind a function. A suite that
  // asks `requireEngines()` whether this machine has the declared engines does
  // not name `executablePath` anywhere, and the grep above stopped seeing it.
  'requireEngines(',
];

const GATED: readonly string[] = [
  ...new Set(
    GATES.flatMap((gate) =>
      execFileSync('git', ['grep', '-l', gate], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n'),
    ),
  ),
]
  .filter((file) => file.length > 0)
  // This file names the gate in order to find it, and is not gated by it. Left
  // in, it discovers itself, finds no announcement, and fails — a checker whose
  // first finding is itself teaches everyone to distrust its second.
  .filter((file) => !file.startsWith('tools/'))
  // Suites, and only suites. A benchmark script asks the same question for a
  // different reason: nobody runs it as part of `yarn test`, so it cannot skip
  // silently inside a green run, and telling it to `console.warn` during
  // collection asks a file that has no collection to have one.
  .filter((file) => /\.test\.[cm]?[jt]sx?$/.test(file))
  // Suites that can *decline*, and only those. Asking the gate is not the same
  // as being gated by it: `engines.test.ts` calls `requireEngines` to assert
  // what it returns on a machine with every engine, with one, and with none, so
  // it runs everywhere and skips nothing. Demanding an announcement from it
  // would be demanding a warning about a skip that cannot happen. This rule is
  // about silent skips, so the skip is what discovers them, and a file that
  // names none has none to be silent about.
  .filter((file) => /\.skip\b|\b(?:run|skip)If\b/.test(readFileSync(join(ROOT, file), 'utf8')));

/**
 * Every `console.warn` a reader reaches during collection: top level, or one
 * `if` deep.
 *
 * Read as text with a column rule rather than parsed. A `console.warn` that runs
 * during collection is written at column 0 or indented inside one top-level
 * block, so it is reachable exactly when its `console` sits at an indent of four
 * spaces or fewer. Anything deeper is inside a `describe` or an `it`, where it
 * never runs on a skipped suite — which is the failure this rule exists to
 * prevent.
 *
 * That is the whole reason the AST went: driving a compiler to answer "is this
 * call nested" is what put the TypeScript API in the test suite, and the column
 * answers it. A false negative here is a file that announces and is told it does
 * not, which fails loudly; there is no way for it to produce a false pass.
 */
function announcements(file: string): readonly string[] {
  const text = readFileSync(join(ROOT, file), 'utf8');
  const found: string[] = [];

  for (const match of text.matchAll(/^(\s*)console\.warn\(([\s\S]*?)^\1\);/gm)) {
    if ((match[1] ?? '').length <= 4) found.push(match[0]);
  }
  return found;
}

describe('a suite that does not run says why', () => {
  it('finds the browser-gated suites', () => {
    // If the gate is ever spelled differently this discovers nothing and the whole
    // file passes by checking nothing, which is the defect it exists to prevent.
    expect(GATED.length).toBeGreaterThan(5);
  });

  it.each(GATED)('%s announces itself', (file) => {
    const spoken = announcements(file).join('\n');

    // Not a search of the whole file: three of these carried the exact command
    // inside an `it.skip` title and printed nothing. It has to be in something a
    // skipped run actually executes.
    expect(REMEDIES.some((remedy) => spoken.includes(remedy))).toBe(true);
  });

  it.each(GATED)('%s keeps no placeholder that announces nothing', (file) => {
    const text = readFileSync(join(ROOT, file), 'utf8');
    const placebo = /it\.skip\(\s*['"`][^'"`]*playwright install/.test(text);

    // The shape that was here before: a skipped test whose *title* is the remedy.
    // It reads like an announcement in review and is invisible in the log.
    expect(placebo).toBe(false);
  });
});

/**
 * The number in the workflow's comment is the number of gated files.
 *
 * `.github/workflows/check.yml` explains what a green check does not cover. That
 * paragraph is prose in a file no checker reads — YAML, so
 * `documentation.test.ts` cannot see it — and it is exactly the kind of unenforced
 * count this repository has had wrong six times. The file count is statically
 * knowable, so it is pinned; the *test* count is not, and was removed rather than
 * restated.
 */
describe('the workflow says how much it is not running', () => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/check.yml'), 'utf8');

  it('names the browser-gated file count', () => {
    expect(workflow).toContain(`${GATED.length} files`);
  });

  it('states no test count it cannot know', () => {
    // A test total depends on a run. Writing one into a comment makes a claim
    // that goes stale on the next `it` anybody adds, silently.
    expect(/~?\d+ (?:tests|skipped tests)/.test(workflow)).toBe(false);
  });
});
