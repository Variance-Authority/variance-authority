#!/usr/bin/env node
//
// Whether this run of `variance.yml` promotes what it renders, and who said so.
//
// Three people can say so, and each says it where they already are:
//
// - **On a pull request**, by adding the accept label. The label is a button,
//   not a state: this removes it again, so the next change needs the next press,
//   and the pull request's timeline keeps who pressed it and when. Only somebody
//   with triage access can label, which is the whole of the authorisation.
// - **On `main`, by merging** a pull request that was accepted. The acceptance
//   is carried, not repeated: the pull request's own `variance` check on its
//   head commit is the answer, and GitHub already holds it. A red `main` after a
//   reviewed merge would ask the same person the same question twice.
// - **Anywhere, by dispatching** the workflow with `accept` ticked — the
//   bootstrap, and the answer for work that lands on `main` without a pull
//   request.
//
// The merge carries only when `main` was green before it. A red parent means
// `main` already held pixels nobody accepted, and the merge's render cannot tell
// those apart from the ones the pull request's reviewer saw; promoting would
// accept both under one name.
//
// Writes `promote`, `because` and `intent` to `$GITHUB_OUTPUT`. `fetch` and the
// REST API only, like `post-comment.mjs`, for the same reason: a dependency here
// would be a third party deciding what the baseline is.

import { appendFileSync, readFileSync } from 'node:fs';

const API_VERSION = '2022-11-28';

const repository = required('GITHUB_REPOSITORY');
const token = required('GITHUB_TOKEN');
const label = required('VARIANCE_ACCEPT_LABEL');
const check = process.env['VARIANCE_CHECK'] || 'variance';
const api = (process.env['GITHUB_API_URL'] ?? 'https://api.github.com').replace(/\/+$/, '');
const sha = required('GITHUB_SHA');
const event = JSON.parse(readFileSync(required('GITHUB_EVENT_PATH'), 'utf8'));
const pull = event.pull_request;

const decision = await decide(process.env['GITHUB_EVENT_NAME']);
const title = pull?.title ?? `main at ${sha}`;

output('promote', String(decision.promote));
output('because', decision.because);
output('intent', decision.promote ? `${title} — accepted: ${decision.because}` : title);
console.log(`${decision.promote ? 'accepting' : 'comparing only'}: ${decision.because}`);

async function decide(name) {
  if (name === 'workflow_dispatch') {
    return process.env['VARIANCE_DISPATCH_ACCEPT'] === 'true'
      ? { promote: true, because: `dispatched by @${event.sender.login}` }
      : { promote: false, because: 'dispatched without accept' };
  }

  if (name === 'pull_request') {
    if (event.action !== 'labeled' || event.label?.name !== label) {
      return { promote: false, because: `pull request ${event.action}` };
    }
    await removeLabel(pull.number);
    return { promote: true, because: `labelled \`${label}\` by @${event.sender.login}` };
  }

  if (name === 'push') return carried();

  return { promote: false, because: `${name} never accepts` };
}

/** The acceptance a merged pull request already carries, if `main` may take it. */
async function carried() {
  const pulls = await request('GET', `/commits/${sha}/pulls`);
  const merged = pulls.find((candidate) => candidate.merged_at && candidate.merge_commit_sha === sha);
  if (merged === undefined) return { promote: false, because: 'not the merge of a pull request' };

  const head = await conclusion(merged.head.sha);
  if (head !== 'success') {
    return {
      promote: false,
      because: `#${merged.number} merged while its \`${check}\` check at its head was ${head}`,
    };
  }

  const commit = await request('GET', `/commits/${sha}`);
  const parent = commit.parents[0]?.sha;
  const before = parent === undefined ? 'absent' : await conclusion(parent);
  if (before !== 'success') {
    return {
      promote: false,
      because:
        `#${merged.number} was accepted, but \`main\` was ${before} before it merged, so ` +
        'its render cannot be told apart from pixels `main` already held unaccepted',
    };
  }

  return { promote: true, because: `#${merged.number} was accepted on its pull request` };
}

/**
 * The newest completed `variance` check on a commit, or why there is none.
 *
 * Several runs can report on one commit — a push, a pull request, an accept —
 * and the newest one to finish is the current answer. A skipped one is no answer
 * at all: the job did not run. The pull request's `closed` event and any label
 * other than the accept label both start this workflow on the head commit and
 * skip the job. On a merge that skipped run finishes seconds before this asks,
 * and read as the answer it hid the acceptance it came after.
 */
async function conclusion(commit) {
  const { check_runs: runs } = await request(
    'GET',
    `/commits/${commit}/check-runs?check_name=${encodeURIComponent(check)}&per_page=100`,
  );
  const done = runs.filter((run) => run.completed_at !== null && run.conclusion !== 'skipped');
  if (done.length === 0) return 'absent';
  done.sort((a, b) => (a.completed_at < b.completed_at ? 1 : a.completed_at > b.completed_at ? -1 : 0));
  return done[0].conclusion ?? 'absent';
}

async function removeLabel(number) {
  const url = `/issues/${number}/labels/${encodeURIComponent(label)}`;
  const response = await send('DELETE', url);
  if (response.ok || response.status === 404) return;
  // A fork's run holds a read-only token. The acceptance still stands — the
  // person who could add the label decided — and the label stays until somebody
  // takes it off, which the warning says.
  console.log(
    `::warning::the \`${label}\` label could not be removed (${response.status}); ` +
      'take it off by hand before accepting again',
  );
}

async function request(method, path) {
  const response = await send(method, path);
  if (!response.ok) {
    fail(`${method} ${path} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function send(method, path) {
  try {
    return await fetch(`${api}/repos/${repository}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': API_VERSION,
        'user-agent': 'variance-authority-workflow',
      },
    });
  } catch (error) {
    fail(`${method} ${path} could not be sent: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function output(key, value) {
  const path = required('GITHUB_OUTPUT');
  appendFileSync(path, `${key}<<__variance__\n${value}\n__variance__\n`);
}

function required(key) {
  const value = process.env[key];
  if (value === undefined || value === '') fail(`${key} is not set; this only runs inside GitHub Actions`);
  return value;
}

function fail(message) {
  console.log(`::error::${message}`);
  process.exit(2);
}
