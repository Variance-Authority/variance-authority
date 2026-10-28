// After a flow's run, whatever became of it: sweep what a cancelled run left
// open in the example, and say the outcome where somebody will read it — one
// issue per flow in this repository, opened or updated while the flow fails and
// closed when it passes again.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { branchPrefix } from './drive.mjs';
import { FLOWS } from './flows.mjs';
import { client, Refusal } from './github.mjs';

export const ISSUE_LABEL = 'outer-loop-e2e';

/** The one issue a flow's failures collect on. */
export function issueTitle(name) {
  return `Outer loop: the ${name} review flow is failing`;
}

/** Where `outer-loop.mjs run` leaves the sentences a failure said. */
export function failureFile(env, name) {
  return join(env.RUNNER_TEMP ?? '.', `outer-loop-${name}.txt`);
}

/**
 * Settles the flow `name` after a run whose step concluded `outcome`
 * (`success`, `failure`, `cancelled` or `skipped`). Returns the sentences that
 * went wrong while settling, empty when nothing did.
 *
 * A failure is filed before the sweep, because a job stopped by its own timeout
 * starts nothing after this step; a pass is filed after it, so a failed sweep
 * does not close the issue. Nobody cancels a scheduled run by hand, so one that
 * ended cancelled ran out of the job's time and is filed as a failure; a
 * dispatched run cancelled is a person's decision and files nothing.
 */
export async function settle(name, outcome, env, log = console.log) {
  const flow = FLOWS[name];
  if (flow === undefined) throw new Refusal(`OUTER_LOOP_FLOW is '${name ?? ''}'; it is one of ${Object.keys(FLOWS).join(', ')}`);
  const api = env.GITHUB_API_URL ?? 'https://api.github.com';
  const problems = [];
  const attempt = async (what, act) => {
    try {
      await act();
    } catch (error) {
      problems.push(`${what}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const home = () => client({ base: api, token: env.GITHUB_TOKEN, secret: 'GITHUB_TOKEN' });

  const timedOut = outcome === 'cancelled' && env.GITHUB_EVENT_NAME === 'schedule';
  if (outcome === 'failure' || timedOut) {
    await attempt('reporting', () => report(home(), env, name, timedOut ? 'cancelled' : outcome, log));
  }

  if (env.VARIANCE_PUSH_TOKEN) {
    const gh = client({ base: api, token: env.VARIANCE_PUSH_TOKEN, secret: 'VARIANCE_PUSH_TOKEN' });
    await attempt(`sweeping ${flow.repository}`, () => sweep(gh, flow.repository, name, log, attempt));
  }

  if (outcome === 'success') await attempt('reporting', () => report(home(), env, name, outcome, log));
  return problems;
}

/** Closes every pull request and deletes every branch a run of this flow opened, each on its own. */
async function sweep(gh, repo, name, log, attempt) {
  const prefix = branchPrefix(name);
  const pulls = await gh('GET', `/repos/${repo}/pulls?state=open&per_page=100`);
  for (const pull of pulls.filter((p) => p.head.ref.startsWith(prefix))) {
    await attempt(`closing #${pull.number}`, async () => {
      await gh('PATCH', `/repos/${repo}/pulls/${pull.number}`, { body: { state: 'closed' } });
      log(`${name}: closed #${pull.number}, left open by an earlier step`);
    });
  }
  const refs = await gh('GET', `/repos/${repo}/git/matching-refs/heads/${prefix}`);
  for (const ref of refs) {
    await attempt(`deleting ${ref.ref}`, async () => {
      await gh('DELETE', `/repos/${repo}/git/${ref.ref}`);
      log(`${name}: deleted ${ref.ref}, left by an earlier step`);
    });
  }
}

async function report(gh, env, name, outcome, log) {
  const repo = env.GITHUB_REPOSITORY;
  const runUrl = `${env.GITHUB_SERVER_URL ?? 'https://github.com'}/${repo}/actions/runs/${env.GITHUB_RUN_ID}`;
  const title = issueTitle(name);
  const open = await gh('GET', `/repos/${repo}/issues?state=open&labels=${ISSUE_LABEL}&per_page=100`);
  const issue = open.find((i) => i.pull_request === undefined && i.title === title);

  if (outcome === 'success') {
    if (issue === undefined) return;
    await gh('POST', `/repos/${repo}/issues/${issue.number}/comments`, {
      body: { body: `The ${name} review flow passes again in ${runUrl}.` },
    });
    await gh('PATCH', `/repos/${repo}/issues/${issue.number}`, { body: { state: 'closed', state_reason: 'completed' } });
    log(`${name}: closed #${issue.number}`);
    return;
  }

  const file = failureFile(env, name);
  const said = existsSync(file)
    ? readFileSync(file, 'utf8').trim()
    : outcome === 'cancelled'
      ? "the scheduled job was cancelled before the flow finished, which is its timeout: a request or a wait outlasted the job's minutes; read its log"
      : 'the run step wrote no failure, so something outside it stopped it: its timeout or the runner; read its log';
  const body = `The ${name} review flow failed in ${runUrl}:\n\n\`\`\`\n${said}\n\`\`\`\n`;
  if (issue !== undefined) {
    await gh('POST', `/repos/${repo}/issues/${issue.number}/comments`, { body: { body } });
    log(`${name}: commented on #${issue.number}`);
    return;
  }
  await ensureLabel(gh, repo);
  const created = await gh('POST', `/repos/${repo}/issues`, {
    body: {
      title,
      labels: [ISSUE_LABEL],
      body:
        `The weekly outer loop drives the ${name} review flow against ${FLOWS[name].repository}, and it ` +
        `failed. Each failing run comments here; the first run that passes closes this issue.\n\n${body}`,
    },
  });
  log(`${name}: opened #${created.number}`);
}

async function ensureLabel(gh, repo) {
  try {
    await gh('GET', `/repos/${repo}/labels/${ISSUE_LABEL}`);
  } catch (error) {
    if (!(error instanceof Refusal && error.status === 404)) throw error;
    await gh('POST', `/repos/${repo}/labels`, {
      body: { name: ISSUE_LABEL, color: 'b60205', description: 'A review flow the weekly outer loop drives is failing' },
    });
  }
}
