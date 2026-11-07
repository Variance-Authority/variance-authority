#!/usr/bin/env node
//
// One comment on the pull request for each marker, updated in place.
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
// **A marker is one comment, and a repository may have several.** The renderer
// keys the marker by the config's `project`, so two gates on one pull request
// keep a comment each. Before that, every docket carried one marker that named
// no project, `UNKEYED`. With `--adopt-unkeyed true`, a comment carrying it is
// taken over, under `--marker`, when none carries `--marker` itself, so the
// upgrade does not leave the old docket beside the new one. Only the gate that
// wrote it adopts it: a gate that comments for the first time passes `false`,
// or it would take the other gate's docket and, on a clean run, clear it. The
// caller decides, and the action passes `true` unless its job says otherwise.
// No comment of another marker is ever touched.
//
// **Nothing is uploaded anywhere the operator did not configure.** The only
// network call is to the GitHub API of the instance this job is already running
// on, with the token the workflow passed in. No SDK, no dependency, no registry
// fetch — `fetch` and the REST API are enough, and a dependency here would be a
// third party with write access to every pull request.
//
// Usage:
//   node post-comment.mjs --body-file <path> --marker <string> \
//     --adopt-unkeyed <true|false> [--cleared-file <path>] [--pr <number>]

import { appendFileSync, readFileSync } from 'node:fs';
import { forge } from './forge.mjs';

/** The marker every docket carried before markers named the config's `project`. */
const UNKEYED = '<!-- variance-authority: pr-docket v1 -->';

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
      '`comment:` off where the action has it — this will not post anonymously and will not guess a credential.',
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

const { request, commentPages } = forge({ refused, fail });
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
  await patch(existing.id, clearedBody());
  note(`the previous docket no longer applies; comment ${existing.id} was cleared`);
  process.exit(0);
}

if (existing === undefined) {
  const created = await post(body);
  note(`posted comment ${created?.id}`);
  handOver(created);
} else {
  handOver(await patch(existing.id, body));
  note(`updated comment ${existing.id} in place`);
}

/**
 * The comment this action wrote last time, if it is still there, or else the
 * first one carrying {@link UNKEYED}, when it was told to adopt that.
 *
 * Every page is read. Stopping early and concluding "none" would post a duplicate
 * — the failure this file exists to prevent — so an unreadable page or an
 * exhausted page budget is an error rather than a shrug. A comment of its own on
 * a later page wins over an adoptable one on an earlier page.
 */
async function findOwnComment() {
  let adoptable;
  for await (const comments of commentPages(pull)) {
    const found = comments.find((comment) => carries(comment, options.marker));
    if (found !== undefined) return found;
    if (options.adoptUnkeyed) adoptable ??= comments.find((comment) => carries(comment, UNKEYED));
  }
  return adoptable;
}

function carries(comment, marker) {
  return typeof comment?.body === 'string' && comment.body.includes(marker);
}

async function post(text) {
  return request('POST', `issues/${pull}/comments`, { body: text });
}

async function patch(id, text) {
  return request('PATCH', `issues/comments/${id}`, { body: text });
}

/**
 * The address of the comment, as the step output `comment-url`, for the check's
 * error to link. Only a comment GitHub took has one: a run with no address has
 * no comment to send a reader to.
 */
function handOver(comment) {
  const output = process.env['GITHUB_OUTPUT'];
  if (output === undefined || output === '' || typeof comment?.html_url !== 'string') return;
  appendFileSync(output, `comment-url=${comment.html_url}\n`);
}

/** Almost always a token that cannot write here. */
function refused(method, url, status) {
  // The usual cause is a `pull_request` run from a fork, which gets a read-only
  // token by design. Warned rather than failed: a verdict still reaches the pull
  // request as the check's exit code, a review stays in the step summary, and
  // turning an unfixable permission fact into a red build teaches contributors
  // that this check is noise. This action does not use `pull_request_target`,
  // which would hand a writable token to code from the fork.
  warn(
    `${method} ${url} was refused (${status}). The token cannot write here. ` +
      'A `pull_request` run from a fork gets a read-only token; what the comment would have said is still in the run.',
  );
  process.exit(0);
}

/** What `variance comment --cleared` rendered: a clean run may only clear with its words. */
function clearedBody() {
  if (options.clearedFile === undefined) {
    fail('a previous docket needs clearing and there is no --cleared-file to clear it with');
  }
  try {
    return readFileSync(options.clearedFile, 'utf8');
  } catch (error) {
    fail(`cannot read the cleared comment ${options.clearedFile}: ${messageOf(error)}`);
  }
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
    if (!['--adopt-unkeyed', '--body-file', '--cleared-file', '--marker', '--pr'].includes(name)) {
      fail(`unknown argument \`${String(name)}\`; this takes --adopt-unkeyed, --body-file, --cleared-file, --marker, --pr`);
    }
    if (value === undefined) fail(`\`${name}\` needs a value`);
    values.set(name, value);
  }

  const bodyFile = values.get('--body-file');
  const marker = values.get('--marker');
  if (bodyFile === undefined || marker === undefined || marker === '') {
    fail('--body-file and --marker are both required; without a marker this cannot find its own comment');
  }

  // Asked every time, because neither answer is safe to assume: adopting takes
  // another gate's docket, and not adopting leaves the old one beside the new.
  const adopt = values.get('--adopt-unkeyed');
  if (adopt !== 'true' && adopt !== 'false') {
    fail(
      `--adopt-unkeyed takes true or false, not ${JSON.stringify(adopt ?? null)}: ` +
        'whether this gate wrote the docket from before markers named a project',
    );
  }

  const pr = values.get('--pr');
  return {
    bodyFile,
    clearedFile: values.get('--cleared-file'),
    marker,
    adoptUnkeyed: adopt === 'true',
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
