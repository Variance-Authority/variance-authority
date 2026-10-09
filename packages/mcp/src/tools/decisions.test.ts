import { describe, expect, it } from 'vitest';
import { REVIEW_TOOLS } from '../tools.js';
import { decisions, decisionsQuery, type ReviewSubject } from './decisions.js';

/**
 * What reviewers decided, as an agent reads it: newest first, every reversal
 * kept, and the one decision that stands on each subject marked — because the
 * question an agent brings is usually *is this settled*, and a history that
 * leaves that to arithmetic gets the arithmetic wrong.
 */

const SUBJECT: ReviewSubject = {
  from: 'https://tribunal.example',
  decisions: [
    { build: 'ci-2', subject: 'story:a', decision: 'rejected', by: 'marina', at: '2026-06-03T10:00:00.000Z' },
    {
      build: 'ci-1',
      subject: 'story:a',
      decision: 'approved',
      by: 'marina',
      at: '2026-06-02T10:00:00.000Z',
      note: 'the border was the point',
    },
    {
      build: 'ci-1',
      subject: 'story:a',
      decision: 'rejected',
      by: 'anton',
      at: '2026-06-01T10:00:00.000Z',
      note: 'the border is wrong',
    },
    { build: 'ci-1', subject: 'story:b', decision: 'approved', by: 'anton', at: '2026-06-01T09:00:00.000Z' },
  ],
};

describe('variance_decisions', () => {
  it('is the review tool set, and declares no argument that could decide', () => {
    expect(REVIEW_TOOLS.map((tool) => tool.name)).toEqual(['variance_decisions']);
    expect(Object.keys(decisions.inputSchema['properties'] as object).sort()).toEqual(['build', 'limit', 'subject']);
  });

  it('lists every decision on a subject newest first, and marks the one that was replaced', () => {
    expect(decisions.run(SUBJECT, { subject: 'story:a' }).split('\n')).toEqual([
      'https://tribunal.example: 3 decisions on story:a, newest first.',
      '',
      '  2026-06-03T10:00:00.000Z  rejected  story:a  ci-2  marina',
      '  2026-06-02T10:00:00.000Z  approved  story:a  ci-1  marina  "the border was the point"',
      '  2026-06-01T10:00:00.000Z  rejected  story:a  ci-1  anton  "the border is wrong"  (replaced)',
    ]);
  });

  it('refuses a call that names neither a subject nor a build, rather than listing the project', () => {
    expect(() => decisions.run(SUBJECT, {})).toThrow(/needs a `subject` or a `build`/);
    expect(() => decisionsQuery({ limit: 5 })).toThrow(/needs a `subject` or a `build`/);
  });

  it('narrows to a subject and a build, and says which it read', () => {
    const answer = decisions.run(SUBJECT, { subject: 'story:a', build: 'ci-1' }).split('\n');
    expect(answer[0]).toBe('https://tribunal.example: 2 decisions on story:a in build ci-1, newest first.');
    expect(answer).toHaveLength(4);
  });

  it('says nothing was decided rather than printing an empty list', () => {
    expect(decisions.run(SUBJECT, { subject: 'story:none' })).toBe(
      'https://tribunal.example records no decision on story:none.',
    );
  });

  it('stops at the limit and says the history may hold more', () => {
    const answer = decisions.run(SUBJECT, { subject: 'story:a', limit: 2 }).split('\n');
    expect(answer).toHaveLength(5);
    expect(answer[4]).toBe('  the newest 2 are listed and the history may hold more; `limit` reads further back');
  });

  it('reads its input once, for the host that fetches and for the answer alike', () => {
    expect(decisionsQuery({ build: 'ci-1' })).toEqual({ build: 'ci-1', limit: 20 });
    expect(decisionsQuery({ subject: 'story:a', build: 'ci-1', limit: 3 })).toEqual({
      subject: 'story:a',
      build: 'ci-1',
      limit: 3,
    });
    expect(() => decisionsQuery({ build: 'ci-1', limit: 0 })).toThrow(/from 1 to 200/);
    expect(() => decisionsQuery({ subject: 7 })).toThrow(/subject/);
  });

  it('refuses a limit past the 200 a deployment reads at once, before asking it', () => {
    expect(() => decisionsQuery({ build: 'ci-1', limit: 201 })).toThrow(
      /from 1 to 200: a deployment reads no more at once; narrow by `subject` and `build`/,
    );
    expect(decisions.inputSchema['properties']).toMatchObject({ limit: { minimum: 1, maximum: 200 } });
  });
});
