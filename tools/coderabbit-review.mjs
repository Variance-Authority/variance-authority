/**
 * `yarn review:coderabbit <n>`: everything CodeRabbit said on a pull request,
 * as text an agent reads whole (validate and correct, "CodeRabbit"). It posts
 * nothing.
 *
 * Its check is no summary of what it said: a review it skipped or was rate
 * limited on still leaves a summary comment carrying the pre-merge checks
 * `.coderabbit.yaml` declares, and the merge-risk note of any push it reviewed. So every place it writes is
 * printed as it wrote it: the summary comment, each review's body, where
 * comments outside the diff and nitpicks go, and each inline comment. A skip, a
 * rate limit or a failed review is named from its check's own title and exits
 * 0: none of them is waited for.
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BOT = 'coderabbitai[bot]';

/** Spans CodeRabbit itself marks as its own furniture: the tips and share links, and the autofix box. */
const FURNITURE = [/<!-- tips_start -->[\s\S]*?<!-- tips_end -->/g, /<!-- autopilot:start -->[\s\S]*?<!-- autopilot:end -->/g];

/** `body` as CodeRabbit wrote it, less the spans it marks as furniture. */
export const unfurnished = (body) => FURNITURE.reduce((text, span) => text.replace(span, ''), body).trim();

/** What its check says, in one line: a review it did not make is a state to name, not a failure. */
const verdict = (check) => {
  if (check === undefined) return 'no CodeRabbit check on the head';
  const title = check.title ? ` (${check.title})` : '';
  if (check.status !== 'completed') return `its check is ${check.status}${title}: what it wrote so far follows, read again once it completes`;
  return `its check reads ${check.conclusion}${title}`;
};

/** Where a part judged another commit than the head, says which. */
const judged = (commit, head) => (commit && commit !== head ? ` — judged ${commit.slice(0, 9)}, not the head ${head.slice(0, 9)}` : '');

/**
 * The report: the check's state, then what CodeRabbit wrote by kind — its
 * comments, its reviews, its inline comments — each kind oldest first. A review or an inline comment that judged an older commit than the head
 * says so; the summary comment names the range it reviewed itself.
 */
export const report = ({ number, head, check, comments, reviews, inline }) => {
  const parts = [`CodeRabbit on #${number}: ${verdict(check)}.`];
  for (const comment of comments) parts.push(`== comment, last written ${comment.at}\n${unfurnished(comment.body)}`);
  for (const review of reviews) {
    const body = unfurnished(review.body);
    if (body) parts.push(`== review ${review.state}, ${review.at}${judged(review.commit, head)}\n${body}`);
  }
  for (const comment of inline) {
    const where = comment.line === null ? `outdated, was line ${comment.originalLine}` : `line ${comment.line}`;
    parts.push(`== inline ${comment.path}, ${where}, ${comment.at}${judged(comment.commit, head)}\n${unfurnished(comment.body)}`);
  }
  if (parts.length === 1) parts.push('It wrote nothing on this pull request.');
  return parts.join('\n\n');
};

/**
 * An inline comment as the REST API returns it, read for the report. GitHub
 * moves its `commit_id` forward while its line still maps, so the commit it was
 * written against is `original_commit_id`.
 */
export const inlineOf = (one) => ({
  path: one.path, line: one.line, originalLine: one.original_line, at: one.updated_at, commit: one.original_commit_id, body: one.body,
});

const gh = (args) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const all = (path) => gh(['api', '--paginate', '--slurp', path]).flat();

const main = () => {
  const view = gh(['pr', 'view', ...process.argv.slice(2), '--json', 'number,url,headRefOid']);
  const [, repo] = /github\.com\/([^/]+\/[^/]+)\/pull\//.exec(view.url) ?? [];
  const runs = gh(['api', `repos/${repo}/commits/${view.headRefOid}/check-runs?check_name=CodeRabbit`]).check_runs;
  const run = runs[0];
  const mine = (one) => one.user.login === BOT;
  console.log(
    report({
      number: view.number,
      head: view.headRefOid,
      check: run && { status: run.status, conclusion: run.conclusion, title: run.output?.title },
      comments: all(`repos/${repo}/issues/${view.number}/comments`).filter(mine).map((one) => ({ at: one.updated_at, body: one.body })),
      reviews: all(`repos/${repo}/pulls/${view.number}/reviews`)
        .filter(mine)
        .map((one) => ({ at: one.submitted_at, state: one.state, commit: one.commit_id, body: one.body ?? '' })),
      inline: all(`repos/${repo}/pulls/${view.number}/comments`)
        .filter(mine)
        .map(inlineOf),
    }),
  );
};

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
