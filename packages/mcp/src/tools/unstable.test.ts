import { describe, expect, it } from 'vitest';
import type { RunReport } from '@variance-authority/report';
import { toolByName } from '../tools.js';

/**
 * How a subject that did not agree with itself reaches an agent.
 *
 * The mechanism is `packages/cli`'s and is asserted there. What is asserted here
 * is the handoff, which is a different thing and fails differently: three
 * subjects can all be `changed`, all need different work, and an agent handed the
 * verdict alone acts on the wrong one two times out of three.
 *
 * So every test below is about a word, a precedence, or a next step — and the
 * one that matters most is that this answer tells an agent *not* to do the thing
 * every other part of this surface is telling it to do.
 */

function reportWith(observation: Record<string, unknown>): RunReport {
  return {
    runVersion: 1,
    at: '2026-08-06T10:00:00.000Z',
    identity: {
      renderer: 'playwright-chromium',
      engine: 'chromium@131.0.0',
      platform: 'darwin/arm64',
      deviceScaleFactor: 1,
      fonts: [],
    },
    retention: 'durable',
    observations: [
      {
        subject: 'story:checkout--summary',
        verdict: 'changed',
        because: '804 pixel(s) differ across 2 region(s)',
        changedPixels: 804,
        regions: [{ x: 0, y: 0, width: 10, height: 10, pixels: 804, component: 'Clock', cause: true }],
        ...observation,
      },
    ],
    notObserved: [],
  } as unknown as RunReport;
}

const UNSTABLE = {
  unstable: {
    components: [{ name: 'Clock', file: 'src/ds/Clock.tsx:22' }],
    bands: ['content'],
    because:
      'read twice in the same world, seconds apart, with nothing changed in between, and ' +
      'the two readings disagree: Clock src/ds/Clock.tsx:22 read differently (content)',
  },
};

function summary(report: RunReport): string {
  return String(toolByName('variance_summary')?.run(report, {}));
}

function describeSubject(report: RunReport): string {
  return String(
    toolByName('variance_describe')?.run(report, { subject: 'story:checkout--summary' }),
  );
}

describe('a subject that did not agree with itself', () => {
  it('is labelled by what it is, not by its verdict', () => {
    // The verdict stays `changed`, because the pixels did move. An agent that
    // acts on that word opens a component nobody edited.
    expect(summary(reportWith(UNSTABLE))).toContain('[unstable] story:checkout--summary');
    expect(describeSubject(reportWith(UNSTABLE))).toContain('[unstable] story:checkout--summary');
  });

  it('tells the agent not to review the regions it is about to be shown', () => {
    // The regions are still printed, because they are real. What is added is that
    // *which* of them appear was decided by a race, so reading them as the shape
    // of an edit is reading a diff against a coin flip.
    const answer = describeSubject(reportWith(UNSTABLE));

    expect(answer).toContain('NOT A COMPONENT CHANGE');
    expect(answer).toContain('decided by a race');
    expect(answer).toContain('src/ds/Clock.tsx:22');
  });

  it('says what the band means, because that is what bounds the fix', () => {
    // A band is not a severity — it is what kind of thing moved, and each kind
    // has a short list of causes. This is the difference between a page to read
    // and four things to check.
    const answer = summary(reportWith(UNSTABLE));

    expect(answer).toContain('content — text or data moved');
    expect(answer).toContain('a clock, a random seed, an id counter');
  });

  it('offers a mask second and says why it is second', () => {
    // A clock genuinely is a clock, and an ignore is the right answer for one.
    // Leading with it is how a suite ends up green over a surface nobody watches.
    const answer = summary(reportWith(UNSTABLE));

    expect(answer).toContain('mask the *element*');
    expect(answer).toContain('hides the next regression that lands in the same place');
  });

  it('outranks the clean-world answer, which was never taken', () => {
    // Precedence, and it is not cosmetic. `alone` concludes "the clean reading
    // differs from the shared one, therefore the world moved it", which is only
    // evidence when two readings of one world would have agreed. On this subject
    // it is not asked at all, and a report carrying both must not print the one
    // that was disqualified.
    const answer = summary(
      reportWith({ ...UNSTABLE, alone: { reproduced: false, because: 'gone alone' } }),
    );

    expect(answer).toContain('[unstable]');
    expect(answer).not.toContain('[order-dependent]');
  });

  it('is not a finding when every band that moved is one the subject does not assert on', () => {
    // The boundary. A route declared `layout` said in its config that it does not
    // assert on what the page is painted with, so a clock inside it is a fact
    // about the page rather than a defect in it — and an agent told to go fix it
    // would be told to go fix the thing the declaration exists to allow.
    const answer = summary(
      reportWith({
        unstable: {
          ...UNSTABLE.unstable,
          absorbed: { rule: 'routes', level: 'layout' },
        },
      }),
    );

    expect(answer).not.toContain('UNSTABLE');
    expect(answer).not.toContain('[unstable]');

    // Counted and named all the same, the way `ignored` is never spelled
    // `unchanged`: a declaration nobody re-reads is how a suite stops watching
    // something, and the rule's name is what makes it auditable a year later.
    expect(answer).toContain('not asserted on: 1 subject(s)');
    expect(answer).toContain('absorbed by `routes` (asserts on layout)');
  });

  it('says how often this has happened, which is what decides who fixes it', () => {
    // Two readings are a floor and never a ceiling. This is the only line that
    // separates a fixture that has been bad for a month from something that
    // started today, and those are two different people's afternoons.
    const report = {
      ...reportWith(UNSTABLE),
      flakiness: {
        'story:checkout--summary': {
          runs: 20,
          sweeps: 12,
          occurrences: 6,
          absorbedRuns: 0,
          rate: 0.5,
          sweepsSince: 0,
          causes: [{ component: 'Clock', band: 'content', runs: 6 }],
          because: 'read differently in 6 run(s), 50% of the 12 sweep(s) that asked, and the most recent sweep still saw it',
        },
      },
    } as unknown as RunReport;

    expect(summary(report)).toContain('the fixture is the bug');
    expect(describeSubject(report)).toContain('OVER THE RECORDED WINDOW');
    expect(describeSubject(report)).toContain('Seen in: Clock content');
  });

  it('sends nobody to rewrite a fix that already landed', () => {
    const report = {
      ...reportWith(UNSTABLE),
      flakiness: {
        'story:checkout--summary': {
          runs: 30,
          sweeps: 21,
          occurrences: 6,
          absorbedRuns: 0,
          rate: 0.28,
          sweepsSince: 9,
          causes: [],
          because: 'read differently in 6 run(s), and 9 sweep(s) have not seen it since',
        },
      },
    } as unknown as RunReport;

    expect(summary(report)).toContain('check whether a fix already landed');
    expect(describeSubject(report)).toContain('before writing another one');
  });

  it('says the record was silent rather than letting silence read as "first time"', () => {
    // The claim a reader most wants to be true, and the one this report cannot
    // support: no store answered, so nothing here says whether it has happened
    // before.
    const answer = describeSubject(reportWith(UNSTABLE));

    expect(answer).toContain('No history record answered for this subject');
    expect(answer).toContain('not a first occurrence');
    expect(summary(reportWith(UNSTABLE))).toContain('That is silence, not a first occurrence.');
  });

  it('says nothing at all when every subject agreed with itself', () => {
    // Absence of the section is absence of a *finding*, never a certificate: two
    // readings put a floor under flakiness and no ceiling on it. The section is
    // omitted rather than printed empty, for the reason every other heading here
    // is — a heading over nothing invites the reader to conclude something was
    // checked and was fine.
    const answer = summary(reportWith({}));

    expect(answer).not.toContain('UNSTABLE');
    expect(answer).toContain('[changed] story:checkout--summary');
  });
});
