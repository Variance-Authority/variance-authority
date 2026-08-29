import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Churn, Flakiness, Reach } from '@variance-authority/history';
import type { TribunalChangelog } from '../review.js';
import { ChangelogEntries, ChurnLine, StabilityLine } from './history.js';

/**
 * The surfaces that answer "is this normal?", tested where they could lie.
 *
 * Every assertion here is about a *missing* number being drawn as missing. These
 * components take history answers that are deliberately partial — a rate that
 * exists only after a sweep, a group of approvals nothing could attribute — and
 * the failure mode is not a crash but a confident sentence: `0%` flake, eleven
 * approvals out of forty rendered as eleven approvals. Both read as good news.
 */

function flakiness(overrides: Partial<Flakiness> = {}): Flakiness {
  return {
    subject: 'story:card',
    window: {},
    runs: 20,
    sweeps: 20,
    occurrences: 6,
    absorbedRuns: 0,
    rate: 0.3,
    sweepsSince: 0,
    causes: [],
    omittedRuns: 0,
    omittedOccurrences: 0,
    ...overrides,
  };
}

function churn(overrides: Partial<Churn> = {}): Churn {
  return {
    component: 'Toggle',
    window: {},
    runs: 20,
    changedRuns: 3,
    bands: [],
    collateralRuns: 0,
    rejectedRuns: 0,
    omittedRuns: 0,
    omittedRows: 0,
    ...overrides,
  };
}

const REACH: Reach = {
  component: 'Toggle',
  window: {},
  subjects: ['story:card', 'story:list'],
  arrived: [],
  omittedSubjects: 0,
};

describe('stability is drawn as three states, not as a percentage', () => {
  it('says unknown when nothing ever read the subject twice', () => {
    const markup = renderToStaticMarkup(
      <StabilityLine flakiness={flakiness({ sweeps: 0, occurrences: 0, sweepsSince: 0, rate: undefined })} />,
    );

    // The rate is absent from the answer precisely so this cannot be drawn as
    // 0%, which is the confident reply to a question nobody asked.
    expect(markup).toContain('unknown');
    expect(markup).not.toContain('0%');
  });

  it('separates a live flake from one nothing has seen in nine sweeps', () => {
    const live = renderToStaticMarkup(<StabilityLine flakiness={flakiness({ sweepsSince: 0 })} />);
    const stale = renderToStaticMarkup(<StabilityLine flakiness={flakiness({ sweepsSince: 9 })} />);

    // "6 of 20" is the same number in both and the instruction to the reader is
    // opposite, which is why the second sentence exists at all.
    expect(live).toContain('most recently in the latest sweep');
    expect(stale).toContain('none in the last 9 sweeps');
  });

  it('names what read differently when the readings could name it', () => {
    const markup = renderToStaticMarkup(
      <StabilityLine flakiness={flakiness({ causes: [{ component: 'Clock', band: 'content', runs: 4 }] })} />,
    );

    expect(markup).toContain('Clock');
    expect(markup).toContain('content');
  });

  it('reports a subject that swept clean as read twice and agreeing', () => {
    const markup = renderToStaticMarkup(
      <StabilityLine flakiness={flakiness({ occurrences: 0, rate: 0, sweepsSince: 20 })} />,
    );

    expect(markup).toContain('never disagreed with itself');
  });
});

describe('churn counts approved changes and reports displacement beside them', () => {
  it('never adds collateral to the change count', () => {
    const markup = renderToStaticMarkup(
      <ChurnLine component="Toggle" churn={churn({ collateralRuns: 14 })} reach={REACH} />,
    );

    // Summed, the widest container in the application becomes the most volatile
    // thing in it, in every run, forever.
    expect(markup).toContain('3 of 20');
    expect(markup).toContain('displaced without changing in 14');
  });

  it('says how far the component reaches, which is what makes one change three hundred', () => {
    const markup = renderToStaticMarkup(<ChurnLine component="Toggle" churn={churn()} reach={REACH} />);

    expect(markup).toContain('observed in 2 subjects');
  });
});

describe('the changelog groups by shape and still counts what it could not group', () => {
  const log: TribunalChangelog = {
    changes: [
      {
        fingerprint: 'fp-0123456789abcdef',
        component: 'Toggle',
        file: 'src/ds/toggle.tsx',
        subjects: ['story:card', 'story:list'],
        builds: ['ci-9'],
        by: ['marina'],
        at: '2026-08-20T09:00:00.000Z',
        intent: 'raise the toggle contrast',
      },
    ],
    ungrouped: [
      {
        build: 'ci-8',
        subject: 'story:ephemeral',
        commit: 'deadbeefcafe',
        by: 'marina',
        at: '2026-08-19T09:00:00.000Z',
        regions: [],
      },
    ],
  };

  it('renders one entry for a shape that landed in many subjects', () => {
    const markup = renderToStaticMarkup(<ChangelogEntries log={log} />);

    expect(markup).toContain('Toggle');
    expect(markup).toContain('2 subjects');
    expect(markup).toContain('raise the toggle contrast');
  });

  it('shows the approvals no shape could group rather than dropping them', () => {
    const markup = renderToStaticMarkup(<ChangelogEntries log={log} />);

    // A changelog covering eleven of forty approvals that reads as a changelog
    // of eleven approvals is worse than none.
    expect(markup).toContain('1 approved without an attributed shape');
    expect(markup).toContain('story:ephemeral');
  });

  it('says nothing has been approved rather than rendering an empty list', () => {
    const markup = renderToStaticMarkup(<ChangelogEntries log={{ changes: [], ungrouped: [] }} />);

    expect(markup).toContain('Nothing has been approved');
  });

  it('blames the filter for an empty answer, not the project', () => {
    const markup = renderToStaticMarkup(
      <ChangelogEntries log={{ changes: [], ungrouped: [] }} filter="Nothing" />,
    );

    // "Nothing has been approved in this project" under a filter that excluded
    // forty approvals is a claim about the project that the filter made up.
    expect(markup).toContain('No approval matched');
    expect(markup).not.toContain('in this project yet');
  });
});
