import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { jobMinutes } from '../.github/scripts/outer-loop/drive.mjs';
import { DOCKET_MARKER, FLOWS, NEEDS_REVIEW } from '../.github/scripts/outer-loop/flows.mjs';
import { buildProblems, changeProblems, commitProblems } from '../.github/scripts/outer-loop/observe.mjs';
import { fake, type Behaviour } from './outer-loop.fake.js';

/**
 * The outer loop opens real pull requests in the example repositories, so its
 * own test is a dry run: the script, spawned as the workflow spawns it, against
 * a local GitHub that answers the way each example's workflow does. A healthy
 * example passes; each way an example can break a promise fails the run with a
 * sentence naming it; and whatever happened, nothing is left open.
 */

const ROOT = resolve(import.meta.dirname, '..');
const SCRIPT = join(ROOT, '.github/scripts/outer-loop.mjs');

const made: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise((done) => server.close(done));
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function outerLoop(
  command: 'run' | 'settle',
  flow: string,
  url: string,
  extra: Record<string, string> = {},
  temp?: string,
): Promise<{ code: number | null; out: string; temp: string }> {
  const dir = temp ?? (await mkdtemp(join(tmpdir(), 'outer-loop-')));
  if (temp === undefined) made.push(dir);
  // Only what the workflow sets: a run inside GitHub Actions must not lend
  // this test its own GITHUB_* variables.
  const env = {
    PATH: process.env.PATH ?? '',
    GITHUB_API_URL: url,
    GITHUB_REPOSITORY: 'o/r',
    GITHUB_RUN_ID: '42',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_TOKEN: 'home-token',
    RUNNER_TEMP: dir,
    OUTER_LOOP_FLOW: flow,
    OUTER_LOOP_TRIBUNAL: url,
    OUTER_LOOP_WAIT_SECONDS: '0.4',
    OUTER_LOOP_BUDGET_SECONDS: '10',
    OUTER_LOOP_POLL_SECONDS: '0.1',
    VARIANCE_PUSH_TOKEN: 'push-token',
    ...extra,
  };
  const child = spawn(process.execPath, [SCRIPT, command], { env, cwd: ROOT });
  let out = '';
  child.stdout.on('data', (chunk) => (out += chunk));
  child.stderr.on('data', (chunk) => (out += chunk));
  const code = await new Promise<number | null>((done) => child.on('close', done));
  return { code, out, temp: dir };
}

async function drive(flow: keyof typeof FLOWS, behaviour: Behaviour = {}, extra: Record<string, string> = {}) {
  const github = await fake(flow, behaviour, servers);
  const result = await outerLoop('run', flow, github.url, extra);
  return { github, ...result };
}

function leftOpen(github: Awaited<ReturnType<typeof fake>>) {
  return {
    pulls: [...github.pulls.values()].filter((p) => p.state === 'open').map((p) => p.number),
    branches: [...github.refs.keys()].filter((ref) => ref !== 'main'),
  };
}

describe('the outer loop against a healthy example', () => {
  it.each(['cache', 'lfs'] as const)('drives the %s flow to green and leaves nothing open', async (flow) => {
    const { github, code, out } = await drive(flow);
    expect(out).toContain('the change is red for review and the control is green');
    expect(code).toBe(0);
    expect(github.pulls.size).toBe(2);
    expect(leftOpen(github)).toEqual({ pulls: [], branches: [] });
  });

  it('accepts the cache flow with the label', async () => {
    const { github } = await drive('cache');
    expect(github.requests).toContain('POST /repos/Variance-Authority/example-storybook/issues/1/labels');
    expect(github.requests.filter((r) => r.includes('/issues/2/labels'))).toEqual([]);
  });

  // An approval on the deployment replaces the baseline `main` and every branch
  // compare against, so it is a merge: the flow reads the build and the red
  // check, and closes.
  it('observes the tribunal flow, never approves, and leaves nothing open', async () => {
    const { github, code, out } = await drive('tribunal');
    expect(out).toContain('the change is red for review and the control is green');
    expect(out).toContain('the deployment holds one build for the change');
    expect(code).toBe(0);
    expect(github.requests.filter((r) => r.includes('/review/') && !r.startsWith('GET '))).toEqual([]);
    expect(github.requests.filter((r) => /\/rerun$|\/dispatches$|\/labels$|\/merge$/.test(r))).toEqual([]);
    expect(leftOpen(github)).toEqual({ pulls: [], branches: [] });
  });

  it('fails the tribunal flow when the deployment holds no build for the change, and still closes', async () => {
    const { github, code, out } = await drive('tribunal', { unbuilt: true });
    expect(code).toBe(1);
    expect(out).toMatch(/holds 0 builds for outer-loop\/tribunal\/change-42-1, not one/);
    expect(leftOpen(github)).toEqual({ pulls: [], branches: [] });
  });
});

describe('the outer loop against an example that breaks a promise', () => {
  it('fails when the change leaves the gate green, and still closes both pull requests', async () => {
    const { github, code, out } = await drive('cache', { changeGate: 'success' });
    expect(code).toBe(1);
    expect(out).toContain('::error::check `variance` concluded success, expected failure');
    expect(leftOpen(github)).toEqual({ pulls: [], branches: [] });
    expect(github.requests.some((r) => r.endsWith('/labels'))).toBe(false);
  });

  it('times out, bounded, when no check ever finishes, and cleans up', async () => {
    const { github, code, out } = await drive('lfs', { silent: true });
    expect(code).toBe(1);
    expect(out).toMatch(/timed out after 0\.4s: Variance-Authority\/example-static-site never completed `variance`/);
    expect(leftOpen(github)).toEqual({ pulls: [], branches: [] });
  });

  it("ends at the flow's budget even when each wait would allow more", async () => {
    const { github, code, out } = await drive(
      'lfs',
      { silent: true },
      { OUTER_LOOP_WAIT_SECONDS: '30', OUTER_LOOP_BUDGET_SECONDS: '0.4' },
    );
    expect(code).toBe(1);
    expect(out).toMatch(/timed out after 0\.[0-4]s, at the end of the flow's budget: /);
    expect(leftOpen(github)).toEqual({ pulls: [], branches: [] });
  });

  it('gives the flow the minutes it can spend, and settle ten more after it', async () => {
    const workflow = await readFile(join(ROOT, '.github/workflows/outer-loop.yml'), 'utf8');
    const job = Number(/^ {4}timeout-minutes: (\d+)$/m.exec(workflow)?.[1]);
    const step = Number(/^ {8}timeout-minutes: (\d+)$/m.exec(workflow)?.[1]);
    expect(step).toBe(Math.max(...Object.keys(FLOWS).map((name) => jobMinutes(name))));
    expect(job).toBe(step + 10);
  });

  it('names the push token when the accept commit gets no check', async () => {
    const { code, out } = await drive('lfs', { unchecked: true });
    expect(code).toBe(1);
    expect(out).toContain('Set VARIANCE_PUSH_TOKEN there to a token with contents: write');
  });

  it('names the secret and the permission when the token may not see the example', async () => {
    const { code, out } = await drive('cache', { denied: true });
    expect(code).toBe(1);
    expect(out).toContain(
      'VARIANCE_PUSH_TOKEN needs contents and pull requests: write, and actions: read, on Variance-Authority/example-storybook',
    );
  });

  it('refuses before asking anything when the push token is missing', async () => {
    const { github, code, out } = await drive('cache', {}, { VARIANCE_PUSH_TOKEN: '' });
    expect(code).toBe(1);
    expect(out).toContain('::error::VARIANCE_PUSH_TOKEN is not set');
    expect(github.requests).toEqual([]);
  });
});

describe('settling a flow', () => {
  it('files a failure before it sweeps, so the job timeout cannot take the report', async () => {
    const github = await fake('cache', {}, servers);
    await outerLoop('settle', 'cache', github.url, { OUTER_LOOP_OUTCOME: 'failure' });
    const filed = github.requests.indexOf('POST /repos/o/r/issues');
    const swept = github.requests.findIndex((r) => r.includes('/git/matching-refs/'));
    expect(filed).toBeGreaterThanOrEqual(0);
    expect(filed).toBeLessThan(swept);
  });

  it('opens one issue on a failure, comments on it on the next, and closes it on a pass', async () => {
    const github = await fake('cache', {}, servers);
    const temp = await mkdtemp(join(tmpdir(), 'outer-loop-'));
    made.push(temp);
    await writeFile(join(temp, 'outer-loop-cache.txt'), 'check `variance` concluded success, expected failure\n');

    expect((await outerLoop('settle', 'cache', github.url, { OUTER_LOOP_OUTCOME: 'failure' }, temp)).code).toBe(0);
    expect(github.labels).toEqual(['outer-loop-e2e']);
    expect(github.issues).toHaveLength(1);
    expect(github.issues[0].title).toBe('Outer loop: the cache review flow is failing');
    expect(github.issues[0].body).toContain('concluded success, expected failure');

    await outerLoop('settle', 'cache', github.url, { OUTER_LOOP_OUTCOME: 'failure' }, temp);
    expect(github.issues).toHaveLength(1);
    expect(github.issues[0].comments).toHaveLength(1);

    await outerLoop('settle', 'cache', github.url, { OUTER_LOOP_OUTCOME: 'success' }, temp);
    expect(github.issues[0].state).toBe('closed');
    expect(github.issues[0].state_reason).toBe('completed');
  });

  it('files nothing for a cancelled run, and closes only what the flow left open', async () => {
    const github = await fake('tribunal', {}, servers);
    github.refs.set('outer-loop/tribunal/change-7-1', 'a'.repeat(40));
    github.pulls.set(1, { number: 1, state: 'open', labels: [], head: { ref: 'outer-loop/tribunal/change-7-1' } });
    github.pulls.set(2, { number: 2, state: 'open', labels: [], head: { ref: 'somebody-else' } });

    const { code } = await outerLoop('settle', 'tribunal', github.url, { OUTER_LOOP_OUTCOME: 'cancelled' });
    expect(code).toBe(0);
    expect(github.pulls.get(1)!.state).toBe('closed');
    expect(github.pulls.get(2)!.state).toBe('open');
    expect([...github.refs.keys()]).toEqual(['main']);
    expect(github.requests.filter((r) => r.endsWith('/dispatches'))).toEqual([]);
    expect(github.issues).toEqual([]);
  });

  it('files a scheduled run that was cancelled as a failure: nothing cancels it but its timeout', async () => {
    const github = await fake('cache', {}, servers);
    const dispatched = await outerLoop('settle', 'cache', github.url, {
      OUTER_LOOP_OUTCOME: 'cancelled',
      GITHUB_EVENT_NAME: 'workflow_dispatch',
    });
    expect(dispatched.code).toBe(0);
    expect(github.issues).toEqual([]);

    const scheduled = await outerLoop('settle', 'cache', github.url, {
      OUTER_LOOP_OUTCOME: 'cancelled',
      GITHUB_EVENT_NAME: 'schedule',
    });
    expect(scheduled.code).toBe(0);
    expect(github.issues).toHaveLength(1);
    expect(github.issues[0].body).toContain('cancelled before the flow finished, which is its timeout');
  });
});

describe('what a consumer sees, held against the flow', () => {
  const cache = FLOWS.cache;
  const row = (test: string) => `| 🟢 | \`Panel\` | modified | [\`src/Panel.jsx:3-10\`](x) | 1 | 1 | \`${test}\` |`;
  const seen = (might: string) => ({
    checks: { variance: { conclusion: 'failure' }, tests: { conclusion: 'success' } },
    annotations: { variance: [{ message: `${NEEDS_REVIEW}; see the comment` }], tests: [] },
    comments: [
      { body: `${DOCKET_MARKER}\n## Visual variance — 1 subject(s) need review\n\`panel--settings\` \`src/Panel.jsx\`` },
      { body: `${cache.unit.might}\n${might}` },
      { body: `${cache.unit.evidence}\n${row('src/Panel.test.jsx')}` },
    ],
    logs: { tests: 'variance-authority: selected 1 of 2\n ✓ src/Panel.test.jsx (1 test)' },
  });

  it('reads the selection from table rows, not from prose that names a test it did not run', () => {
    const prose = `${row('src/Panel.test.jsx')}\n\nNot compared: \`src/Button.test.jsx\` ran nothing.`;
    expect(changeProblems(cache, seen(prose))).toEqual([]);
    expect(changeProblems(cache, seen(`${row('src/Panel.test.jsx')}\n${row('src/Button.test.jsx')}`))).toEqual([
      'the might-do comment names `src/Button.test.jsx`, which the change does not reach',
    ]);
  });

  it('holds the accept commit to the released layout and the change it sits on', () => {
    const commit = (files: string[]) => ({
      author: { login: 'github-actions[bot]' },
      commit: { message: 'chore(variance): regenerate baselines\n\nVariance-Run: 3' },
      parents: [{ sha: 'p' }],
      files: files.map((filename) => ({ filename })),
    });
    const digest = 'f'.repeat(32);
    const right = [`baselines/v1-${digest}/pricing.png`, `baselines/v1-${digest}/pricing.json`];
    expect(commitProblems(FLOWS.lfs, commit(right), 'p')).toEqual([]);
    expect(commitProblems(FLOWS.lfs, commit([...right, `baselines/v1-${digest}/checkout.png`]), 'q')).toEqual([
      'the accept commit\'s parent is p, not the change q',
      `the accept commit touches \`baselines/v1-${digest}/checkout.png\`, which the change did not reach`,
    ]);
  });

  it('holds the deployment to exactly the declared subjects', () => {
    const subjects = FLOWS.tribunal.subjects.slice(1).map((subject) => ({ subject, verdict: 'changed', approvable: true }));
    expect(buildProblems(FLOWS.tribunal, { build: 'b', subjects })).toEqual([
      `the build b changed [${FLOWS.tribunal.subjects.slice(1).join(', ')}], expected [${FLOWS.tribunal.subjects.join(', ')}]`,
    ]);
  });

  it('is read back from the failure file settle reads', async () => {
    const github = await fake('cache', { changeGate: 'success' }, servers);
    const { temp } = await outerLoop('run', 'cache', github.url);
    expect(await readFile(join(temp, 'outer-loop-cache.txt'), 'utf8')).toContain('expected failure');
  });
});
