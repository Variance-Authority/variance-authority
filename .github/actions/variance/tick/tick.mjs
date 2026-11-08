#!/usr/bin/env node
//
// A tick in the docket accepts, in the name of whoever ticked it.
//
// A tick arrives as `issue_comment`, on the default branch: outside the pull
// request's cache scope, and on no check of its head. So the job it starts
// accepts nothing. `answer` decides whether the tick counts, replaces the box
// with a record of who ticked it, and reruns the job that wrote the box. A rerun
// replays its event with no inputs, so the record is the one thing that reaches
// it, and `read` finds it there and tells the action to accept.
//
// A tick that does not count is logged and writes nothing. No SDK and no
// dependency, for the reason `post-comment.mjs` gives.
//
// Usage:
//   node tick.mjs answer
//   node tick.mjs read --marker <string>

import { appendFileSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { forge, PER_PAGE } from '../forge.mjs';
import { BOX, box, boxIn } from './box.mjs';

/** Seconds between two looks at a run still going. */
const POLL_SECONDS = Number(process.env.VARIANCE_TICK_POLL_SECONDS ?? 15);

const WRITERS = new Set(['admin', 'write']);
const RECORD = /<!-- variance-accepted by=([A-Za-z0-9_-]+) head=([0-9a-f]{40}) run=(\d+) attempt=(\d+) -->/;

const record = (by, head, run, attempt) =>
  `Accepted by ${by} on \`${head.slice(0, 7)}\`; the check is running again. <!-- variance-accepted by=${by} head=${head} run=${run} attempt=${attempt} -->`;

const note = (message) => console.log(`variance: ${message}`);
const warn = (message) => console.log(`::warning::variance: ${message}`);

function fail(message) {
  console.log(`::error::variance: ${message}`);
  process.exit(2);
}

const { request, commentPages } = forge();

const event = () => JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));

/**
 * Why this event is not a person ticking the box of a bot's comment, if it is not.
 *
 * Only somebody with write access can edit a bot's comment, and GitHub keeps who
 * did in its edit history, but `answer` still asks the API: the author's type is
 * all this event proves.
 */
function notATick({ action, changes, comment, issue, sender }) {
  if (action !== 'edited' || !issue?.pull_request) return 'not an edit on a pull request';
  if (comment?.user?.type !== 'Bot') return 'not a comment a bot wrote';
  if (sender?.type === 'Bot') return 'edited by a bot';
  const before = boxIn(changes?.body?.from);
  const after = boxIn(comment.body);
  if (!before || !after || before.head !== after.head || before.job !== after.job) return 'no box changed';
  if (before.ticked || !after.ticked) return 'the box did not go from unticked to ticked';
  return undefined;
}

async function currentHead(number, head) {
  const pull = await request('GET', `pulls/${number}`);
  return pull.state === 'open' && pull.head.sha === head;
}

/** The run once it has stopped, since a rerun is refused while it goes. The job's `timeout-minutes` bounds this. */
async function finished(run) {
  let state = await request('GET', `actions/runs/${run}`);
  while (state.status !== 'completed') {
    note(`waiting for run ${run} to finish.`);
    await sleep(POLL_SECONDS * 1000);
    state = await request('GET', `actions/runs/${run}`);
  }
  return state;
}

/** The job called `name` in the run's latest attempt, which lists every job in the run. */
async function latestJob(run, name) {
  for (let page = 1; ; page += 1) {
    const { jobs } = await request('GET', `actions/runs/${run}/jobs?per_page=${PER_PAGE}&page=${page}`);
    const found = jobs.find((candidate) => candidate.name === name);
    if (found || jobs.length < PER_PAGE) return found;
  }
}

async function answer() {
  const payload = event();
  const reason = notATick(payload);
  if (reason) return note(`nothing to accept: ${reason}.`);

  const by = payload.sender.login;
  const number = payload.issue.number;
  const { head, job } = boxIn(payload.comment.body);
  const stale = `the box belongs to ${head.slice(0, 7)}, and the pull request has moved on or closed; nothing accepted.`;

  if (!(await currentHead(number, head))) return note(stale);
  const { permission } = await request('GET', `collaborators/${by}/permission`);
  if (!WRITERS.has(permission)) return note(`@${by} has ${permission} access, not write; nothing accepted.`);

  const { run_id: run, name } = await request('GET', `actions/jobs/${job}`);
  for (;;) {
    const state = await finished(run);
    if (!(await currentHead(number, head))) return note(stale);
    const comment = await request('GET', `issues/comments/${payload.comment.id}`);
    const still = boxIn(comment.body);
    if (!still?.ticked || still.head !== head || still.job !== job) return note('the box is no longer ticked; nothing accepted.');

    // A job has a new id in each attempt, and a second box in this run may have
    // started one since this box was written.
    const latest = await latestJob(run, name);
    if (!latest) throw new Error(`run ${run} has no job ${name} to rerun`);

    await request('PATCH', `issues/comments/${comment.id}`, {
      body: comment.body.replace(BOX, record(by, head, run, state.run_attempt)),
    });
    try {
      await request('POST', `actions/jobs/${latest.id}/rerun`);
      console.log(`::notice::variance: accepted by @${by} on ${head.slice(0, 7)}; run ${run} is running again.`);
      return undefined;
    } catch (error) {
      // The record names an attempt that will not follow it, and says something
      // that did not happen. A run going again is another box's rerun, won first.
      await request('PATCH', `issues/comments/${comment.id}`, { body: comment.body });
      if ((await request('GET', `actions/runs/${run}`)).status === 'completed') throw error;
    }
  }
}

/**
 * Who ticked for the attempt before this one, in the comment carrying `marker`.
 *
 * Only that attempt's record counts, so re-running a job by hand accepts nothing,
 * and only a bot's comment, since anybody can paste a record into their own.
 */
async function tickedBy(number, head, marker) {
  const run = process.env.GITHUB_RUN_ID;
  const attempt = String(Number(process.env.GITHUB_RUN_ATTEMPT) - 1);
  for await (const comments of commentPages(number)) {
    for (const comment of comments) {
      if (comment.user?.type !== 'Bot' || !comment.body?.includes(marker)) continue;
      const found = RECORD.exec(comment.body);
      if (found && found[2] === head && found[3] === run && found[4] === attempt) return found[1];
    }
  }
  return undefined;
}

async function read() {
  const flag = process.argv.indexOf('--marker');
  const marker = flag < 0 ? undefined : process.argv[flag + 1];
  if (!marker) fail('tick.mjs read needs --marker.');

  const { pull_request: pull } = event();
  const job = process.env.VARIANCE_TICK_JOB;
  const output = (key, value) => appendFileSync(process.env.GITHUB_OUTPUT, `${key}<<__variance__\n${value}\n__variance__\n`);
  if (job) output('box', box(pull.head.sha, job));
  if (Number(process.env.GITHUB_RUN_ATTEMPT) < 2) return;

  try {
    const by = await tickedBy(pull.number, pull.head.sha, marker);
    if (!by) return;
    output('accept', 'true');
    output('by', by);
    output('intent', `${pull.title} — accepted: ticked by @${by}`);
    console.log(`::notice::variance: accepting: ticked by @${by}`);
  } catch (error) {
    warn(`could not read the docket, so this run only compares: ${error.message}`);
  }
}

const command = process.argv[2];
if (command === 'answer') await answer().catch((error) => fail(`the tick was not answered: ${error.message}`));
else if (command === 'read') await read();
else fail(`tick.mjs takes answer or read, not ${command}.`);
