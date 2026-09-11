import { describe, expect, it } from 'vitest';
import type { RenderIdentity } from '@variance-authority/core/format';
import type { ObservationRecord, RunReport } from '@variance-authority/report';
import { changelog } from './changelog.js';

/**
 * The question this tool answers is not *what changed* — seven other tools do
 * that — it is *what will still be written down about it tomorrow*.
 *
 * So nothing here asserts on the derivation. What is asserted is that the answer
 * is the commit's own words, that a subject the command will refuse is named as
 * refused *before* the command runs, and that a subject promoted with nothing
 * said about it is called that out loud. The last one is the finding: a promotion
 * the record cannot describe is unrecoverable the moment it lands.
 */

const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'linux/x64',
  deviceScaleFactor: 1,
  fonts: [],
};

const BRAND = 'v1:11111111111111111111111111111111';
const RADIUS = 'v1:22222222222222222222222222222222';

const button = (subject: string): ObservationRecord => ({
  subject,
  verdict: 'changed',
  because: 'a token moved',
  changedPixels: 120,
  regions: [
    {
      x: 0, y: 0, width: 40, height: 20, pixels: 120, cause: true,
      component: 'Button', file: 'src/Button.tsx', fingerprint: BRAND,
    },
  ],
  images: { after: `.variance/candidates/${subject}.png` },
});

const OBSERVATIONS: readonly ObservationRecord[] = [
  button('story:button-a'),
  button('story:button-b'),
  {
    ...button('story:mixed'),
    regions: [
      {
        x: 0, y: 0, width: 40, height: 20, pixels: 120, cause: true,
        component: 'Button', file: 'src/Button.tsx', fingerprint: BRAND,
      },
      {
        x: 0, y: 40, width: 30, height: 30, pixels: 60, cause: true,
        component: 'Card', file: 'src/Card.tsx', fingerprint: RADIUS,
      },
    ],
  },
  {
    ...button('story:jitter'),
    unstable: {
      components: [{ name: 'Clock', file: 'src/Clock.tsx:12' }],
      bands: ['content'],
      because: 'read twice seconds apart and the two readings disagreed in Clock',
    },
  },
  {
    subject: 'story:ephemeral',
    verdict: 'changed',
    because: 'pixels moved',
    changedPixels: 10,
    regions: [{ x: 0, y: 0, width: 5, height: 2, pixels: 10, cause: false }],
    images: { after: '.variance/candidates/story:ephemeral.png' },
  },
  { subject: 'story:calm', verdict: 'unchanged', because: '', changedPixels: 0, regions: [] },
];

const REPORT: RunReport = {
  runVersion: 1,
  at: '2026-08-06T10:00:00.000Z',
  identity: IDENTITY,
  retention: 'durable',
  intent: 'raise the brand accent',
  run: { id: 'build-91', commit: 'abc1234' },
  observations: OBSERVATIONS,
};

describe('reading the record before writing it', () => {
  it('answers in the lines the commit will carry, not a summary of them', () => {
    const answer = changelog.run(REPORT, {});

    // The operator's own sentence, the table row, and the run line — verbatim
    // from `changelogBody`, because the alternative is a second account of the
    // update that gets edited separately until one of them is wrong.
    expect(answer).toContain('raise the brand accent');
    // `3/4` rather than `3`: the shape is in four subjects and one of them is
    // unstable, so the change is not finished by this update and the line says so.
    expect(answer).toContain(`${BRAND} Button src/Button.tsx 3/4`);
    expect(answer).toContain('run build-91 @ abc1234 --all');
  });

  it('never renders the trailers', () => {
    // The trailers are the record. One copied out of a preview would attribute a
    // baseline to a promotion nobody performed.
    expect(changelog.run(REPORT, {})).not.toContain('Variance-Run:');
    expect(changelog.run(REPORT, {})).not.toContain('Variance-Change:');
  });

  it('spells out the command, with the message file on it', () => {
    expect(changelog.run(REPORT, {})).toContain(
      'variance accept --all --message-file .variance/commit-message.txt',
    );
  });

  it('names what the command will refuse before the command runs', () => {
    const answer = changelog.run(REPORT, {});

    expect(answer).toContain('Refused, and absent from the record (1):');
    expect(answer).toContain('story:jitter');
    expect(answer).toContain('Accepting it would promote one of two readings as the baseline');
    // Unchanged is not a refusal, and printing it as one turns the ordinary run
    // into a wall of failures.
    expect(answer).toContain('1 subject(s) already are the baseline');
  });

  it('says which subjects would be promoted with nothing recorded about them', () => {
    const answer = changelog.run(REPORT, {});

    // `story:ephemeral` was compared without a document, so no shape names its
    // difference. The record counts it and cannot describe it — and after the
    // commit lands there is nowhere left to ask.
    expect(answer).toContain('Promoted but not described (1): story:ephemeral');
    expect(answer).toContain('Nothing later can recover it');
    expect(answer).toContain('+1 unshaped');
  });
});

describe('previewing one shape', () => {
  it('shows the partial promotion as the fraction it is', () => {
    const answer = changelog.run(REPORT, { shape: BRAND });

    // The shape is in four subjects. It is the whole change in three, one of
    // which is unstable — so two land, and the line says so rather than reading
    // as though the shape was finished.
    expect(answer).toContain(`${BRAND} Button src/Button.tsx 2/4`);
    expect(answer).toContain(`variance accept --shape ${BRAND} --message-file`);
  });

  it('keeps "the shape is present beside something else" apart from "it is unstable"', () => {
    const answer = changelog.run(REPORT, { shape: BRAND });

    expect(answer).toContain('story:mixed');
    expect(answer).toContain('something else changed too');
    expect(answer).toContain('story:jitter');
  });

  it('refuses a shape this run has no region for, rather than reporting an empty update', () => {
    expect(changelog.run(REPORT, { shape: 'v1:deadbeef' })).toContain(
      'appears in no region of this run',
    );
  });
});

describe('when there would be no record', () => {
  it('gives the reason instead of an empty preview', () => {
    const nothing: RunReport = {
      ...REPORT,
      observations: OBSERVATIONS.filter(
        (observation) => observation.subject === 'story:jitter' || observation.subject === 'story:calm',
      ),
    };

    const answer = changelog.run(nothing, {});

    expect(answer).toContain(
      'Nothing would be recorded: nothing was accepted, so there is no baseline update to explain',
    );
    // And the reason it accepted nothing is still on the answer, because
    // "nothing to record" alone reads as "nothing happened".
    expect(answer).toContain('story:jitter');
  });

  it('refuses to guess which selection was meant', () => {
    expect(changelog.run(REPORT, { shape: BRAND, subjects: ['story:button-a'] })).toContain(
      'Ask for one selection at a time',
    );
  });

  it('names subjects that are not in this run rather than silently dropping them', () => {
    const answer = changelog.run(REPORT, { subjects: ['story:button-a', 'story:gone'] });

    expect(answer).toContain('variance accept "story:button-a" --message-file');
    expect(answer).toContain('story:gone');
    expect(answer).toContain('this run has no observation for it');
  });
});
