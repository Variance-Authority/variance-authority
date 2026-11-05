import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { commentMarker, renderComment } from '@variance-authority/cli';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * A tick in the docket accepts in the name of whoever ticked it.
 *
 * A tick arrives as `issue_comment`, on the default branch, outside the pull
 * request's cache scope and its check. So the tick job only decides, and hands
 * over: it leaves a record in the comment and reruns the job that wrote the box.
 * The rerun is the pull request's own run, replayed, and the record is the one
 * thing that reaches it.
 *
 * Driven as the runner drives it, a process against a GitHub API, here a local
 * one holding one pull request, one comment and one run.
 */

const ROOT = resolve(import.meta.dirname, '..');
const SCRIPT = join(ROOT, '.github/actions/variance/tick/tick.mjs');
const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const JOB = 55;
const RUN = 77;
const MARKER = commentMarker('tribunal');
const box = (mark: string, head = HEAD) =>
  `- [${mark}] Accept this change <!-- variance-tick head=${head} job=${JOB} -->`;
const docket = (mark: string, head = HEAD) => `${MARKER}\n\n## Visual variance\n\nTo accept: tick the box.\n\n${box(mark, head)}\n`;

interface Repo {
  comment: { id: number; body: string; user: { type: string } };
  permission: string;
  head: string;
  /** The pull request's state, `closed` once merged. */
  state: string;
  /** What the run answers, in order; the last one repeats. */
  statuses: string[];
  attempt: number;
  /** The id the job has in the run's latest attempt; each attempt gives it a new one. */
  latestJob: number;
  /** A run with more jobs than one page holds, the job on the second. */
  crowded?: boolean;
  /** A head the pull request moves to while the run is being waited for. */
  pushed?: string;
  /** Reruns refused before one is taken, as GitHub refuses one while another goes. */
  refusals?: number;
  /** A pull request whose every page of comments is full. */
  endless?: boolean;
  calls: string[];
  url: string;
}

const made: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise((done) => server.close(done));
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function github(overrides: Partial<Repo> = {}): Promise<Repo> {
  const repo: Repo = {
    comment: { id: 9, body: docket('x'), user: { type: 'Bot' } },
    permission: 'write',
    head: HEAD,
    state: 'open',
    statuses: ['completed'],
    attempt: 1,
    latestJob: JOB,
    calls: [],
    url: '',
    ...overrides,
  };
  const server = createServer((request, response) => {
    let text = '';
    request.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8');
    });
    request.on('end', () => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const path = url.pathname;
      repo.calls.push(`${request.method} ${path}`);
      const reply = (status: number, payload?: unknown) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(payload === undefined ? undefined : JSON.stringify(payload));
      };
      if (path === '/repos/o/r/pulls/7') return reply(200, { state: repo.state, head: { sha: repo.head } });
      if (path.startsWith('/repos/o/r/collaborators/')) return reply(200, { permission: repo.permission });
      if (path === `/repos/o/r/actions/jobs/${JOB}` && request.method === 'GET') return reply(200, { run_id: RUN, name: 'gate (tribunal)' });
      if (path === `/repos/o/r/actions/runs/${RUN}/jobs`) {
        if (repo.crowded && url.searchParams.get('page') !== '2') {
          return reply(200, { jobs: Array.from({ length: 100 }, (_, id) => ({ id, name: `gate (${id})` })) });
        }
        return reply(200, { jobs: [{ id: 1, name: 'gate (site)' }, { id: repo.latestJob, name: 'gate (tribunal)' }] });
      }
      if (path === `/repos/o/r/actions/runs/${RUN}`) {
        if (repo.pushed) repo.head = repo.pushed;
        const status = repo.statuses.length > 1 ? repo.statuses.shift() : repo.statuses[0];
        return reply(200, { status, run_attempt: repo.attempt });
      }
      if (path === `/repos/o/r/actions/jobs/${repo.latestJob}/rerun`) {
        if (repo.refusals) {
          repo.refusals -= 1;
          return reply(403, { message: 'This workflow is already running' });
        }
        return reply(201, {});
      }
      if (path === '/repos/o/r/issues/7/comments' && repo.endless) {
        return reply(200, Array.from({ length: 100 }, (_, id) => ({ id, body: 'a reviewer said something', user: { type: 'User' } })));
      }
      if (path === '/repos/o/r/issues/7/comments') return reply(200, [{ id: 1, body: 'a reviewer said something', user: { type: 'User' } }, repo.comment]);
      if (path === '/repos/o/r/issues/comments/9') {
        if (request.method === 'PATCH') repo.comment.body = (JSON.parse(text) as { body: string }).body;
        return reply(200, repo.comment);
      }
      return reply(404, { message: 'Not Found' });
    });
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  repo.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return repo;
}

async function tick(
  repo: Repo,
  command: readonly string[],
  event: unknown,
  env: Record<string, string> = {},
): Promise<{ code: number | null; out: string; outputs: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'va-tick-'));
  made.push(dir);
  const eventPath = join(dir, 'event.json');
  const outputs = join(dir, 'output');
  await writeFile(eventPath, JSON.stringify(event), 'utf8');
  await writeFile(outputs, '', 'utf8');
  const child = spawn('node', [SCRIPT, ...command], {
    cwd: ROOT,
    env: {
      PATH: process.env['PATH'],
      GITHUB_API_URL: repo.url,
      GITHUB_REPOSITORY: 'o/r',
      GITHUB_TOKEN: 'token',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_OUTPUT: outputs,
      VARIANCE_TICK_POLL_SECONDS: '0',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (chunk: Buffer) => {
    out += chunk.toString('utf8');
  });
  child.stderr.on('data', (chunk: Buffer) => {
    out += chunk.toString('utf8');
  });
  const code = await new Promise<number | null>((done) => child.on('close', done));
  return { code, out, outputs: await readFile(outputs, 'utf8') };
}

/** The event GitHub sends when `sender` edits the comment from `from` to the comment's body. */
function edited(repo: Repo, from: string, sender = { login: 'ana', type: 'User' }) {
  return {
    action: 'edited',
    changes: { body: { from } },
    comment: repo.comment,
    issue: { number: 7, pull_request: {} },
    sender,
  };
}

const rerun = `POST /repos/o/r/actions/jobs/${JOB}/rerun`;

describe('a tick', () => {
  it('leaves a record naming the person and reruns the job that wrote the box', async () => {
    const repo = await github({ attempt: 2 });

    const { code, out } = await tick(repo, ['answer'], edited(repo, docket(' ')));

    expect(code).toBe(0);
    expect(out).toContain('accepted by @ana');
    expect(repo.comment.body).toContain('Accepted by ana');
    expect(repo.comment.body).toContain(`<!-- variance-accepted by=ana head=${HEAD} run=${RUN} attempt=2 -->`);
    expect(repo.comment.body).not.toContain('variance-tick');
    expect(repo.calls).toContain(rerun);
  });

  it('counts for somebody the API calls an admin', async () => {
    const repo = await github({ permission: 'admin' });

    await tick(repo, ['answer'], edited(repo, docket(' ')));

    expect(repo.calls).toContain(rerun);
  });

  it('waits for the run to finish, because a rerun is refused while it goes', async () => {
    const repo = await github({ statuses: ['in_progress', 'in_progress', 'completed'] });

    await tick(repo, ['answer'], edited(repo, docket(' ')));

    const asked = repo.calls.filter((call) => call === `GET /repos/o/r/actions/runs/${RUN}`);
    expect(asked).toHaveLength(3);
    expect(repo.calls.indexOf(rerun)).toBeGreaterThan(repo.calls.lastIndexOf(asked[0]!));
  });

  it('reruns nothing when the box was unticked during that wait', async () => {
    const repo = await github({ statuses: ['in_progress', 'completed'] });
    const event = edited(repo, docket(' '));
    repo.comment = { ...repo.comment, body: docket(' ') };

    const { out } = await tick(repo, ['answer'], event);

    expect(out).toContain('no longer ticked');
    expect(repo.calls).not.toContain(rerun);
  });

  it('reruns the job as the run knows it now, after another box in that run started a new attempt', async () => {
    const repo = await github({ attempt: 2, latestJob: 66 });

    const { code } = await tick(repo, ['answer'], edited(repo, docket(' ')));

    expect(code).toBe(0);
    expect(repo.calls).toContain('POST /repos/o/r/actions/jobs/66/rerun');
  });

  it('finds the job past the first page of a crowded run', async () => {
    const repo = await github({ crowded: true });

    const { code } = await tick(repo, ['answer'], edited(repo, docket(' ')));

    expect(code).toBe(0);
    expect(repo.calls).toContain(rerun);
  });

  it('accepts nothing on a push that landed during that wait', async () => {
    const repo = await github({ pushed: OLD });

    await tick(repo, ['answer'], edited(repo, docket(' ')));

    expect(repo.calls).not.toContain(rerun);
    expect(repo.calls.filter((call) => call.startsWith('PATCH'))).toEqual([]);
  });

  it('keeps a login with an underscore, which a managed account has', async () => {
    const repo = await github();

    await tick(repo, ['answer'], edited(repo, docket(' '), { login: 'ana_acme', type: 'User' }));
    const { outputs } = await tick(repo, ['read', '--marker', MARKER], {
      pull_request: { number: 7, title: 'Move a button', head: { sha: HEAD } },
    }, { GITHUB_RUN_ID: String(RUN), GITHUB_RUN_ATTEMPT: '2', VARIANCE_TICK_JOB: '56' });

    expect(outputs).toContain('ticked by @ana_acme');
  });

  it('accepts nothing for somebody without write access, and says why', async () => {
    for (const permission of ['read', 'triage', 'none']) {
      const repo = await github({ permission });

      const { code, out } = await tick(repo, ['answer'], edited(repo, docket(' '), { login: 'eve', type: 'User' }));

      expect(code).toBe(0);
      expect(out).toContain('@eve');
      expect(out).toContain(permission);
      expect(repo.calls).not.toContain(rerun);
      expect(repo.calls.filter((call) => call.startsWith('PATCH'))).toEqual([]);
    }
  });

  it('counts only a box going from unticked to ticked', async () => {
    const unticking = await github({ comment: { id: 9, body: docket(' '), user: { type: 'Bot' } } });
    await tick(unticking, ['answer'], edited(unticking, docket('x')));
    expect(unticking.calls).toEqual([]);

    const leftAlone = await github();
    await tick(leftAlone, ['answer'], edited(leftAlone, docket('x').replace('tick the box', 'a word')));
    expect(leftAlone.calls).toEqual([]);

    const noBox = await github();
    await tick(noBox, ['answer'], edited(noBox, `${MARKER}\n`));
    expect(noBox.calls).toEqual([]);
  });

  it('counts only on a comment a bot wrote, and only from a person', async () => {
    const spoofed = await github({ comment: { id: 9, body: docket('x'), user: { type: 'User' } } });
    await tick(spoofed, ['answer'], edited(spoofed, docket(' ')));
    expect(spoofed.calls).toEqual([]);

    const robot = await github();
    await tick(robot, ['answer'], edited(robot, docket(' '), { login: 'some-app[bot]', type: 'Bot' }));
    expect(robot.calls).toEqual([]);
  });

  it('accepts nothing against a head the pull request has left', async () => {
    const repo = await github({ comment: { id: 9, body: docket('x', OLD), user: { type: 'Bot' } } });

    const { out } = await tick(repo, ['answer'], edited(repo, docket(' ', OLD)));

    expect(out).toContain(OLD.slice(0, 7));
    expect(repo.calls).not.toContain(rerun);
  });
});

describe('a tick on a pull request already closed', () => {
  it('accepts nothing, though the head has not moved', async () => {
    const repo = await github({ state: 'closed' });

    await tick(repo, ['answer'], edited(repo, docket(' ')));

    expect(repo.calls).not.toContain(rerun);
    expect(repo.comment.body).not.toContain('Accepted by');
  });
});

describe('a tick that loses the race for the rerun', () => {
  it('waits for the rerun that beat it, and writes the attempt it really follows', async () => {
    // Two rows' dockets ticked at once: both find the run finished, and one rerun wins.
    const repo = await github({ statuses: ['completed', 'in_progress', 'completed'], refusals: 1 });

    await tick(repo, ['answer'], edited(repo, docket(' ')));

    expect(repo.calls.filter((call) => call === rerun)).toHaveLength(2);
    expect(repo.comment.body).toContain('variance-accepted by=ana');
  });

  it('puts the box back when the rerun is refused for good, so the comment claims nothing', async () => {
    const repo = await github({ refusals: 1 });

    const { code } = await tick(repo, ['answer'], edited(repo, docket(' ')));

    expect(code).toBe(2);
    expect(repo.comment.body).toContain(box('x'));
    expect(repo.comment.body).not.toContain('Accepted by');
  });
});

describe('the run a tick restarted', () => {
  const pull = { pull_request: { number: 7, title: 'Move a button', head: { sha: HEAD } } };
  const record = (attempt: number, head = HEAD, run = RUN) =>
    `${MARKER}\n\nAccepted by ana on \`aaaaaaa\`. <!-- variance-accepted by=ana head=${head} run=${run} attempt=${attempt} -->\n`;
  const env = (attempt: number) => ({ GITHUB_RUN_ID: String(RUN), GITHUB_RUN_ATTEMPT: String(attempt), VARIANCE_TICK_JOB: '56' });
  const read = ['read', '--marker', MARKER];

  it('accepts on the record the attempt before it left, and names the person', async () => {
    const repo = await github({ comment: { id: 9, body: record(1), user: { type: 'Bot' } } });

    const { out, outputs } = await tick(repo, read, pull, env(2));

    expect(outputs).toContain('accept<<__variance__\ntrue\n');
    expect(outputs).toContain('intent<<__variance__\nMove a button — accepted: ticked by @ana\n');
    expect(outputs).toContain('by<<__variance__\nana\n');
    expect(out).toContain('accepting: ticked by @ana');
  });

  it('says so, rather than concluding there was no tick, when the comments outrun what it reads', async () => {
    const repo = await github({ endless: true });

    const { out, outputs } = await tick(repo, read, pull, env(2));

    expect(outputs).not.toContain('accept<<');
    expect(out).toContain('could not read the docket');
  });

  it('accepts nothing on a re-run with no record for the attempt before it', async () => {
    const repo = await github({ comment: { id: 9, body: record(1), user: { type: 'Bot' } } });

    expect((await tick(repo, read, pull, env(3))).outputs).not.toContain('accept<<');
  });

  it('accepts nothing on a record of another head, another run, or a comment no bot wrote', async () => {
    for (const comment of [
      { id: 9, body: record(1, OLD), user: { type: 'Bot' } },
      { id: 9, body: record(1, HEAD, 78), user: { type: 'Bot' } },
      { id: 9, body: record(1), user: { type: 'User' } },
    ]) {
      const repo = await github({ comment });

      expect((await tick(repo, read, pull, env(2))).outputs).not.toContain('accept<<');
    }
  });

  it('asks nothing of GitHub on a first attempt, and offers a box bound to its head and job', async () => {
    const repo = await github();

    const { outputs } = await tick(repo, read, pull, env(1));

    expect(repo.calls).toEqual([]);
    expect(outputs).toContain(`box<<__variance__\n- [ ] Accept this change <!-- variance-tick head=${HEAD} job=56 -->\n`);
  });

  it('offers no box when the job has no id to rerun', async () => {
    const repo = await github();

    const { outputs } = await tick(repo, read, pull, { ...env(1), VARIANCE_TICK_JOB: '' });

    expect(outputs).not.toContain('box<<');
  });

  it('writes a box that survives the docket and that the answer recognises', async () => {
    const repo = await github();
    const { outputs } = await tick(repo, read, pull, { ...env(1), VARIANCE_TICK_JOB: String(JOB) });
    const line = /^- \[ \].*$/m.exec(outputs)?.[0] ?? '';
    const before = renderComment({
      project: 'tribunal',
      toAccept: `tick the box below.\n\n${line}`,
      report: {
        runVersion: 1,
        at: '2026-08-01T10:00:00.000Z',
        identity: { renderer: 'playwright-chromium', engine: 'chromium@131', platform: 'linux/x64', deviceScaleFactor: 1, fonts: [] },
        retention: 'durable',
        observations: [{ subject: 'story:a', verdict: 'changed', because: 'pixels differ', changedPixels: 9, regions: [], images: { after: 'a.png' } }],
        notObserved: [],
      },
    });

    repo.comment.body = before.replace('- [ ]', '- [x]');
    await tick(repo, ['answer'], edited(repo, before));

    expect(repo.calls).toContain(rerun);
  });
});
