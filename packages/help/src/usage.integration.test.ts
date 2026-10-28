import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { verbs } from './ask.js';

/**
 * `--help` lists every verb in a column beside its description. The column was
 * once a fixed width, and the verbs added after it was chosen printed glued to
 * their text: `slowest-testsThe test files…`.
 */

const BIN = fileURLToPath(new URL('../dist/bin.js', import.meta.url));

/** The verb lines of the usage, between `Ask one question:` and the blank line after it. */
function verbLines(): readonly string[] {
  const usage = execFileSync('node', [BIN, '--help'], { encoding: 'utf8' }).split('\n');
  const start = usage.indexOf('Ask one question:') + 1;
  const end = usage.indexOf('', start);
  return usage.slice(start, end);
}

describe('variance-authority-help --help', () => {
  it('lists every verb, each separated from its description by at least one space', () => {
    const lines = verbLines();
    expect(lines.map((line) => line.trim().split(/\s/)[0])).toEqual(verbs().map(([verb]) => verb));
    for (const [verb] of verbs()) {
      expect(lines.find((line) => line.startsWith(`  ${verb}`)), verb).toMatch(new RegExp(`^  ${verb} +\\S`));
    }
  });

  it('starts every description in one column, wide enough for the longest verb', () => {
    const columns = new Set(verbLines().map((line) => /^ {2}\S+ +/.exec(line)?.[0].length));
    const longest = Math.max(...verbs().map(([verb]) => verb.length));
    expect([...columns]).toEqual([2 + longest + 1]);
  });
});
