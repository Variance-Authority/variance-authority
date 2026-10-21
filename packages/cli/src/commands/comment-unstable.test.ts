import { describe, expect, it } from 'vitest';
import type { RenderIdentity } from '@variance-authority/core/format';
import type { ObservationRecord } from '@variance-authority/report';
import { renderComment } from './comment.js';
import { docketOf } from './docket.js';
import type { CliRunReport } from './run.js';

const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@151',
  platform: 'linux/x64',
  deviceScaleFactor: 1,
  fonts: ['ui-sans-serif/400/normal/sha256-case-system-stack'],
};

const TO_ACCEPT = 'check the report, then add the **variance: accept** label to this pull request.';

function reportOf(observations: readonly ObservationRecord[]): CliRunReport {
  return {
    runVersion: 1,
    at: '2026-10-21T00:38:09.543Z',
    identity: IDENTITY,
    retention: 'durable',
    observations,
    notObserved: [],
  };
}

/**
 * The run that put `Clock` on two documentation pull requests: a ticking story
 * read against a baseline taken at another 50 ms step, then read again, right
 * after, and found to disagree with itself.
 */
const ticking: ObservationRecord = {
  subject: 'story:case-surface--ticking',
  verdict: 'changed',
  because: '29 pixel(s) differ across 1 region(s)',
  changedPixels: 29,
  regions: [
    {
      x: 8,
      y: 8,
      width: 120,
      height: 18,
      pixels: 29,
      component: 'Clock',
      file: 'cases/storybook-case/src/ds.jsx:118',
      cause: true,
    },
  ],
  unstable: {
    components: [{ name: 'Clock', file: 'cases/storybook-case/src/ds.jsx:118' }],
    bands: ['content'],
    because:
      'two readings in a row, with nothing changed between, differ: Clock cases/storybook-case/src/ds.jsx:118 (content). ' +
      'Change neither confirmed nor cleared',
  },
};

const button: ObservationRecord = {
  subject: 'story:case-surface--primary',
  verdict: 'changed',
  because: '86 pixel(s) differ across 1 region(s)',
  changedPixels: 86,
  regions: [
    { x: 4, y: 4, width: 16, height: 16, pixels: 86, component: 'Button', file: 'src/ds.jsx:12', cause: true },
  ],
  images: { after: 'story_case-surface--primary.after.png' },
};

describe('an unstable subject in the pull-request comment', () => {
  it('is not a cause to review, because nothing the pull request did moved it', () => {
    const body = renderComment({ project: 'storybook-case', report: reportOf([ticking]), toAccept: TO_ACCEPT });

    expect(body).toContain('## Visual variance — 1 subject(s) unstable');
    expect(body).not.toContain('need review');
    expect(body).not.toContain('Cause: **`Clock`**');
    expect(body).not.toContain('### Causes');
  });

  it('names what differed between the two readings and the command that shows it', () => {
    const body = renderComment({ project: 'storybook-case', report: reportOf([ticking]) });

    expect(body).toContain('`story:case-surface--ticking` — `Clock` `cases/storybook-case/src/ds.jsx:118` (content)');
    expect(body).toContain("`variance run --subjects 'story:case-surface--ticking' --flakes`");
  });

  it('does not offer accept, which refuses a subject that disagrees with itself', () => {
    const body = renderComment({ project: 'storybook-case', report: reportOf([ticking]), toAccept: TO_ACCEPT });

    expect(body).not.toContain('To accept');
    expect(body).toContain('`accept` refuses');
  });

  it('keeps the real change beside it as the cause, and still offers accept for that', () => {
    const body = renderComment({
      project: 'storybook-case',
      report: reportOf([button, ticking]),
      toAccept: TO_ACCEPT,
    });

    expect(body).toContain('## Visual variance — 1 subject(s) need review, 1 subject(s) unstable');
    expect(body).toContain('Cause: **`Button`**');
    expect(body).toContain(`To accept: ${TO_ACCEPT}`);
  });

  it('does not offer accept beside a subject that failed to render, which accept cannot take either', () => {
    const report: CliRunReport = {
      ...reportOf([]),
      notObserved: [{ subject: 'story:case-surface--broken', kind: 'failed', because: 'the story threw' }],
    };
    const body = renderComment({ project: 'storybook-case', report, toAccept: TO_ACCEPT });

    expect(body).not.toContain('To accept');
  });

  it('does not offer accept beside a change that accept refuses, because another subject moved it', () => {
    const leaked: ObservationRecord = {
      ...button,
      alone: { reproduced: false, because: 'read alone, it matches its baseline' },
    };
    const body = renderComment({
      project: 'storybook-case',
      report: reportOf([leaked, ticking]),
      toAccept: TO_ACCEPT,
    });

    expect(body).not.toContain('To accept');
  });

  it('says what the history record knows about the subject, or that none answered', () => {
    const recorded: CliRunReport = {
      ...reportOf([ticking]),
      flakiness: {
        'story:case-surface--ticking': {
          runs: 12,
          sweeps: 12,
          occurrences: 6,
          absorbedRuns: 0,
          rate: 0.5,
          sweepsSince: 0,
          causes: [{ component: 'Clock', band: 'content', runs: 6 }],
          because: 'read differently in 6 run(s), 50% of the 12 sweep(s) that asked',
        },
      },
    };

    expect(renderComment({ project: 'storybook-case', report: recorded })).toContain(
      'read differently in 6 run(s), 50% of the 12 sweep(s) that asked',
    );
    expect(renderComment({ project: 'storybook-case', report: reportOf([ticking]) })).toContain(
      'No history record: recurrence unknown.',
    );
  });

  it('leaves an absorbed instability where its verdict puts it', () => {
    // The subject declared what it asserts on and every band that moved is
    // outside it: not a finding, so not listed as unstable either.
    const absorbed: ObservationRecord = {
      ...ticking,
      verdict: 'unchanged',
      changedPixels: 0,
      regions: [],
      unstable: { ...ticking.unstable!, absorbed: { rule: 'routes', level: 'layout' } },
    };

    expect(docketOf(reportOf([absorbed])).unstable).toEqual([]);
  });

  it('lists a subject that agreed with its baseline and not with itself', () => {
    // A `--flakes` sweep reads every subject twice, so an `unchanged` verdict can
    // carry an instability; that verdict came from one of two readings.
    const sweep: ObservationRecord = { ...ticking, verdict: 'unchanged', changedPixels: 0, regions: [] };

    expect(docketOf(reportOf([sweep])).unstable.map((entry) => entry.subject)).toEqual([
      'story:case-surface--ticking',
    ]);
  });
});
