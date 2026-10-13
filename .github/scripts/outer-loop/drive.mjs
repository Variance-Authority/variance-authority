// One flow, end to end, against its example repository: open a pull request
// that changes what a subject renders and one that changes nothing, watch both
// react, accept the change the way that flow accepts, watch the check turn
// green, and close both whatever happened.
//
// The order is the same for every flow. Both pull requests are opened and read
// before anything is accepted, so the control is judged against the baselines
// as they were — a tribunal approval moves the deployment's baselines for every
// branch, and would otherwise race the control's run.

import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ACCEPT_LABEL, CONTROL, FLOWS } from './flows.mjs';
import { client, Refusal, until } from './github.mjs';
import { acceptedProblems, buildProblems, changeProblems, commitProblems, controlProblems } from './observe.mjs';

/** Where a run that approved on the deployment leaves word that `main` needs its render back. */
export function restoreMarker(env, name) {
  return join(env.RUNNER_TEMP ?? '.', `outer-loop-${name}.restore`);
}

/** The prefix every branch this flow opens starts with, so a later sweep finds them. */
export function branchPrefix(name) {
  return `outer-loop/${name}/`;
}

/** What the push token must be allowed on the example repository. */
export function pushNeeds(flow) {
  return `contents, pull requests and actions: write on ${flow.repository}`;
}

/**
 * Refuses before anything is opened: an unknown flow, or a secret the flow
 * cannot start without, named with what it has to be allowed.
 */
export function preflight(name, env) {
  const flow = FLOWS[name];
  if (flow === undefined) {
    throw new Refusal(`OUTER_LOOP_FLOW is '${name ?? ''}'; it is one of ${Object.keys(FLOWS).join(', ')}`);
  }
  if (!env.VARIANCE_PUSH_TOKEN) {
    throw new Refusal(
      `VARIANCE_PUSH_TOKEN is not set. The outer loop opens, labels, re-runs and closes pull ` +
        `requests in ${flow.repository} with it, so it needs ${pushNeeds(flow)}`,
    );
  }
  if (flow.accept === 'decision' && !env.VARIANCE_REVIEW_TOKEN) {
    throw new Refusal(
      `VARIANCE_REVIEW_TOKEN is not set. It is the REVIEW_TOKEN of ${flow.endpoint}, which ` +
        `approves the changed subjects the way a reviewer does on the build page`,
    );
  }
  return flow;
}

/**
 * Drives the flow `name`. Resolves when every promise held; otherwise throws a
 * Refusal whose message lists every one that broke, and what cleaning up could
 * not undo.
 */
export async function drive(name, env, log = console.log) {
  const flow = preflight(name, env);
  const repo = flow.repository;
  const api = env.GITHUB_API_URL ?? 'https://api.github.com';
  const gh = client({ base: api, token: env.VARIANCE_PUSH_TOKEN, secret: 'VARIANCE_PUSH_TOKEN' });
  const wait = {
    seconds: Number(env.OUTER_LOOP_WAIT_SECONDS) || flow.minutes * 60,
    every: Number(env.OUTER_LOOP_POLL_SECONDS) || 15,
  };
  const run = `${env.GITHUB_RUN_ID ?? 'local'}-${env.GITHUB_RUN_ATTEMPT ?? '1'}`;
  const runUrl = env.GITHUB_RUN_ID
    ? `${env.GITHUB_SERVER_URL ?? 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
    : 'a local run';
  const made = { pulls: [], branches: [], approved: false };
  const context = { name, flow, repo, gh, wait, run, runUrl, made, log, env };

  let failure;
  try {
    await sequence(context);
  } catch (error) {
    failure = error;
  }
  const leftovers = await cleanUp(context);
  if (failure === undefined && leftovers.length === 0) return;
  const said = failure instanceof Refusal ? failure.message : failure?.stack;
  throw new Refusal(
    [said, ...(leftovers.length === 0 ? [] : ['Cleaning up also failed:', ...leftovers])]
      .filter(Boolean)
      .join('\n'),
  );
}

async function sequence(context) {
  const { name, flow, repo, gh, log } = context;
  const needs = pushNeeds(flow);
  const about = await gh('GET', `/repos/${repo}`, { needs });
  const base = about.default_branch;
  const baseSha = (await gh('GET', `/repos/${repo}/git/ref/heads/${base}`, { needs })).object.sha;
  context.base = base;
  log(`${name}: ${repo} at ${base} ${baseSha}`);

  const change = await openPull(context, base, baseSha, 'change', flow.change);
  const control = await openPull(context, base, baseSha, 'control', CONTROL);
  log(`${name}: opened #${change.number} (the change) and #${control.number} (the control)`);

  const seen = new Set();
  const changed = await read(context, change, seen, { unit: true });
  const quiet = await read(context, control, seen, { unit: false });
  const head = (await gh('GET', `/repos/${repo}/pulls/${control.number}`)).head.sha;
  const problems = [
    ...changeProblems(flow, changed),
    ...controlProblems(flow, { ...quiet, head, opened: control.sha }),
  ];
  if (problems.length > 0) throw new Refusal(problems.join('\n'));
  log(`${name}: the change is red for review and the control is green`);

  const accepted = await ACCEPTS[flow.accept](context, change, changed, seen);
  const after = acceptedProblems(flow, accepted.run, accepted.annotations);
  if (after.length > 0) throw new Refusal(after.join('\n'));
  log(`${name}: accepted, and \`${flow.gate}\` is green on ${accepted.run.head_sha}`);
}

/** A branch from the base with one edit on it, and a pull request from it. */
async function openPull(context, base, baseSha, role, edit) {
  const { name, repo, gh, run, runUrl, made, flow } = context;
  const needs = pushNeeds(flow);
  const branch = `${branchPrefix(name)}${role}-${run}`;
  const path = edit.path.split('/').map(encodeURIComponent).join('/');
  const file = await gh('GET', `/repos/${repo}/contents/${path}?ref=${baseSha}`, { needs });
  const text = Buffer.from(file.content, 'base64').toString('utf8');
  const next = edit.append === undefined ? replaceOnce(text, edit, repo) : `${text}${edit.append}`;

  await gh('POST', `/repos/${repo}/git/refs`, { body: { ref: `refs/heads/${branch}`, sha: baseSha }, needs });
  made.branches.push(branch);
  const put = await gh('PUT', `/repos/${repo}/contents/${path}`, {
    body: {
      message: `outer loop: the ${role} for the ${name} review flow`,
      content: Buffer.from(next, 'utf8').toString('base64'),
      sha: file.sha,
      branch,
    },
    needs,
  });
  const pull = await gh('POST', `/repos/${repo}/pulls`, {
    body: {
      title: `outer loop: ${name} review flow, the ${role}`,
      head: branch,
      base,
      body:
        `The variance-authority outer loop opened this pull request from ${runUrl} to watch the ` +
        `${name} review flow react to ${role === 'change' ? 'a change a subject renders' : 'a change no subject reaches'}. ` +
        `It is closed without merging when that run ends.`,
    },
    needs,
  });
  made.pulls.push(pull.number);
  return { number: pull.number, sha: put.commit.sha, branch };
}

function replaceOnce(text, edit, repo) {
  const count = text.split(edit.from).length - 1;
  if (count !== 1) {
    throw new Refusal(
      `${repo}:${edit.path} holds \`${edit.from}\` ${count} times, not once; flows.mjs follows the example`,
    );
  }
  return text.replace(edit.from, edit.to);
}

/** Every check of the flow, completed on `sha`, and what a consumer reads beside them. */
async function read(context, pull, seen, { unit }) {
  const { flow, repo, gh } = context;
  const checks = await completed(context, pull.sha, flow.checks, seen);
  const annotations = {};
  for (const [name, run] of Object.entries(checks)) {
    annotations[name] = await gh('GET', `/repos/${repo}/check-runs/${run.id}/annotations?per_page=100`);
  }
  const comments = await gh('GET', `/repos/${repo}/issues/${pull.number}/comments?per_page=100`);
  const logs = {};
  if (unit && flow.unit !== undefined) {
    // An Actions check run's id is its job's id.
    logs[flow.unit.check] = await gh('GET', `/repos/${repo}/actions/jobs/${checks[flow.unit.check].id}/logs`, {
      raw: true,
      needs: `actions: read on ${repo}`,
    });
  }
  return { checks, annotations, comments, logs };
}

/**
 * The first completed run of each named check on `sha` that `seen` does not
 * hold yet, all of them or none: a later accept is told apart from the run
 * before it by its id.
 */
async function completed(context, sha, names, seen) {
  const { repo, gh, wait } = context;
  const found = await until(
    async () => {
      const page = await gh('GET', `/repos/${repo}/commits/${sha}/check-runs?filter=all&per_page=100`);
      const runs = {};
      for (const name of names) {
        const done = page.check_runs.find((r) => r.name === name && !seen.has(r.id) && r.status === 'completed');
        if (done === undefined) return undefined;
        runs[name] = done;
      }
      return runs;
    },
    { ...wait, waiting: `${repo} never completed ${names.map((n) => `\`${n}\``).join(', ')} on ${sha}` },
  );
  for (const run of Object.values(found)) seen.add(run.id);
  return found;
}

async function gate(context, sha, seen) {
  const { flow, repo, gh } = context;
  const run = (await completed(context, sha, [flow.gate], seen))[flow.gate];
  const annotations = await gh('GET', `/repos/${repo}/check-runs/${run.id}/annotations?per_page=100`);
  return { run, annotations };
}

async function label(context, pull) {
  const { repo, gh, flow } = context;
  await gh('POST', `/repos/${repo}/issues/${pull.number}/labels`, {
    body: { labels: [ACCEPT_LABEL] },
    needs: pushNeeds(flow),
  });
}

const ACCEPTS = {
  // The label's run promotes what it renders, and takes the label off again.
  async label(context, change, _changed, seen) {
    const { repo, gh } = context;
    await label(context, change);
    const accepted = await gate(context, change.sha, seen);
    const labels = await gh('GET', `/repos/${repo}/issues/${change.number}/labels`);
    if (labels.some((l) => l.name === ACCEPT_LABEL)) {
      throw new Refusal(`the \`${ACCEPT_LABEL}\` label is still on #${change.number} after its run`);
    }
    return accepted;
  },

  // The label's run commits the accepted images to the branch and stays red,
  // because it found the change it committed; the commit's own run is the
  // green one.
  async commit(context, change, _changed, seen) {
    const { flow, repo, gh, wait } = context;
    await label(context, change);
    const labelled = await gate(context, change.sha, seen);
    const moved = await until(
      async () => {
        const sha = (await gh('GET', `/repos/${repo}/pulls/${change.number}`)).head.sha;
        return sha === change.sha ? undefined : sha;
      },
      {
        ...wait,
        waiting: `no commit reached ${change.branch} after the label; its run concluded ${labelled.run.conclusion}`,
      },
    );
    const commit = await gh('GET', `/repos/${repo}/commits/${moved}`);
    const problems = commitProblems(flow, commit, change.sha);
    if (problems.length > 0) throw new Refusal(problems.join('\n'));
    try {
      return await gate(context, moved, seen);
    } catch (error) {
      if (error instanceof Refusal && error.message.startsWith('timed out')) {
        throw new Refusal(`${error.message}. ${flow.unchecked}`);
      }
      throw error;
    }
  },

  // A reviewer's decision on the deployment, then the check run again.
  async decision(context, change, changed, seen) {
    const { flow, repo, gh, env, runUrl, made, name } = context;
    const endpoint = env.OUTER_LOOP_TRIBUNAL || flow.endpoint;
    const reader = client({ base: endpoint, github: false });
    const decider = client({
      base: endpoint,
      token: env.VARIANCE_REVIEW_TOKEN,
      secret: 'VARIANCE_REVIEW_TOKEN',
      github: false,
    });
    const { builds } = await reader('GET', '/review/builds?limit=50');
    const ours = builds.filter((b) => b.branch === change.branch);
    if (ours.length !== 1) {
      throw new Refusal(
        `${endpoint} holds ${ours.length} builds for ${change.branch}, not one: the check's push step ` +
          `records exactly one per run`,
      );
    }
    const id = encodeURIComponent(ours[0].build);
    const build = await reader('GET', `/review/builds/${id}`);
    const problems = buildProblems(flow, build);
    if (problems.length > 0) throw new Refusal(problems.join('\n'));

    // From the first decision on, `main`'s baselines on the deployment are
    // this branch's; clean-up gives them back.
    made.approved = true;
    writeFileSync(restoreMarker(env, name), `${runUrl}\n`);
    for (const subject of flow.subjects) {
      await decider('POST', `/review/builds/${id}/subjects/${encodeURIComponent(subject)}/decision`, {
        body: { decision: 'approved', by: 'outer-loop', note: `the outer loop, from ${runUrl}` },
        needs: `the REVIEW_TOKEN of ${endpoint}`,
      });
    }
    const job = await gh('GET', `/repos/${repo}/actions/jobs/${changed.checks[flow.gate].id}`);
    await gh('POST', `/repos/${repo}/actions/runs/${job.run_id}/rerun`, { needs: `actions: write on ${repo}` });
    return gate(context, change.sha, seen);
  },
};

/** Closes what was opened, deletes what was pushed, and gives `main` back its render. */
async function cleanUp(context) {
  const { repo, gh, made, flow, name, log } = context;
  const leftovers = [];
  const attempt = async (what, act) => {
    try {
      await act();
    } catch (error) {
      leftovers.push(`${what}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  for (const number of made.pulls) {
    await attempt(`closing #${number}`, () => gh('PATCH', `/repos/${repo}/pulls/${number}`, { body: { state: 'closed' } }));
  }
  for (const branch of made.branches) {
    await attempt(`deleting ${branch}`, async () => {
      try {
        await gh('DELETE', `/repos/${repo}/git/refs/heads/${branch}`);
      } catch (error) {
        if (!(error instanceof Refusal && error.status === 422)) throw error;
      }
    });
  }
  if (made.pulls.length + made.branches.length > 0) {
    log(`${name}: closed ${made.pulls.length} pull requests and deleted ${made.branches.length} branches`);
  }
  if (made.approved && flow.restore !== undefined) {
    await attempt(`restoring ${context.base}`, () => restore(context));
  }
  return leftovers;
}

/**
 * Dispatches the example's accept on its default branch and waits for it: the
 * deployment's approvals are not scoped to a branch, so the change's approval
 * moved `main`'s baselines too.
 */
export async function restore(context, { waitFor = true } = {}) {
  const { flow, repo, gh, wait, env, name, log } = context;
  const base = context.base ?? (await gh('GET', `/repos/${repo}`)).default_branch;
  const { workflow, inputs } = flow.restore;
  const runs = `/repos/${repo}/actions/workflows/${workflow}/runs?event=workflow_dispatch&branch=${base}&per_page=20`;
  const before = new Set((await gh('GET', runs)).workflow_runs.map((r) => r.id));
  await gh('POST', `/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
    body: { ref: base, inputs },
    needs: `actions: write on ${repo}`,
  });
  // Dispatched once: a second dispatch would be a retry.
  rmSync(restoreMarker(env, name), { force: true });
  log(`${name}: dispatched ${workflow} on ${base} to give it back its own render`);
  if (!waitFor) return;
  const started = await until(async () => (await gh('GET', runs)).workflow_runs.find((r) => !before.has(r.id)), {
    ...wait,
    waiting: `the ${workflow} dispatch on ${base} never started`,
  });
  const done = await until(
    async () => {
      const r = await gh('GET', `/repos/${repo}/actions/runs/${started.id}`);
      return r.status === 'completed' ? r : undefined;
    },
    { ...wait, waiting: `${workflow} on ${base} (${started.html_url}) never finished` },
  );
  if (done.conclusion !== 'success') {
    throw new Refusal(
      `${workflow} on ${base} concluded ${done.conclusion} (${done.html_url}), so ${base}'s ` +
        `baselines on the deployment still hold what the change rendered`,
    );
  }
}

/** Whether a run that approved left `main` without its render. */
export function needsRestore(env, name) {
  return existsSync(restoreMarker(env, name));
}
