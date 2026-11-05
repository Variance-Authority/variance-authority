/**
 * CI's `idea` job: every pull request a run would merge that changes what the
 * product does names an issue that carries `idea: build`, with no edit to its
 * body after the label went on (refine, "The idea loop"). On a pull request that is the one pull request;
 * in the merge queue it is every entry at or ahead of the group's head, since a
 * group merges them all.
 *
 * `node tools/idea.mjs queue [--limit <n>]` prints the issues the loop still owes
 * a verdict, as JSON in refine's order. A verdict is a comment marked
 * `<!-- idea-verdict: <name> -->`, so the queue needs nothing but the issues.
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const LABEL = 'idea: build';
const NAMES = /^(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|part of) #(\d+)/i;
/** Kinds that leave what the product does alone, from the pull request reference's table; any other kind, or none, is asked. */
const IDEALESS = new Set(['docs', 'chore', 'ci', 'test', 'refactor', 'revert']);
const VERDICT = /<!-- idea-verdict: ([\w-]+) -->/;
/** Who can answer for the loop: the repository is public, and anybody else's comment or issue is a report. */
const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
/** Verdicts that are no review of the idea: `incomplete` decides nothing, `none` says the loop does not apply, `build` passed. */
const UNCOUNTED = new Set(['incomplete', 'none', 'build']);
const V1 = 942;
/** Labels that outrank the rest, after v1, in refine's order. */
const TIERS = ['structural', 'architecture'];

/** The pull requests a merge group merges: its own entry and every one ahead of it. */
export const queued = (entries, head) => {
  const own = entries.find((entry) => entry.headCommit?.oid === head);
  return own && entries.filter((entry) => entry.position <= own.position).map((entry) => entry.pullRequest.number);
};

/** A bot's pull request, the version pull request and a kind that changes no behaviour carry no idea. */
export const asked = (pr) =>
  pr.author?.__typename !== 'Bot' &&
  !(!pr.isCrossRepository && pr.headRefName === 'changeset-release/main') &&
  !IDEALESS.has(kindOf(pr.title ?? ''));

/** The title's conventional kind; GitHub's own revert title is a `revert`. */
const kindOf = (title) => (title.startsWith('Revert "') ? 'revert' : /^(\w+)(?:\([^)]*\))?!?:/.exec(title)?.[1]);

/** The issue the body's first line names, as `Closes #<n>` or `Part of #<n>`. */
export const issueOf = (body) => {
  const match = NAMES.exec((body ?? '').split('\n')[0].trim());
  return match ? Number(match[1]) : undefined;
};

/** Why the issue does not approve the change, or nothing when it does. */
export const refusal = (n, issue) => {
  if (!issue.labels.nodes.some((label) => label.name === LABEL)) return `#${n} does not carry '${LABEL}': its idea has not passed review.`;
  const labelled = labelledAt(issue);
  if (issue.lastEditedAt && labelled && issue.lastEditedAt > labelled)
    return `#${n} was edited at ${issue.lastEditedAt}, after '${LABEL}' was put on at ${labelled}. Review it again (refine, "The idea loop").`;
};

const labelledAt = (issue) => issue.timelineItems.nodes.filter((event) => event.label?.name === LABEL).at(-1)?.createdAt;

const carries = (issue, name) => issue.labels.nodes.some((label) => label.name === name);

/** The issue's verdicts, oldest first, from the comments somebody trusted wrote. */
const verdicts = (issue) =>
  issue.comments.nodes.flatMap((comment) => {
    const name = TRUSTED.has(comment.authorAssociation) && VERDICT.exec(comment.body)?.[1];
    return name ? [{ name, at: comment.createdAt }] : [];
  });

/** Whether the loop owes the issue a verdict: none yet, or an edit no verdict has seen. */
export const pending = (issue) => {
  if (!TRUSTED.has(issue.authorAssociation) || carries(issue, 'epic')) return false;
  const answers = verdicts(issue).map((verdict) => verdict.at);
  if (carries(issue, LABEL)) answers.push(labelledAt(issue));
  const settled = answers.filter(Boolean).sort().at(-1);
  return !settled || Boolean(issue.lastEditedAt && issue.lastEditedAt > settled);
};

/** The reviews that ended without build; the third closes the issue (refine, "The idea loop"). */
export const reviewCount = (issue) => verdicts(issue).filter((verdict) => !UNCOUNTED.has(verdict.name)).length;

const tierOf = (issue) => {
  if (issue.number === V1 || issue.parent?.number === V1) return 0;
  const tier = TIERS.findIndex((name) => carries(issue, name));
  return tier === -1 ? TIERS.length + 1 : tier + 1;
};

const isBrief = (issue) => /^## Root cause/m.test(issue.body ?? '');

/** The queue in refine's order: a whole brief waits only for its review, so it goes first; then rank, newest first. */
export const ranked = (issues) =>
  issues
    .toSorted((a, b) => isBrief(b) - isBrief(a) || tierOf(a) - tierOf(b) || b.number - a.number)
    .map((issue) => ({ number: issue.number, title: issue.title, brief: isBrief(issue), reviews: reviewCount(issue) }));

const repository = () =>
  process.env.GITHUB_REPOSITORY ?? execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], { encoding: 'utf8' }).trim();

const graph = (query, variables) => {
  const [owner, name] = repository().split('/');
  const fields = Object.entries({ owner, name, ...variables }).flatMap(([key, value]) => ['-F', `${key}=${value}`]);
  const out = execFileSync('gh', ['api', 'graphql', '-f', `query=${query}`, ...fields], { encoding: 'utf8' });
  return JSON.parse(out).data.repository;
};

const QUEUE = `query($owner: String!, $name: String!, $branch: String!) { repository(owner: $owner, name: $name) {
  mergeQueue(branch: $branch) { entries(first: 100) { nodes { position headCommit { oid } pullRequest { number } } } } } }`;
const PULL = `query($owner: String!, $name: String!, $n: Int!) { repository(owner: $owner, name: $name) {
  pullRequest(number: $n) { title author { __typename } isCrossRepository headRefName body } } }`;
const ISSUE = `query($owner: String!, $name: String!, $n: Int!) { repository(owner: $owner, name: $name) { issue(number: $n) {
  lastEditedAt labels(first: 50) { nodes { name } }
  timelineItems(itemTypes: LABELED_EVENT, last: 50) { nodes { ... on LabeledEvent { createdAt label { name } } } } } } }`;

const OPEN = `query($owner: String!, $name: String!, $after: String) { repository(owner: $owner, name: $name) {
  issues(states: OPEN, first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes {
    number title body authorAssociation lastEditedAt parent { number } labels(first: 50) { nodes { name } }
    comments(last: 50) { nodes { authorAssociation createdAt body } }
    timelineItems(itemTypes: LABELED_EVENT, last: 50) { nodes { ... on LabeledEvent { createdAt label { name } } } } } } } }`;

const openIssues = (after = null) => {
  const { nodes, pageInfo } = graph(OPEN, { after }).issues;
  return pageInfo.hasNextPage ? [...nodes, ...openIssues(pageInfo.endCursor)] : nodes;
};

const queue = (args) => {
  const { limit } = parseArgs({ args, options: { limit: { type: 'string' } } }).values;
  const rows = ranked(openIssues().filter(pending));
  console.log(JSON.stringify(limit === undefined ? rows : rows.slice(0, Number(limit)), null, 2));
};

const main = () => {
  const { PR, QUEUE_HEAD, QUEUE_BASE } = process.env;
  const prs = PR
    ? [Number(PR)]
    : queued(graph(QUEUE, { branch: QUEUE_BASE.replace(/^refs\/heads\//, '') }).mergeQueue?.entries.nodes ?? [], QUEUE_HEAD);
  if (!prs) {
    console.error(`::error::No merge queue entry on ${QUEUE_BASE} has the head ${QUEUE_HEAD}, so the group's pull requests are unknown.`);
    process.exit(1);
  }
  let failed = false;
  for (const number of prs) {
    const pr = graph(PULL, { n: number }).pullRequest;
    if (!asked(pr)) {
      console.log(`#${number} is not asked: a bot's, the version pull request, or a kind that changes no behaviour.`);
      continue;
    }
    const n = issueOf(pr.body);
    const reason =
      n === undefined
        ? `#${number}'s first line names no issue as 'Closes #<n>' or 'Part of #<n>'. Every change to what the product does starts as an issue that passed the idea loop (.agents/references/refine.md).`
        : refusal(n, graph(ISSUE, { n }).issue);
    if (reason) console.error(`::error::${reason}`);
    else console.log(`#${number}: #${n} carries '${LABEL}'.`);
    failed ||= Boolean(reason);
  }
  if (failed) process.exit(1);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'queue') queue(process.argv.slice(3));
  else main();
}
