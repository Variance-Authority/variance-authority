import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, markers, tracked } from './unrun.mjs';

/**
 * The self-report is only worth reading if it cannot go quiet.
 *
 * `tools/unrun.mjs` prints what is written and has never run, from the markers
 * that sit at the lines that own it. Every failure mode of that arrangement is a
 * silent one: a marker spelled `// TODO` without the colon is invisible to the
 * reader and looks identical in review; an `it.todo` whose title is "not
 * implemented" is counted and says nothing; an `it.todo` inside a `describe.skip`
 * is reported by vitest as **skipped**, so it leaves the todo count on the exact
 * machines where the suite covers least.
 *
 * Static, like `tools/skips.check.ts` and for the same reason: a rule that only
 * bites on a machine without a browser is a rule nobody's run enforces.
 */

/** Markers whose text is a restatement of the marker. */
const VACUOUS = [
  /^not implemented\b/i,
  /^unimplemented\b/i,
  /^not (written|done|built)\b/i,
  /^(tbd|wip)\b/i,
  /^fix (this|it|me)\b/i,
  /\b(some ?day|eventually|at some point)\b/i,
];

/** Short enough to be a label rather than a claim. */
const SAYS_ENOUGH = 24;

/**
 * What a todo title owes the reader, spelled one way so it can be checked.
 *
 * The sentence that becomes true, then the price of making it true. Without the
 * second half a todo is a wish: it records that somebody once wanted something
 * and gives the next reader nothing to act on, which is how a todo list becomes
 * a thing people scroll past.
 */
const NAMES_ITS_PRICE = /—.*\bneeds\s/;

/** A file a test runner collects, and therefore a todo that appears in a summary. */
const COLLECTED = /\.(test|check)\.(ts|tsx|js|jsx)$/;

const MARKERS = markers();
const COMMENTS = MARKERS.filter((marker: { kind: string }) => marker.kind !== 'todo');
const TODOS = MARKERS.filter((marker: { kind: string }) => marker.kind === 'todo');

const where = (marker: { file: string; line: number }): string => `${marker.file}:${marker.line}`;

describe('the ledger is discovered', () => {
  it('finds comment markers', () => {
    // A regex change that stops matching empties this whole file, and an empty
    // ledger reads as a project with nothing outstanding.
    expect(COMMENTS.length).toBeGreaterThan(5);
  });

  it('finds todo tests', () => {
    expect(TODOS.length).toBeGreaterThan(5);
  });

  it('agrees with what the printer prints', () => {
    const printed = execFileSync('node', ['tools/unrun.mjs'], { cwd: ROOT, encoding: 'utf8' });
    const header = /^unrun: (\d+) gaps\b/m.exec(printed);

    // Discovery working while the report prints nothing is the one failure the
    // rules above cannot see, because they never read the output.
    expect(header?.[1]).toBe(String(MARKERS.length));
  });
});

describe('every marker is legible', () => {
  it('spells both words with a colon', () => {
    // `// TODO` and `// TODO:` are indistinguishable in review and only one of
    // them is in the ledger. One spelling, so the ledger is the whole of it.
    const bare = tracked().flatMap((file: string) => {
      const text = readFileSync(join(ROOT, file), 'utf8');
      return [...text.matchAll(/(?:\/\/|\/\*+|^[ \t]*\*|#)[ \t]*(TODO|FIXME)\b(:?)/gm)]
        .filter((match) => match[2] === '')
        .map((match) => `${file}: ${match[0].trim()}`);
    });

    expect(bare).toEqual([]);
  });

  it.each(MARKERS.map((marker) => [where(marker), marker] as const))('%s says something', (_at, marker) => {
    const text = marker.text ?? '';

    expect(text.length).toBeGreaterThan(SAYS_ENOUGH);
    expect(VACUOUS.filter((shape) => shape.test(text))).toEqual([]);
  });
});

describe('every todo would be read', () => {
  it.each(TODOS.map((marker) => [where(marker), marker] as const))('%s has a literal title', (_at, marker) => {
    // A computed title is invisible to this file and to anyone grepping. The
    // title is the claim, so it is written where the claim can be read.
    expect(marker.text).toBeTypeOf('string');
  });

  it.each(TODOS.map((marker) => [where(marker), marker] as const))('%s names its price', (_at, marker) => {
    expect(marker.text).toMatch(NAMES_ITS_PRICE);
  });

  it.each(TODOS.map((marker) => [where(marker), marker] as const))('%s is in a collected file', (_at, marker) => {
    // An `it.todo` in a file no runner collects is a function call nothing ever
    // makes, which is a comment with extra syntax.
    expect(COLLECTED.test(marker.file)).toBe(true);
  });

  /**
   * A todo inside a gated `describe` is not a todo.
   *
   * `const live = READY ? describe : describe.skip` is how every browser-gated
   * suite here decides, and vitest reports everything inside a skipped block as
   * **skipped** — including a todo. So the gap vanishes from the count on exactly
   * the machines that are running least of the suite, which is the silent-green
   * shape `tools/skips.check.ts` exists to argue against.
   *
   * Column 0 is the rule, because top level is the only place in these files that
   * no `describe` encloses.
   */
  it.each(
    TODOS.filter((marker: { file: string }) =>
      readFileSync(join(ROOT, marker.file), 'utf8').includes('describe.skip'),
    ).map((marker) => [where(marker), marker] as const),
  )('%s is outside the gate', (_at, marker) => {
    const line = readFileSync(join(ROOT, marker.file), 'utf8').split('\n')[marker.line - 1] ?? '';

    expect(line.startsWith('it.todo')).toBe(true);
  });
});

describe('the reader is reachable', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };

  it('is a script, because AGENTS.md tells people to run it', () => {
    expect(manifest.scripts['unrun']).toBe('node tools/unrun.mjs');
  });

  it('is not part of `verify`', () => {
    // A declared gap is not a defect, and a report that can fail a build stops
    // being a place anybody is willing to write one down.
    expect(manifest.scripts['verify']).not.toContain('unrun');
  });
});
