import { describe, expect, it } from 'vitest';
import { main } from './bin.js';
import { COMMANDS, helpFor } from './usage.js';

/**
 * The codes a command's own help offers, against the codes it can return.
 *
 * Its own file rather than a section of `bin.test.ts`, which is at the size gate.
 * The question is narrow enough to name: per-command help printed the global
 * footer, so `variance accept --help` described a `1` that command has no path to
 * — a reader gating on it waits for a code that never arrives.
 */

/** The three that end in a verdict about the UI, and can therefore answer `1`. */
const VERDICT = ['run', 'report', 'adjudicate'] as const;

describe('per-command exit codes', () => {
  it('offers `1` to the commands that reach a verdict', () => {
    // `run` compares, `report` re-reads what a comparison wrote, and `adjudicate`
    // holds one against a declaration; each ends in `exitFor` or its sibling.
    for (const command of VERDICT) {
      expect(helpFor(command)).toContain(
        'exit codes: 0 nothing needs review, 1 changes need review, 2 operator error.',
      );
    }
  });

  it('tells every other command it answers 0 or 2, and never 1', () => {
    // `accept` promotes or refuses, `push` delivers or cannot, `doctor` can do the
    // work or cannot. None of them has a "changes need review" outcome.
    for (const command of COMMANDS.filter(
      (name) => !(VERDICT as readonly string[]).includes(name),
    )) {
      expect(helpFor(command)).toContain('exit codes: 0 done, 2 operator error.');
      expect(helpFor(command)).not.toContain('1 changes need review');
    }
  });

  it('prints the narrowed line through the program, not only the helper', async () => {
    // The helper is what a test can read; the reader gets what `main` writes.
    let out = '';
    const code = await main(['accept', '--help'], {
      out: (text) => {
        out += text;
      },
      err: () => undefined,
    });

    expect(code).toBe(0);
    expect(out).toContain('exit codes: 0 done, 2 operator error.');
    expect(out).not.toContain('1 changes need review');
  });
});
