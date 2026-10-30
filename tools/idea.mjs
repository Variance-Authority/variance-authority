/**
 * CI's `idea` job: every pull request a run would merge names an issue that
 * carries `idea: build`, with no edit to its body after the label went on
 * (refine, "The idea loop"). On a pull request that is the one pull request;
 * in the merge queue it is every entry at or ahead of the group's head, since a
 * group merges them all.
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const LABEL = 'idea: build';
const NAMES = /^(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|part of) #(\d+)/i;

/** The pull requests a merge group merges: its own entry and every one ahead of it. */
export const queued = (entries, head) => {
  const own = entries.find((entry) => entry.headCommit?.oid === head);
  return own && entries.filter((entry) => entry.position <= own.position).map((entry) => entry.pullRequest.number);
};

/** A bot's pull request and the version pull request carry no idea. */
export const asked = (pr) =>
  pr.author?.__typename !== 'Bot' && !(!pr.isCrossRepository && pr.headRefName === 'changeset-release/main');

/** The issue the body's first line names, as `Closes #<n>` or `Part of #<n>`. */
export const issueOf = (body) => {
  const match = NAMES.exec((body ?? '').split('\n')[0].trim());
  return match ? Number(match[1]) : undefined;
};

/** Why the issue does not approve the change, or nothing when it does. */
export const refusal = (n, issue) => {
  if (!issue.labels.nodes.some((label) => label.name === LABEL)) return `#${n} does not carry '${LABEL}': its idea has not passed review.`;
  const labelled = issue.timelineItems.nodes.filter((event) => event.label?.name === LABEL).at(-1)?.createdAt;
  if (issue.lastEditedAt && labelled && issue.lastEditedAt > labelled)
    return `#${n} was edited at ${issue.lastEditedAt}, after '${LABEL}' was put on at ${labelled}. Review it again (refine, "The idea loop").`;
};

const graph = (query, variables) => {
  const [owner, name] = process.env.GITHUB_REPOSITORY.split('/');
  const fields = Object.entries({ owner, name, ...variables }).flatMap(([key, value]) => ['-F', `${key}=${value}`]);
  const out = execFileSync('gh', ['api', 'graphql', '-f', `query=${query}`, ...fields], { encoding: 'utf8' });
  return JSON.parse(out).data.repository;
};

const QUEUE = `query($owner: String!, $name: String!, $branch: String!) { repository(owner: $owner, name: $name) {
  mergeQueue(branch: $branch) { entries(first: 100) { nodes { position headCommit { oid } pullRequest { number } } } } } }`;
const PULL = `query($owner: String!, $name: String!, $n: Int!) { repository(owner: $owner, name: $name) {
  pullRequest(number: $n) { author { __typename } isCrossRepository headRefName body } } }`;
const ISSUE = `query($owner: String!, $name: String!, $n: Int!) { repository(owner: $owner, name: $name) { issue(number: $n) {
  lastEditedAt labels(first: 50) { nodes { name } }
  timelineItems(itemTypes: LABELED_EVENT, last: 50) { nodes { ... on LabeledEvent { createdAt label { name } } } } } } }`;

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
      console.log(`#${number} is not asked: a bot's, or the version pull request.`);
      continue;
    }
    const n = issueOf(pr.body);
    const reason =
      n === undefined
        ? `#${number}'s first line names no issue as 'Closes #<n>' or 'Part of #<n>'. Every change starts as an issue that passed the idea loop (.agents/references/refine.md).`
        : refusal(n, graph(ISSUE, { n }).issue);
    if (reason) console.error(`::error::${reason}`);
    else console.log(`#${number}: #${n} carries '${LABEL}'.`);
    failed ||= Boolean(reason);
  }
  if (failed) process.exit(1);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
