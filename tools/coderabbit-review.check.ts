import { describe, expect, it } from 'vitest';
import { report, unfurnished } from './coderabbit-review.mjs';

/** The summary comment as CodeRabbit writes it on a push it skipped: the skip, a failed pre-merge check, and the spans it marks as furniture. */
const SKIPPED = `<!-- This is an auto-generated comment: summarize by coderabbit.ai -->
> [!IMPORTANT]
> This repository does not receive automatic reviews because it has fewer than 10 stars.
<!-- pre_merge_checks_walkthrough_start -->
| Check name |      Status      | Explanation |
|  Alignment | ![Error](https://storage.googleapis.com/error.svg) | A second reader beside the first… |
<!-- pre_merge_checks_walkthrough_end -->
<!-- autopilot:start -->
- [ ] <strong title="Keep fixing">Autofix</strong> · Keep fixing CodeRabbit findings
<!-- autopilot:end -->
<!-- tips_start -->
Thanks for using [CodeRabbit](https://coderabbit.ai)!
<!-- tips_end -->`;

const HEAD = '10a293940aaaaaaa';

describe('yarn review:coderabbit', () => {
  it("names a skipped or rate-limited check by its own title and still prints the summary's failed pre-merge check", () => {
    const text = report({
      number: 1,
      head: HEAD,
      check: { status: 'completed', conclusion: 'neutral', title: 'Review rate limited' },
      comments: [{ at: '2026-11-21T09:05:00Z', body: SKIPPED }],
      reviews: [],
      inline: [],
    });
    expect(text).toContain('CodeRabbit on #1: its check reads neutral (Review rate limited).');
    expect(text).toContain('fewer than 10 stars');
    expect(text).toContain('|  Alignment | ![Error](https://storage.googleapis.com/error.svg) | A second reader beside the first… |');
    for (const furniture of ['Autofix', 'Thanks for using']) expect(text).not.toContain(furniture);
  });

  it('prints review bodies and inline comments as written, and says which commit an older one judged', () => {
    const suggestion = '```suggestion\n<div className="x"><a href="/y">Go</a>  |  {/* <!-- c --> */}</div>\n```';
    const text = report({
      number: 2,
      head: HEAD,
      check: { status: 'in_progress' },
      comments: [],
      reviews: [
        { at: '2026-11-21T08:00:00Z', state: 'COMMENTED', commit: '8bd85d64e000', body: '**Actionable comments posted: 1**' },
        { at: '2026-11-21T08:00:01Z', state: 'COMMENTED', commit: HEAD, body: '' },
      ],
      inline: [
        { path: 'site/app/a.tsx', line: null, originalLine: 7, at: '2026-11-21T08:00:00Z', commit: '8bd85d64e000', body: suggestion },
        { path: 'src/b.ts', line: 3, originalLine: 3, at: '2026-11-21T09:01:00Z', commit: HEAD, body: 'A null is not empty.' },
      ],
    });
    expect(text.split('\n\n')).toEqual([
      'CodeRabbit on #2: its check is in_progress: what it wrote so far follows, read again once it completes.',
      '== review COMMENTED, 2026-11-21T08:00:00Z — judged 8bd85d64e, not the head 10a293940\n**Actionable comments posted: 1**',
      `== inline site/app/a.tsx, outdated, was line 7, 2026-11-21T08:00:00Z — judged 8bd85d64e, not the head 10a293940\n${suggestion}`,
      '== inline src/b.ts, line 3, 2026-11-21T09:01:00Z\nA null is not empty.',
    ]);
  });

  it('says so when it wrote nothing and has no check', () => {
    expect(report({ number: 3, head: HEAD, check: undefined, comments: [], reviews: [], inline: [] })).toBe(
      'CodeRabbit on #3: no CodeRabbit check on the head.\n\nIt wrote nothing on this pull request.',
    );
  });

  it('removes only the spans CodeRabbit marks as its furniture', () => {
    expect(unfurnished('<details>\n<summary>Review details</summary>\nup to 8ecd9\n</details>\n<!-- tips_start -->x<!-- tips_end -->')).toBe(
      '<details>\n<summary>Review details</summary>\nup to 8ecd9\n</details>',
    );
  });
});
