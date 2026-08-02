import { describe, expect, it } from 'vitest';
import { EXIT_CLEAN, EXIT_OPERATOR, EXIT_REVIEW, OperatorError, exitFor } from './exit.js';

describe('exit codes', () => {
  it('keeps a verdict and a crash on different codes', () => {
    // The one property CI depends on. If they collided, a job could not tell a
    // real finding from a missing browser, and would either ignore findings or
    // block on infrastructure.
    expect(new Set([EXIT_CLEAN, EXIT_REVIEW, EXIT_OPERATOR]).size).toBe(3);
    expect(new OperatorError('x').exitCode).toBe(EXIT_OPERATOR);
  });
});

describe('exitFor', () => {
  it('is clean when every subject was observed and nothing changed', () => {
    expect(
      exitFor({ observations: [{ verdict: 'unchanged' }], notObserved: [] }),
    ).toBe(EXIT_CLEAN);
  });

  it('needs review on a change', () => {
    expect(
      exitFor({ observations: [{ verdict: 'unchanged' }, { verdict: 'changed' }], notObserved: [] }),
    ).toBe(EXIT_REVIEW);
  });

  it('needs review on `new`, which is neither a regression nor a pass', () => {
    // Nobody has ever agreed what this subject should look like. Exiting clean
    // would let it enter the suite unreviewed and stay that way.
    expect(exitFor({ observations: [{ verdict: 'new' }], notObserved: [] })).toBe(EXIT_REVIEW);
  });

  it('needs review on `incomparable`, because the comparison was refused', () => {
    // Nothing is known about this subject. An unobservable difference must never
    // be reported as no difference.
    expect(exitFor({ observations: [{ verdict: 'incomparable' }], notObserved: [] })).toBe(
      EXIT_REVIEW,
    );
  });

  it('needs review when a subject the run meant to observe failed', () => {
    // Spec 0003's acceptance in one line: a subject that cannot be observed does
    // not silently pass.
    expect(
      exitFor({ observations: [{ verdict: 'unchanged' }], notObserved: [{ kind: 'failed' }] }),
    ).toBe(EXIT_REVIEW);
  });

  it('stays clean for subjects excluded by configuration', () => {
    // The operator already made and wrote down this decision. Treating it as a
    // finding would make every run with an exclusion permanently red, which ends
    // with the exclusion list being deleted rather than read.
    expect(
      exitFor({ observations: [{ verdict: 'unchanged' }], notObserved: [{ kind: 'excluded' }] }),
    ).toBe(EXIT_CLEAN);
  });

  it('needs review when the report never said what it skipped', () => {
    // Absent is not empty. A report that does not account for its subjects cannot
    // support the sentence "nothing needs review".
    expect(exitFor({ observations: [{ verdict: 'unchanged' }] })).toBe(EXIT_REVIEW);
  });

  it('never returns the operator code from a verdict', () => {
    // `2` means the run did not happen. No arrangement of findings may produce it.
    const codes = [
      exitFor({ observations: [], notObserved: [] }),
      exitFor({ observations: [{ verdict: 'changed' }], notObserved: [{ kind: 'failed' }] }),
      exitFor({ observations: [{ verdict: 'incomparable' }] }),
    ];
    expect(codes).not.toContain(EXIT_OPERATOR);
  });
});
