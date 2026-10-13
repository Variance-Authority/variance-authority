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
// - **On `main`, by landing there.** A pull request is where a change is
//   judged, and merging it is the person's answer, whatever its check said at
//   the time: green, red, still running, or never run because the check is new.
//   What lands on `main` is `main`, so every push to it promotes what it
//   renders. A `main` that compared against anything else would hold every
//   later pull request to pixels that are on no branch.
// - **Anywhere, by dispatching** the workflow with `accept` ticked — a branch
//   with no pull request, or a `main` whose store GitHub evicted, without
//   waiting for the next push.
//
// Which of those three applies depends on `VARIANCE_REVIEW`, the workflow's
// choice of where an accepted baseline lives:
//
// - `cache`: all three, as above.
// - `git`: the label, and nothing else. The accepted images are committed to
//   the pull request's branch, so they merge with the code and there is nothing
//   to promote on `main`. A dispatch has no branch to commit to, and is refused
//   rather than promoting images that no commit would keep.
// - `tribunal`: the dispatch alone, which writes through to the service. A
//   subject is decided on the service's review page, one at a time, and a
//   label here would be a second place deciding the same thing.
//
// Writes `promote`, `because` and `intent` to `$GITHUB_OUTPUT`. `fetch` and the
// REST API only, like `post-comment.mjs`, for the same reason: a dependency here
// would be a third party deciding what the baseline is.

import { appendFileSync, readFileSync } from 'node:fs';

const API_VERSION = '2022-11-28';

const repository = required('GITHUB_REPOSITORY');
const token = required('GITHUB_TOKEN');
const label = required('VARIANCE_ACCEPT_LABEL');
const api = (process.env['GITHUB_API_URL'] ?? 'https://api.github.com').replace(/\/+$/, '');
const sha = required('GITHUB_SHA');
const event = JSON.parse(readFileSync(required('GITHUB_EVENT_PATH'), 'utf8'));
const pull = event.pull_request;
const review = process.env['VARIANCE_REVIEW'] || 'cache';
if (!['cache', 'git', 'tribunal'].includes(review)) {
  fail(`VARIANCE_REVIEW is '${review}'; it is one of cache, git or tribunal`);
}

const decision = await decide(process.env['GITHUB_EVENT_NAME']);
const title = pull?.title ?? `main at ${sha}`;

output('promote', String(decision.promote));
output('because', decision.because);
output('intent', decision.promote ? `${title} — accepted: ${decision.because}` : title);
console.log(`${decision.promote ? 'accepting' : 'comparing only'}: ${decision.because}`);

async function decide(name) {
  if (name === 'workflow_dispatch') {
    if (process.env['VARIANCE_DISPATCH_ACCEPT'] !== 'true') {
      return { promote: false, because: 'dispatched without accept' };
    }
    if (review === 'git') {
      fail(
        'baselines are committed here (VARIANCE_REVIEW is git), and a dispatch has no pull ' +
          'request branch to commit them to; add the accept label on a pull request instead',
      );
    }
    return { promote: true, because: `dispatched by @${event.sender.login}` };
  }

  if (name === 'pull_request') {
    if (event.action !== 'labeled' || event.label?.name !== label) {
      return { promote: false, because: `pull request ${event.action}` };
    }
    if (review === 'tribunal') {
      return {
        promote: false,
        because: `\`${label}\` accepts nothing here; decide each subject on the review service`,
      };
    }
    if (review === 'git' && process.env['VARIANCE_PUSH_TOKEN_SET'] !== 'true') {
      // Not refused: the commit still lands, and a repository that requires no
      // `variance` check loses nothing. One that requires it waits for a run
      // that `GITHUB_TOKEN`'s push never starts.
      console.log(
        '::warning::VARIANCE_PUSH_TOKEN is not set, so the accepted images are pushed with ' +
          'GITHUB_TOKEN, which starts no workflow; the new commit gets no `variance` check ' +
          'until somebody pushes again',
      );
    }
    await removeLabel(pull.number);
    return { promote: true, because: `labelled \`${label}\` by @${event.sender.login}` };
  }

  if (name === 'push') {
    if (review === 'git') return { promote: false, because: 'the accepted baselines merged with the code' };
    if (review === 'tribunal') return { promote: false, because: 'the review service stores the baselines' };
    return landed();
  }

  return { promote: false, because: `${name} never accepts` };
}

/** A push, named by the pull request that merged as it, if one did. */
async function landed() {
  const branch = required('GITHUB_REF_NAME');
  const pulls = await request('GET', `/commits/${sha}/pulls`);
  const merged = pulls.find((candidate) => candidate.merged_at && candidate.merge_commit_sha === sha);
  if (merged !== undefined) return { promote: true, because: `#${merged.number} landed on \`${branch}\`` };
  return { promote: true, because: `pushed to \`${branch}\` by @${event.sender.login}` };
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
