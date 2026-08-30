import { describe, expect, it } from 'vitest';
import type { RunReport } from '@variance-authority/report';
import { toolByName } from '../tools.js';

/**
 * Defects read out of a render, which no comparison could have produced.
 *
 * The property under every fixture here is that these survive a *clean* run. A
 * subject reported `unchanged` is a subject a comparison has nothing to say
 * about, and a control that never had an accessible name is `unchanged` on every
 * run there will ever be — so this list arrives beside a verdict that says
 * nothing happened, and has to carry its own reasons for being read.
 *
 * There are two of them, and they are the two questions an agent cannot act on a
 * list of eleven rule names without: what kind of defect this is, and whether
 * this change is what brought it. Both are asked of the record and neither is
 * ever inferred.
 */

function report(observations: readonly Record<string, unknown>[]): RunReport {
  return {
    runVersion: 1,
    at: '2026-08-01T10:00:00.000Z',
    identity: {
      renderer: 'playwright-chromium',
      engine: 'chromium@131.0.0',
      platform: 'darwin/arm64',
      deviceScaleFactor: 1,
      fonts: [],
    },
    retention: 'ephemeral',
    observations,
  } as unknown as RunReport;
}

function quiet(subject: string, findings?: readonly Record<string, unknown>[]): Record<string, unknown> {
  return {
    subject,
    verdict: 'unchanged',
    because: 'no pixels differ',
    changedPixels: 0,
    regions: [],
    ...(findings === undefined ? {} : { findings }),
  };
}

const NAMELESS = {
  rule: 'control-without-name',
  band: 'a11y',
  standing: true,
  what: '<button> is a button with no accessible name',
  component: 'IconButton',
  file: 'src/ds/IconButton.tsx:12',
};

const SKIPPED = {
  rule: 'heading-level-skipped',
  band: 'a11y',
  standing: false,
  what: 'heading level jumps from 2 to 4 at "Billing"',
  path: '0/0',
  component: 'Card',
  file: 'src/ds/Card.tsx:8',
};

const UNINSPECTED = report([quiet('ds/button--primary'), quiet('ds/card--default')]);

const WITH_FINDINGS = report([
  quiet('ds/button--primary', [{ ...NAMELESS, path: '0/1' }]),
  quiet('ds/card--default', [{ ...NAMELESS, path: '0/3' }, SKIPPED]),
]);

describe('findings, which no comparison could have produced', () => {
  it('points at them from a summary that is otherwise clean', () => {
    const text = toolByName('variance_summary')!.run(WITH_FINDINGS, {});

    expect(text).toContain('2 unchanged');
    expect(text).toContain('findings: 3 in 2 subject(s)');
    expect(text).toContain('do not affect the verdict');
  });

  it('collapses one component in two subjects into one line', () => {
    const text = toolByName('variance_findings')!.run(WITH_FINDINGS, {});

    expect(text).toContain('Accessibility · control-without-name — 2 occurrence(s)');
    expect(text).toContain('src/ds/IconButton.tsx:12 — in 2 subjects');
    expect(text).toContain('heading-level-skipped');
  });

  it('filters to one rule when asked', () => {
    const text = toolByName('variance_findings')!.run(WITH_FINDINGS, { rule: 'heading-level-skipped' });

    expect(text).toContain('heading-level-skipped');
    expect(text).not.toContain('control-without-name');
  });

  /**
   * The same distinction `coverage` draws. A report with no findings and a
   * report written by something that never inspected anything are different
   * claims, and an agent told "no findings" over the second has been told the
   * renders are clean by something that never read them.
   */
  it('does not let "nothing inspected" read as a clean bill of health', () => {
    const text = toolByName('variance_findings')!.run(UNINSPECTED, {});

    expect(text).toContain('Nothing in this report was inspected');
    expect(text).toContain('not evidence that the renders were clean');
  });

  it('says so differently when the renders were inspected and were clean', () => {
    const clean = report([quiet('ds/button--primary', []), quiet('ds/card--default', [])]);

    expect(toolByName('variance_findings')!.run(clean, {})).toContain(
      'No findings across 2 inspected subject(s)',
    );
    expect(toolByName('variance_summary')!.run(clean, {})).toContain(
      'findings: none in 2 inspected subject(s)',
    );
  });

  it('shows a subject its own findings even when nothing changed', () => {
    const text = toolByName('variance_describe')!.run(WITH_FINDINGS, {
      subject: 'ds/button--primary',
    });

    expect(text).toContain('[unchanged]');
    expect(text).toContain('read from this render, with no baseline compared');
    expect(text).toContain('src/ds/IconButton.tsx:12');
  });

  it('says what kind of defect each rule found, and whose it is', () => {
    const text = toolByName('variance_findings')!.run(WITH_FINDINGS, {});

    expect(text).toContain('1 arrived with this change');
    expect(text).toContain('2 already in the baseline');
    expect(text).toContain('Accessibility · heading-level-skipped');
    expect(text).toMatch(/heading level jumps from 2 to 4 at "Billing" — arrived with this change/);
  });

  it('files a subject’s defects under the band, dated, rather than as a flat list', () => {
    const text = toolByName('variance_describe')!.run(WITH_FINDINGS, {
      subject: 'ds/card--default',
    });

    expect(text).toContain('Accessibility');
    expect(text).toContain('[heading-level-skipped]');
    expect(text).toContain('arrived with this change');
    expect(text).toContain('already in the baseline');
  });

  it('does not print a defect nothing dated as one somebody introduced', () => {
    // The load-bearing state. A report written before the marks were kept has
    // `standing` absent everywhere, and absent is not `false` — every surface
    // that renders it has to say so and none of them may guess.
    const undated = report([
      quiet('ds/button--primary', [{ ...NAMELESS, path: '0/1', standing: undefined }]),
      quiet('ds/card--default', [{ ...SKIPPED, standing: undefined }]),
    ]);
    const text = toolByName('variance_findings')!.run(undated, {});

    expect(text).toContain('none of them can be dated');
    expect(text).not.toContain('arrived with this change');
    // And the word is not printed per line either, where it would be a column of
    // one repeated word under a sentence that has already said it.
    expect(text).not.toContain('not dated');
  });

  it('keeps one rule apart when it fired on something old and on something new', () => {
    const both = report([
      quiet('ds/card--default', [
        { ...NAMELESS, path: '0/3', standing: true },
        { ...NAMELESS, path: '0/9', standing: false },
      ]),
    ]);
    const text = toolByName('variance_findings')!.run(both, {});

    expect(text).toContain('arrived with this change');
    expect(text).toContain('already in the baseline');
  });

  it('dates the one line the summary spends on findings', () => {
    const text = toolByName('variance_summary')!.run(WITH_FINDINGS, {});

    expect(text).toContain('findings: 3 in 2 subject(s)');
    expect(text).toContain('1 arrived with this change');
  });
});
