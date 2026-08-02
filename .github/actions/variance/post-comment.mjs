#!/usr/bin/env node
//
// One comment on the pull request, updated in place.
//
// A new comment per run buries the current state under a history nobody reads,
// and attaches a notification to each burial. So this finds the comment it wrote
// last time and rewrites that one. Finding it is the whole problem: GitHub gives
// a comment no durable identity the next job can reconstruct, so the identity is
// carried in the body, as the invisible HTML marker the renderer puts on the
// first line.
//
// **Matching on the body rather than on the author is deliberate.** A
// `GITHUB_TOKEN` comments as `github-actions[bot]`; a personal access token
// comments as a person; a GitHub App comments as itself. A rule keyed on any of
// those silently starts duplicating the day an operator changes the credential,
// and duplication is the exact failure this file exists to prevent. The cost is
// real and worth stating: anyone who can comment on the pull request can paste
// the marker into a comment of their own, and this will then rewrite theirs
// instead of posting its own. That trades a spoofable comment body for a
// guaranteed-correct one, on a surface where the docket's contents are already
// public and the check's verdict comes from an exit code this cannot touch.
//
// **Nothing is uploaded anywhere the operator did not configure.** The only
// network call is to the GitHub API of the instance this job is already running
// on, with the token the workflow passed in. No SDK, no dependency, no registry
// fetch — `fetch` and the REST API are enough, and a dependency here would be a
// third party with write access to every pull request.
//
// Usage:
//   node post-comment.mjs --body-file <path> --marker <string> [--pr <number>]

import { readFileSync } from 'node:fs';

const API_VERSION = '2022-11-28';
const PER_PAGE = 100;

/**
 * Pages of comments this will read before refusing to guess.
 *
 * A pull request with more than five thousand comments is pathological, and the
 * important part is what happens at the boundary: this stops and says so rather
 * than concluding "no previous comment" and posting a duplicate, which is the
 * silent-failure shape the whole design is arranged against.
 */
const MAX_PAGES = 50;

const options = parseArgs(process.argv.slice(2));

if (typeof fetch !== 'function') {
  fail(`this needs a Node with a global fetch (18+); this one is ${process.version}`);
}

let body;
try {
  body = readFileSync(options.bodyFile, 'utf8');
} catch (error) {
  // A missing file is not "nothing to review" — it is a render that never
  // happened. Treating the two the same would let a broken renderer look like a
  // clean run for as long as nobody checked.
  fail(`cannot read the comment body ${options.bodyFile}: ${messageOf(error)}`);
}

const repository = process.env['GITHUB_REPOSITORY'];
if (repository === undefined || !repository.includes('/')) {
  fail('GITHUB_REPOSITORY is not set to `owner/repo`; this only runs inside GitHub Actions');
}

const token = process.env['GITHUB_TOKEN'];
if (token === undefined || token === '') {
  fail(
    'no GITHUB_TOKEN in the environment. Pass `github-token:` to the action, or turn ' +
      '`comment:` off — this will not post anonymously and will not guess a credential.',
  );
}

const pull = options.pr ?? pullRequestNumber();
if (pull === undefined) {
  // Not an error. `variance run` is useful on a push or a schedule, and there is
  // simply no pull request to comment on; saying so beats failing a job that did
  // exactly what it was asked to do.
  note('this event has no pull request, so there is nothing to comment on');
  process.exit(0);
}

const api = (process.env['GITHUB_API_URL'] ?? 'https://api.github.com').replace(/\/+$/, '');
const existing = await findOwnComment();

if (body.trim() === '') {
  if (existing === undefined) {
    // The required no-op: a clean run on a pull request this action has never
    // commented on writes nothing at all. A bot that greets every green pull
    // request trains the team to filter it out, and the filter does not spare the
    // red ones.
    note('nothing needs review and there is no previous comment; nothing was posted');
    process.exit(0);
  }

  // The one case where a clean run still writes. The docket sitting on this pull
  // request describes a run that has been superseded, and leaving it up is not
  // neutral — it is a stale finding presented as the current one, which is the
  // review-blindness failure with the tool's own name on it. Updating in place is
  // still one comment and still no new notification thread.
  await patch(existing.id, cleared(options.marker));
  note(`the previous docket no longer applies; comment ${existing.id} was cleared`);
  process.exit(0);
}

if (existing === undefined) {
  const created = await post(body);
  note(`posted comment ${created}`);
} else {
  await patch(existing.id, body);
  note(`updated comment ${existing.id} in place`);
}

/**
 * The comment this action wrote last time, if it is still there.
 *
 * Every page is read. Stopping early and concluding "none" would post a duplicate
 * — the failure this file exists to prevent — so an unreadable page or an
 * exhausted page budget is an error rather than a shrug.
 */
async function findOwnComment() {
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const comments = await request(
      'GET',
      `${api}/repos/${repository}/issues/${pull}/comments?per_page=${PER_PAGE}&page=${page}`,
    );

    if (!Array.isArray(comments)) {
      fail(`the comments endpoint returned ${typeof comments}, not a list`);
    }

    const found = comments.find(
      (comment) => typeof comment?.body === 'string' && comment.body.includes(options.marker),
    );
    if (found !== undefined) return found;

    if (comments.length < PER_PAGE) return undefined;
  }

  fail(
    `this pull request has more than ${MAX_PAGES * PER_PAGE} comments and no marker was found ` +
      'in them. Refusing to conclude that there is no previous comment, because that ' +
      'conclusion posts a duplicate.',
  );
}

async function post(text) {
  const created = await request(
    'POST',
    `${api}/repos/${repository}/issues/${pull}/comments`,
    { body: text },
  );
  return created?.id;
}

async function patch(id, text) {
  await request('PATCH', `${api}/repos/${repository}/issues/comments/${id}`, { body: text });
}

async function request(method, url, payload) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': API_VERSION,
        'user-agent': 'variance-authority-action',
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
  } catch (error) {
    fail(`${method} ${url} could not be sent: ${messageOf(error)}`);
  }

  if (response.status === 403 || response.status === 404) {
    // Almost always a token that cannot write here, and the usual cause is a
    // `pull_request` run from a fork, which gets a read-only token by design.
    // Warned rather than failed: the verdict still reaches the pull request as
    // the check's exit code, and turning an unfixable permission fact into a red
    // build teaches contributors that this check is noise. This action does not
    // use `pull_request_target`, which would hand a writable token to code from
    // the fork.
    warn(
      `${method} ${url} was refused (${response.status}). The token cannot write here. ` +
        'A `pull_request` run from a fork gets a read-only token; the docket is still in ' +
        "the check's exit code and in the run's artifacts.",
    );
    process.exit(0);
  }

  if (!response.ok) {
    fail(`${method} ${url} failed: ${response.status} ${await response.text()}`);
  }

  return response.status === 204 ? undefined : await response.json();
}

/** The body a superseded docket is replaced with. Short, and it says why it is here. */
function cleared(marker) {
  return [
    marker,
    '',
    '## Visual variance — nothing to review',
    '',
    'A later run on this branch found nothing that needs review, so the docket that was ' +
      'here no longer describes it. It was replaced rather than deleted: this action keeps ' +
      "exactly one comment per pull request, and deleting it would leave the check's " +
      'history with a gap nobody can account for.',
  ].join('\n');
}

/**
 * The pull request this run belongs to, from the event payload.
 *
 * `pull_request` carries it directly; `issue_comment` on a pull request carries
 * it as an issue. Anything else has none, and that is answered with a no-op
 * rather than a guess — a number inferred from a branch name would eventually
 * comment on somebody else's pull request.
 */
function pullRequestNumber() {
  const path = process.env['GITHUB_EVENT_PATH'];
  if (path === undefined || path === '') return undefined;

  let event;
  try {
    event = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`cannot read the event payload ${path}: ${messageOf(error)}`);
  }

  const number = event?.pull_request?.number ?? event?.issue?.number;
  return typeof number === 'number' ? number : undefined;
}

function parseArgs(argv) {
  const values = new Map();

  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!['--body-file', '--marker', '--pr'].includes(name)) {
      fail(`unknown argument \`${String(name)}\`; this takes --body-file, --marker, --pr`);
    }
    if (value === undefined) fail(`\`${name}\` needs a value`);
    values.set(name, value);
  }

  const bodyFile = values.get('--body-file');
  const marker = values.get('--marker');
  if (bodyFile === undefined || marker === undefined || marker === '') {
    fail('--body-file and --marker are both required; without a marker this cannot find its own comment');
  }

  const pr = values.get('--pr');
  return {
    bodyFile,
    marker,
    ...(pr === undefined || pr === '' ? {} : { pr: Number(pr) }),
  };
}

function note(message) {
  process.stdout.write(`variance: ${message}\n`);
}

function warn(message) {
  process.stdout.write(`::warning::variance: ${message}\n`);
}

// Annotations go to stdout. The runner's command parser is documented against a
// step's standard output, and an `::error::` written to stderr is at best an
// undocumented convenience — a message that renders as an annotation on one
// runner version and as grey log text on the next is a message nobody sees.
function fail(message) {
  process.stdout.write(`::error::variance: ${message}\n`);
  process.exit(2);
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
