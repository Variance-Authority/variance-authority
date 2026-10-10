import { describe, expect, it } from 'vitest';
import { REVIEW_TOOLS } from '../tools.js';
import { concerns, concernsQuery, type ConcernsSubject } from './concerns.js';

/**
 * What reviewers suspect about a render, as an agent reads it: which renders
 * were flagged, where on them, what the reviewer pointed at, and every step
 * since — because the question an agent brings is *why was this flagged, and
 * is anybody on it*, and a title alone answers neither half.
 */

const SUBJECT: ConcernsSubject = {
  from: 'https://tribunal.example',
  concerns: [
    {
      id: 3,
      build: 'ci-1',
      subject: 'story:a',
      title: 'The border is clipped',
      region: { x: 10, y: 20, width: 120, height: 40, component: 'CartSummary' },
      evidence: ['CartSummary.tsx:84', 'baseline'],
      by: 'marina',
      at: '2026-06-01T10:00:00.000Z',
      state: 'investigating',
      events: [
        { state: 'open', by: 'marina', at: '2026-06-01T10:00:00.000Z', note: 'the right edge is cut' },
        {
          state: 'investigating',
          by: 'anton',
          at: '2026-06-02T10:00:00.000Z',
          hypothesis: 'the container lost its padding',
        },
      ],
    },
    {
      id: 5,
      build: 'ci-2',
      subject: 'story:b',
      title: 'Wrong font',
      evidence: [],
      by: 'anton',
      at: '2026-06-03T10:00:00.000Z',
      state: 'open',
      events: [{ state: 'open', by: 'anton', at: '2026-06-03T10:00:00.000Z' }],
    },
  ],
  tally: { open: 1, investigating: 1, resolved: 0 },
};

describe('variance_concerns', () => {
  it('is in the review tool set, read from the concerns route, and declares no argument that could raise or move one', () => {
    expect(REVIEW_TOOLS.map((tool) => tool.name)).toEqual(['variance_decisions', 'variance_concerns']);
    expect(concerns.route).toBe('/review/concerns');
    expect(Object.keys(concerns.inputSchema['properties'] as object).sort()).toEqual(['build', 'state', 'subject']);
  });

  it('lists every concern seen in a build with its region, evidence and trail, and the build’s tally', () => {
    expect(concerns.run(SUBJECT, { build: 'ci-2' }).split('\n')).toEqual([
      'https://tribunal.example: 2 concerns seen in build ci-2, in the order they were raised.',
      'build ci-2, over every subject it showed: 1 open, 1 investigating, 0 resolved.',
      '',
      '  #3  investigating  story:a  ci-1  "The border is clipped"',
      '      region 10,20 120x40 on CartSummary',
      '      evidence CartSummary.tsx:84, baseline',
      '      2026-06-01T10:00:00.000Z  open  marina  "the right edge is cut"',
      '      2026-06-02T10:00:00.000Z  investigating  anton  hypothesis "the container lost its padding"',
      '  #5  open  story:b  ci-2  "Wrong font"',
      '      2026-06-03T10:00:00.000Z  open  anton',
    ]);
  });

  it('narrows to a subject and a state, and says which it read', () => {
    const answer = concerns.run(SUBJECT, { subject: 'story:a', state: 'investigating' }).split('\n');
    expect(answer[0]).toBe(
      'https://tribunal.example: 1 concern on story:a that is investigating, in the order they were raised.',
    );
    expect(answer).toHaveLength(7);
  });

  it('says nothing was flagged rather than printing an empty list', () => {
    expect(concerns.run(SUBJECT, { subject: 'story:none' })).toBe(
      'https://tribunal.example records no concern on story:none.',
    );
  });

  it('refuses a call that names neither a subject nor a build, rather than listing the project', () => {
    expect(() => concerns.run(SUBJECT, {})).toThrow(/needs a `subject` or a `build`/);
    expect(() => concernsQuery({ state: 'open' })).toThrow(/needs a `subject` or a `build`/);
  });

  it('reads its input once, as the query the host sends', () => {
    expect(concernsQuery({ build: 'ci-1' })).toEqual({ build: 'ci-1' });
    expect(concerns.query({ subject: 'story:a', build: 'ci-1', state: 'open' })).toEqual({
      subject: 'story:a',
      build: 'ci-1',
      state: 'open',
    });
    expect(() => concernsQuery({ build: 'ci-1', state: 'closed' })).toThrow(
      /`state` is one of open, investigating, resolved/,
    );
    expect(() => concernsQuery({ subject: 7 })).toThrow(/subject/);
  });
});
