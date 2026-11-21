import { describe, expect, it } from 'vitest';
import { plain, report } from './coderabbit-review.mjs';

/** The summary comment as CodeRabbit writes it on a push it skipped: the skip, a failed pre-merge check, and its noise. */
const SKIPPED = `<!-- This is an auto-generated comment: summarize by coderabbit.ai -->
> [!IMPORTANT]
> This repository does not receive automatic reviews because it has fewer than 10 stars.
>
> <details>
> <summary><strong><picture><img src="cog.svg" alt=""></picture> Run configuration</strong></summary>
> <dl><dd>
> - **Run ID**: \`3f9d\`
> </dd></dl>
> </details>
<!-- pre_merge_checks_walkthrough_start -->
<strong><sup><picture><img src="failed.svg" alt="Failed" title="Failed"></picture></sup> Failed checks: 1 error</strong>

| Check name |      Status      | Explanation |
| :-------- | :--------------: | :---------- |
|  Alignment | ![Error](https://storage.googleapis.com/error.svg) | A second reader beside the first… |

<details>
<summary><strong>Full details: Alignment</strong></summary>
<dl><dd><br>

**Resolution**

Route the read through the existing reader.

</dd></dl>
</details>
<!-- pre_merge_checks_walkthrough_end -->
<!-- autopilot:start -->
- [ ] <strong title="Keep fixing">Autofix</strong> · Keep fixing CodeRabbit findings
<!-- autopilot:end -->
<!-- tips_start -->
Thanks for using [CodeRabbit](https://coderabbit.ai)!
<details>
<summary><strong>Share</strong></summary>
- [X](https://twitter.com/intent/tweet)
</details>
<!-- tips_end -->`;

const head = { oid: '10a293940aa', at: '2026-11-21T09:00:00Z' };

describe('yarn review:coderabbit', () => {
  it('reads a skipped check as a state and still prints the pre-merge check its summary failed', () => {
    const text = report({
      number: 1,
      head,
      check: { status: 'COMPLETED', conclusion: 'SKIPPED' },
      comments: [{ at: '2026-11-21T09:05:00Z', body: SKIPPED }],
      reviews: [],
      inline: [],
    });
    expect(text).toContain('CodeRabbit on #1: its check reads SKIPPED.');
    expect(text).toContain('fewer than 10 stars');
    expect(text).toContain('| Alignment | Error | A second reader beside the first… |');
    expect(text).toContain('Route the read through the existing reader.');
    for (const noise of ['Run ID', 'Autofix', 'Thanks for using', 'twitter', '<', 'svg']) expect(text).not.toContain(noise);
  });

  it('prints a review body and each inline comment, and marks what was written before the head', () => {
    const text = report({
      number: 2,
      head,
      check: { status: 'IN_PROGRESS' },
      comments: [],
      reviews: [
        { at: '2026-11-21T08:00:00Z', state: 'COMMENTED', body: '**Actionable comments posted: 1**\n\nOutside diff range: `a.ts` 3-4' },
        { at: '2026-11-21T08:00:01Z', state: 'COMMENTED', body: '<!-- nothing but a marker -->' },
      ],
      inline: [{ path: 'src/a.ts', line: null, originalLine: 7, at: '2026-11-21T09:01:00Z', body: 'A null is not empty.' }],
    });
    expect(text.split('\n\n')).toEqual([
      'CodeRabbit on #2: its check is in_progress: what it wrote so far follows, read again once it completes.',
      '== review COMMENTED, 2026-11-21T08:00:00Z — written before the head 10a293940\n**Actionable comments posted: 1**',
      'Outside diff range: `a.ts` 3-4',
      '== inline src/a.ts:7, 2026-11-21T09:01:00Z\nA null is not empty.',
    ]);
  });

  it('says so when it wrote nothing and has no check', () => {
    expect(report({ number: 3, head, check: undefined, comments: [], reviews: [], inline: [] })).toBe(
      'CodeRabbit on #3: no CodeRabbit check on this pull request.\n\nIt wrote nothing on this pull request.',
    );
  });

  it("keeps an image's words and a section's title, and drops layout tags", () => {
    expect(plain('<details>\n<summary><strong>Walkthrough</strong></summary>\n<dl><dd><br>\nIt reads ![Passed](x.svg).\n</dd></dl>\n</details>')).toBe(
      'Walkthrough\n\nIt reads Passed.',
    );
  });
});
