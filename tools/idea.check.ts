import { describe, expect, it } from 'vitest';
import { asked, issueOf, pending, queued, ranked, refusal, reviewCount } from './idea.mjs';

/**
 * CI's `idea` job asks every pull request a run would merge for an issue that
 * passed review and was not edited after. A merge group merges its own entry
 * and every entry ahead of it, so each of them is asked.
 */
describe('queued', () => {
  const entry = (position: number, number: number, oid: string) => ({ position, pullRequest: { number }, headCommit: { oid } });
  const entries = [entry(1, 10, 'h1'), entry(2, 11, 'h2'), entry(3, 12, 'h3')];

  it('names the group\'s own entry and every one ahead of it', () => {
    expect(queued(entries, 'h2')).toEqual([10, 11]);
  });

  it('names nothing when no entry has the head, so the job fails', () => {
    expect(queued(entries, 'h9')).toBeUndefined();
  });
});

describe('the issue each queued pull request names', () => {
  const issue = (labels: string[], labelled: string[], lastEditedAt: string | null) => ({
    lastEditedAt,
    labels: { nodes: labels.map((name) => ({ name })) },
    timelineItems: { nodes: labelled.map((createdAt) => ({ createdAt, label: { name: 'idea: build' } })) },
  });

  it('refuses an earlier queued pull request whose issue was edited after its label', () => {
    const issues: Record<number, ReturnType<typeof issue>> = {
      818: issue(['idea: build'], ['2026-10-01T00:00:00Z'], '2026-10-02T00:00:00Z'),
      819: issue(['idea: build'], ['2026-10-01T00:00:00Z'], null),
    };
    const bodies: Record<number, string> = { 10: 'Closes #818\n\n…', 11: 'Part of #819' };
    const group = queued(
      [
        { position: 1, pullRequest: { number: 10 }, headCommit: { oid: 'h1' } },
        { position: 2, pullRequest: { number: 11 }, headCommit: { oid: 'h2' } },
      ],
      'h2',
    )!;
    const reasons = group.map((pr) => {
      const n = issueOf(bodies[pr])!;
      return refusal(n, issues[n]);
    });
    expect(reasons[0]).toMatch(/#818 was edited at 2026-10-02T00:00:00Z, after 'idea: build'/);
    expect(reasons[1]).toBeUndefined();
  });

  it('passes an issue labelled again after its last edit', () => {
    expect(refusal(1, issue(['idea: build'], ['2026-10-01T00:00:00Z', '2026-10-03T00:00:00Z'], '2026-10-02T00:00:00Z'))).toBeUndefined();
  });

  it('refuses an issue without the label', () => {
    expect(refusal(1, issue([], ['2026-10-01T00:00:00Z'], null))).toMatch(/does not carry 'idea: build'/);
  });

  it('reads the issue from the first line only', () => {
    expect(issueOf('Closes #12\nPart of #13')).toBe(12);
    expect(issueOf('Fixes the thing\nCloses #12')).toBeUndefined();
  });

  const pr = (title: string, author = 'User', headRefName = 'x', isCrossRepository = false) => ({
    title,
    author: { __typename: author },
    headRefName,
    isCrossRepository,
  });

  it('does not ask a bot or the version pull request', () => {
    expect(asked(pr('feat: x', 'Bot'))).toBe(false);
    expect(asked(pr('Version packages', 'User', 'changeset-release/main'))).toBe(false);
    expect(asked(pr('Version packages', 'User', 'changeset-release/main', true))).toBe(true);
  });

  it('asks a change to what the product does, by its title\'s kind', () => {
    for (const title of ['feat(sense): x', 'fix: x', 'perf(core)!: x', 'a title with no kind'])
      expect(asked(pr(title))).toBe(true);
  });

  it('does not ask a change that leaves what the product does alone', () => {
    for (const title of ['docs: x', 'chore(agents): x', 'ci(colours): x', 'test: x', 'refactor(sense): x', 'revert: x', 'Revert "feat: x"'])
      expect(asked(pr(title))).toBe(false);
  });
});

/**
 * The sweep drains the idea loop from a queue the issues themselves hold: a
 * verdict is a marked comment, so filing an issue is all a session has to do.
 */
describe('the queue of issues the idea loop owes a verdict', () => {
  const verdict = (name: string, createdAt: string, authorAssociation = 'MEMBER') => ({
    authorAssociation,
    createdAt,
    body: `**${name}**\n\n<!-- idea-verdict: ${name} -->`,
  });
  const issue = (over: Record<string, unknown> = {}) => ({
    number: 1,
    title: 'a title',
    body: '## Situation\n\ntext',
    authorAssociation: 'MEMBER',
    lastEditedAt: null,
    parent: null,
    labels: { nodes: [] as { name: string }[] },
    comments: { nodes: [] as ReturnType<typeof verdict>[] },
    timelineItems: { nodes: [] as { createdAt: string; label: { name: string } }[] },
    ...over,
  });
  const labelled = (...names: string[]) => ({ labels: { nodes: names.map((name) => ({ name })) } });

  it('holds an issue no review has answered', () => {
    expect(pending(issue())).toBe(true);
  });

  it('drops an issue once a verdict answers it', () => {
    expect(pending(issue({ comments: { nodes: [verdict('incomplete', '2026-11-02T00:00:00Z')] } }))).toBe(false);
  });

  it('holds an issue edited after its verdict, since the edit is what the review has not seen', () => {
    expect(
      pending(issue({ lastEditedAt: '2026-11-03T00:00:00Z', comments: { nodes: [verdict('yes-but', '2026-11-02T00:00:00Z')] } })),
    ).toBe(true);
  });

  it('drops an issue that carries the label with no comment, as issues reviewed before verdicts were comments do', () => {
    const at = '2026-11-02T00:00:00Z';
    expect(pending(issue({ ...labelled('idea: build'), timelineItems: { nodes: [{ createdAt: at, label: { name: 'idea: build' } }] } }))).toBe(false);
  });

  it('holds a labelled issue edited after its label, which CI would refuse', () => {
    const at = '2026-11-02T00:00:00Z';
    expect(
      pending(
        issue({
          ...labelled('idea: build'),
          lastEditedAt: '2026-11-03T00:00:00Z',
          timelineItems: { nodes: [{ createdAt: at, label: { name: 'idea: build' } }] },
        }),
      ),
    ).toBe(true);
  });

  it('reads no verdict from a comment an outsider wrote, so nobody outside can take an issue off the queue', () => {
    expect(pending(issue({ comments: { nodes: [verdict('build', '2026-11-02T00:00:00Z', 'NONE')] } }))).toBe(true);
  });

  it('leaves out an issue an outsider filed, and an epic, which is a list and no change', () => {
    expect(pending(issue({ authorAssociation: 'NONE' }))).toBe(false);
    expect(pending(issue(labelled('epic')))).toBe(false);
  });

  it('counts the reviews that ended without build, and not incomplete, which decides nothing', () => {
    const nodes = [verdict('incomplete', '2026-11-01T00:00:00Z'), verdict('yes-but', '2026-11-02T00:00:00Z'), verdict('yes-but', '2026-11-03T00:00:00Z')];
    expect(reviewCount(issue({ comments: { nodes } }))).toBe(2);
  });

  it('ranks whole briefs first, then v1, structural, architecture and the rest, newest first within each', () => {
    const brief = '## Root cause\n\ntext';
    const rows = ranked([
      issue({ number: 1 }),
      issue({ number: 2, ...labelled('architecture') }),
      issue({ number: 3, ...labelled('structural') }),
      issue({ number: 4, parent: { number: 942 } }),
      issue({ number: 5, body: brief }),
      issue({ number: 6, body: brief }),
      issue({ number: 7 }),
    ]);
    expect(rows.map((row) => row.number)).toEqual([6, 5, 4, 3, 2, 7, 1]);
    expect(rows[0]).toEqual({ number: 6, title: 'a title', brief: true, reviews: 0 });
  });
});
