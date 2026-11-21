/**
 * `yarn review:coderabbit <n>`: everything CodeRabbit said on a pull request,
 * as text an agent reads whole (validate and correct, "CodeRabbit"). It posts
 * nothing.
 *
 * Its check is no summary of what it said. Here it reads `SKIPPED` on most pull
 * requests, because automatic reviews are off for the repository, and its
 * summary comment still carries the pre-merge checks `.coderabbit.yaml`
 * declares, a failed Alignment among them, and a merge-risk note. So every
 * place it writes is printed: the summary comment, each review's body, where
 * comments outside the diff and nitpicks go, and each inline comment. A skip, a
 * rate limit or a failed review is said and exits 0: none of them is waited for.
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BOT = 'coderabbitai';

/** Sections of its summary comment that carry nothing about the change: the share links, the autofix box, its configuration. */
const NOISE = [
  /<!-- tips_start -->[\s\S]*?<!-- tips_end -->/g,
  /<!-- autopilot:start -->[\s\S]*?<!-- autopilot:end -->/g,
  /<details>[\s>]*<summary>(?:(?!<\/summary>)[\s\S])*?(?:Share|Run configuration|Configuration used|Review details)[\s\S]*?<\/summary>[\s\S]*?<\/details>/g,
];

/** `body` as text: its HTML comments, noise sections, pictures and layout tags gone, an image kept as its words. */
export const plain = (body) => {
  let text = body.replace(/\r\n/g, '\n');
  for (const noise of NOISE) text = text.replace(noise, '');
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<picture>[\s\S]*?<\/picture>|<img\b[^>]*>/g, '')
    .replace(/<\/?(?:picture|source|sup|sub|dl|dd|dt|br|a|p|div|span)\b[^>]*>/g, '')
    .replace(/<\/?details>/g, '')
    .replace(/<summary>([\s\S]*?)<\/summary>/g, (_, title) => `\n${title.replace(/<[^>]+>/g, '').trim()}\n`)
    .replace(/<\/?strong[^>]*>/g, '**')
    .replace(/ {2,}\|/g, ' |')
    .replace(/\| {2,}/g, '| ')
    .replace(/\n[ \t>]*(?=\n)/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

/** What its check says, in one line: a review it did not make is a state to name, not a failure. */
export const verdict = (check) => {
  if (check === undefined) return 'no CodeRabbit check on this pull request';
  if (check.status !== 'COMPLETED') return `its check is ${check.status.toLowerCase()}: what it wrote so far follows, read again once it completes`;
  return `its check reads ${check.conclusion}`;
};

/**
 * The report: the check's state, then every place CodeRabbit wrote, oldest
 * first. A comment last written before the head commit is marked, since its
 * pre-merge checks judged an older tree.
 */
export const report = ({ number, head, check, comments, reviews, inline }) => {
  const stale = (at) => (head && at < head.at ? ` — written before the head ${head.oid.slice(0, 9)}` : '');
  const parts = [`CodeRabbit on #${number}: ${verdict(check)}.`];
  for (const comment of comments) parts.push(`== summary comment, ${comment.at}${stale(comment.at)}\n${plain(comment.body)}`);
  for (const review of reviews) {
    const body = plain(review.body);
    if (body) parts.push(`== review ${review.state}, ${review.at}${stale(review.at)}\n${body}`);
  }
  for (const comment of inline) parts.push(`== inline ${comment.path}:${comment.line ?? comment.originalLine ?? '?'}, ${comment.at}\n${plain(comment.body)}`);
  if (parts.length === 1) parts.push('It wrote nothing on this pull request.');
  return parts.join('\n\n');
};

const gh = (args) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));

const main = () => {
  const view = gh(['pr', 'view', ...process.argv.slice(2), '--json', 'number,url,headRefOid,commits,comments,reviews,statusCheckRollup']);
  const [, repo] = /github\.com\/([^/]+\/[^/]+)\/pull\//.exec(view.url) ?? [];
  const last = view.commits.at(-1);
  const pages = gh(['api', '--paginate', '--slurp', `repos/${repo}/pulls/${view.number}/comments`]);
  const check = view.statusCheckRollup.find((one) => one.name === 'CodeRabbit' || one.context === 'CodeRabbit');
  console.log(
    report({
      number: view.number,
      head: last && { oid: view.headRefOid, at: last.committedDate },
      check: check && { status: check.status ?? 'COMPLETED', conclusion: check.conclusion ?? check.state },
      comments: view.comments.filter((one) => one.author.login === BOT).map((one) => ({ at: one.updatedAt ?? one.createdAt, body: one.body })),
      reviews: view.reviews.filter((one) => one.author.login === BOT).map((one) => ({ at: one.submittedAt, state: one.state, body: one.body })),
      inline: pages
        .flat()
        .filter((one) => one.user.login === `${BOT}[bot]`)
        .map((one) => ({ path: one.path, line: one.line, originalLine: one.original_line, at: one.updated_at, body: one.body })),
    }),
  );
};

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
