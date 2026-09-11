import { describe, expect, it } from 'vitest';
import type { RenderIdentity } from '@variance-authority/core/format';
import type { ObservationRecord, RunReport } from '@variance-authority/report';
import { changes } from './changes.js';

/**
 * The scenario this tool exists for: a token bump across a component library.
 *
 * Not a unit test on the grouping — that is asserted next door, on the function
 * that does it. What is asserted here is the *answer*, because the answer is the
 * product. The design criterion for everything in this package is "does this
 * help an agent fix the thing", and an agent is helped by a first line that
 * turns forty subjects into three decisions and by a command it can run without
 * deriving a digest it might derive wrong.
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

/**
 * Thirty-one stories move because `Button` picked up a new brand colour, three
 * because a radius token moved in `Card`, and one story renders both — so it is
 * the one no bulk action may touch.
 */
const OBSERVATIONS: readonly ObservationRecord[] = [
  ...Array.from({ length: 31 }, (_, index): ObservationRecord => ({
    subject: `story:button-${index}`,
    verdict: 'changed',
    because: 'a token moved',
    changedPixels: 120,
    regions: [
      {
        x: 0, y: 0, width: 40, height: 20, pixels: 120, cause: true,
        component: 'Button', file: 'src/Button.tsx', fingerprint: BRAND,
      },
    ],
  })),
  ...Array.from({ length: 3 }, (_, index): ObservationRecord => ({
    subject: `story:card-${index}`,
    verdict: 'changed',
    because: 'a token moved',
    changedPixels: 60,
    regions: [
      {
        x: 0, y: 0, width: 30, height: 30, pixels: 60, cause: true,
        component: 'Card', file: 'src/Card.tsx', fingerprint: RADIUS,
      },
    ],
  })),
  {
    subject: 'story:both',
    verdict: 'changed',
    because: 'two tokens moved',
    changedPixels: 180,
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
];

const REPORT: RunReport = {
  runVersion: 1,
  at: '2026-08-06T10:00:00.000Z',
  identity: IDENTITY,
  retention: 'durable',
  observations: OBSERVATIONS,
};

describe('sizing the review before starting it', () => {
  it('leads with the number of decisions, not the number of subjects', () => {
    const answer = changes.run(REPORT, {});

    // 35 changed subjects. Two decisions. That sentence is the tool.
    expect(answer.split('\n')[0]).toBe(
      '35 subject(s) changed, and they are 2 distinct change(s) — 2 of which can be decided in one action',
    );
  });

  it('names the component, the file, and the command that settles it', () => {
    const answer = changes.run(REPORT, {});

    expect(answer).toContain('Button');
    expect(answer).toContain('src/Button.tsx');
    // The digest is the one part of this answer an agent cannot derive from
    // anything else in the report, so it is printed as the command rather than
    // as a field to assemble one from.
    expect(answer).toContain(`variance accept --shape ${BRAND}`);
  });

  it('says out loud where a bulk accept would overreach', () => {
    const answer = changes.run(REPORT, {});

    // `story:both` renders both changes. Accepting either shape there promotes
    // the other without review, and `accept --shape` refuses it — so the tool
    // says so here, and the agent proposes a command that will work instead of
    // one that will be refused.
    expect(answer).toContain('reaches 32 subject(s); it is the whole change in 31');
    expect(answer).toContain(
      'in the other 1, something else also moved, so accepting this shape there would ' +
        'promote a difference nobody reviewed',
    );
  });

  it('puts the change that finishes more of the review first', () => {
    const answer = changes.run(REPORT, {});

    expect(answer.indexOf('Button')).toBeLessThan(answer.indexOf('Card'));
  });
});

describe('answering about a component that is not in the run', () => {
  it('separates "not this component" from "nothing was grouped"', () => {
    // Two different next moves for an agent. Collapsing them into one sentence
    // sends it down the wrong one: it either goes looking for a component that
    // did not change, or it concludes the run has no shapes when it has plenty.
    expect(changes.run(REPORT, { component: 'Avatar' })).toContain(
      'No change in this run is attributed to Avatar',
    );
    expect(changes.run(REPORT, { component: 'Avatar' })).toContain('Button, Card');

    const ungrouped: RunReport = {
      ...REPORT,
      observations: [
        {
          subject: 'story:ephemeral',
          verdict: 'changed',
          because: 'pixels moved',
          changedPixels: 10,
          regions: [{ x: 0, y: 0, width: 5, height: 2, pixels: 10, cause: false }],
        },
      ],
    };

    expect(changes.run(ungrouped, { component: 'Avatar' })).toContain(
      'no grouped changes at all',
    );
  });

  it('explains what an ungrouped subject means rather than listing it bare', () => {
    const mixed: RunReport = {
      ...REPORT,
      observations: [
        ...OBSERVATIONS,
        {
          subject: 'story:ephemeral',
          verdict: 'changed',
          because: 'pixels moved',
          changedPixels: 10,
          regions: [{ x: 0, y: 0, width: 5, height: 2, pixels: 10, cause: false }],
        },
      ],
    };

    const answer = changes.run(mixed, {});

    // "Not grouped" with no explanation reads as a defect in the tool. It is a
    // property of the run: no document survived, so there is no shape to group
    // on, and those subjects genuinely have to be read one at a time.
    expect(answer).toContain('Not grouped (1): story:ephemeral');
    expect(answer).toContain('compared without a document');
  });
});

describe('a run with nothing to decide', () => {
  it('does not print an empty list under a confident heading', () => {
    const clean: RunReport = {
      ...REPORT,
      observations: [
        { subject: 'story:a', verdict: 'unchanged', because: '', changedPixels: 0, regions: [] },
      ],
    };

    expect(changes.run(clean, {})).toBe('nothing changed');
  });
});
