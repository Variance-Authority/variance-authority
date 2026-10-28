import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { ACCEPT_LABEL, DOCKET_MARKER, FLOWS, NEEDS_REVIEW } from '../.github/scripts/outer-loop/flows.mjs';

/**
 * A local GitHub holding one example repository, and the review deployment
 * beside it, that answer the outer loop the way the example's workflow does:
 * a pull request gets its checks and comments as it opens, its build lands on
 * the deployment, the label starts a run. The deployment answers reads only.
 * `this repository`'s issues live here too, under `o/r`.
 *
 * Every reaction is immediate, so a wait ends on its first probe. What a
 * healthy example does is the default; each field of `Behaviour` breaks one
 * promise.
 */
export interface Behaviour {
  /** The gate's conclusion on the change's first run. Healthy: `failure`. */
  changeGate?: string;
  /** No check run ever appears. */
  silent?: boolean;
  /** The label's run commits the images back, but the commit gets no check. */
  unchecked?: boolean;
  /** The token may not see the example: every request for it is a 404. */
  denied?: boolean;
  /** The deployment records no build for the pull request's run. */
  unbuilt?: boolean;
}

type Json = Record<string, any>;

export interface Fake {
  url: string;
  requests: string[];
  pulls: Map<number, Json>;
  refs: Map<string, string>;
  issues: Json[];
  labels: string[];
}

const HOME = 'o/r';
const BASE = 'b'.repeat(40);
const SAMPLE: Record<string, string> = {
  'src/Panel.jsx': 'const style = { padding: 20, gap: 8 };\n',
  'site/pricing.html': '<p>$12 per seat</p>\n',
  'overlay/stories/ProductCard.stories.jsx': 'export const Control = { args: { product: products[0] } };\n',
  'README.md': '# example\n',
};

export async function fake(name: keyof typeof FLOWS, behaviour: Behaviour, servers: Server[]): Promise<Fake> {
  const flow: Json = FLOWS[name];
  const repo = `/repos/${flow.repository}`;
  const state: Fake = {
    url: '',
    requests: [],
    pulls: new Map(),
    refs: new Map([['main', BASE]]),
    issues: [],
    labels: [],
  };
  const commits = new Map<string, Json>();
  const runs = new Map<string, Json[]>();
  const annotations = new Map<number, Json[]>();
  const logs = new Map<number, string>();
  const comments = new Map<number, Json[]>();
  const builds: Json[] = [];
  let next = 1;
  let shas = 0;

  const check = (sha: string, check: string, conclusion: string, said: string[] = []) => {
    const id = next++;
    annotations.set(id, said.map((message) => ({ message })));
    runs.set(sha, [...(runs.get(sha) ?? []), { id, name: check, status: 'completed', conclusion, head_sha: sha }]);
    return id;
  };
  const comment = (pull: number, body: string) => comments.set(pull, [...(comments.get(pull) ?? []), { body }]);

  const opened = (pull: Json) => {
    const change = pull.head.ref.includes('/change-');
    const sha = pull.head.sha;
    if (behaviour.silent) return;
    const gate = change ? (behaviour.changeGate ?? 'failure') : 'success';
    check(sha, flow.gate, gate, gate === 'failure' ? [`${NEEDS_REVIEW}; the docket is in the pull request comment.`] : []);
    comment(
      pull.number,
      change && gate === 'failure'
        ? `${DOCKET_MARKER}\n## Visual variance — 1 subject(s) need review\n\n${flow.docket.map((d: string) => `\`${d}\``).join(' ')}\n`
        : `${DOCKET_MARKER}\n## Visual variance — nothing needs review\n`,
    );
    if (flow.unit !== undefined) {
      const unit = flow.unit;
      const id = check(sha, unit.check, 'success');
      const row = `| 🟢 | \`Panel\` | modified | [\`${unit.file}:3-10\`](x) | 1 | 1 | \`${unit.tests[0]}\` |`;
      const prose = `Not compared: \`${unit.untouched[0]}\` ran nothing this change touched.`;
      comment(pull.number, `${unit.might}\n### 🧭 What this change might do\n\n| | | | | | | |\n${change ? row : ''}\n\n${prose}\n`);
      comment(pull.number, `${unit.evidence}\n### Test evidence\n\n${change ? row : ''}\n\n${prose}\n`);
      logs.set(id, change ? `${unit.selected}\n ✓ ${unit.tests[0]} (1 test)\n` : 'variance-authority: selected none of 2\n');
    }
    if (flow.subjects !== undefined && !behaviour.unbuilt) {
      builds.push({
        build: `build-${pull.number}`,
        branch: pull.head.ref,
        pull: pull.number,
        subjects: [
          ...(change ? flow.subjects.map((subject: string) => ({ subject, verdict: 'changed', approvable: true })) : []),
          { subject: 'route/cart@1280', verdict: 'unchanged', approvable: false },
        ],
      });
    }
  };

  const labelled = (pull: Json) => {
    pull.labels = pull.labels.filter((l: Json) => l.name !== ACCEPT_LABEL);
    const sha = pull.head.sha;
    if (flow.accept === 'label') {
      check(sha, flow.gate, 'success');
      return;
    }
    check(sha, flow.gate, 'failure', [`${NEEDS_REVIEW}; the docket is in the pull request comment.`]);
    const back = `${'c'.repeat(39)}${++shas}`;
    const digest = '0123456789abcdef'.repeat(2);
    commits.set(back, {
      sha: back,
      author: { login: flow.commit.author },
      commit: { message: `${flow.commit.message}\n\nVariance-Run: 1` },
      parents: [{ sha }],
      files: [{ filename: `baselines/v1-${digest}/pricing.png` }, { filename: `baselines/v1-${digest}/pricing.json` }],
    });
    pull.head.sha = back;
    state.refs.set(pull.head.ref, back);
    if (!behaviour.unchecked) check(back, flow.gate, 'success');
  };

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const path = decodeURIComponent(url.pathname);
    const method = request.method ?? 'GET';
    state.requests.push(`${method} ${path}`);
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body: Json = raw === '' ? {} : JSON.parse(raw);
    const reply = (status: number, payload?: unknown) => {
      response.writeHead(status, { 'content-type': typeof payload === 'string' ? 'text/plain' : 'application/json' });
      response.end(payload === undefined ? '' : typeof payload === 'string' ? payload : JSON.stringify(payload));
    };
    const at = (pattern: string) => path.match(new RegExp(`^${pattern}$`));
    let m: RegExpMatchArray | null;

    if (path.startsWith(`/repos/${HOME}/`)) return home(method, path, body, url, reply);
    if (path.startsWith('/review/')) {
      if (method === 'GET' && path === '/review/builds') return reply(200, { builds });
      if (method === 'GET' && (m = at('/review/builds/([^/]+)'))) return reply(200, builds.find((b) => b.build === m![1]));
      return reply(404, { message: 'Not Found' });
    }
    if (!path.startsWith(repo) || behaviour.denied) return reply(404, { message: 'Not Found' });
    const rest = path.slice(repo.length);
    const r = (pattern: string) => rest.match(new RegExp(`^${pattern}$`));

    if (method === 'GET' && rest === '') return reply(200, { full_name: flow.repository, default_branch: 'main' });
    if (method === 'GET' && (m = r('/git/ref/heads/(.+)'))) return reply(200, { object: { sha: state.refs.get(m[1]) } });
    if (method === 'GET' && (m = r('/contents/(.+)'))) {
      return reply(200, { sha: `blob-${m[1]}`, content: Buffer.from(SAMPLE[m[1]] ?? '').toString('base64') });
    }
    if (method === 'POST' && rest === '/git/refs') {
      state.refs.set(body.ref.replace('refs/heads/', ''), body.sha);
      return reply(201, { ref: body.ref });
    }
    if (method === 'PUT' && (m = r('/contents/(.+)'))) {
      const sha = `${'a'.repeat(39)}${++shas}`;
      commits.set(sha, { sha, content: Buffer.from(body.content, 'base64').toString('utf8'), path: m[1] });
      state.refs.set(body.branch, sha);
      return reply(200, { commit: { sha } });
    }
    if (method === 'POST' && rest === '/pulls') {
      const number = state.pulls.size + 1;
      const pull = { number, state: 'open', labels: [], head: { ref: body.head, sha: state.refs.get(body.head) } };
      state.pulls.set(number, pull);
      opened(pull);
      return reply(201, { number });
    }
    if (method === 'GET' && rest === '/pulls') return reply(200, [...state.pulls.values()].filter((p) => p.state === 'open'));
    if ((m = r('/pulls/(\\d+)'))) {
      const pull = state.pulls.get(Number(m[1]))!;
      if (method === 'PATCH') pull.state = body.state;
      return reply(200, pull);
    }
    if (method === 'GET' && (m = r('/commits/([0-9a-f]+)/check-runs'))) return reply(200, { check_runs: runs.get(m[1]) ?? [] });
    if (method === 'GET' && (m = r('/commits/([0-9a-f]+)'))) return reply(200, commits.get(m[1]));
    if (method === 'GET' && (m = r('/check-runs/(\\d+)/annotations'))) return reply(200, annotations.get(Number(m[1])) ?? []);
    if (method === 'GET' && (m = r('/issues/(\\d+)/comments'))) return reply(200, comments.get(Number(m[1])) ?? []);
    if ((m = r('/issues/(\\d+)/labels'))) {
      const pull = state.pulls.get(Number(m[1]))!;
      if (method === 'POST') {
        pull.labels.push(...body.labels.map((name: string) => ({ name })));
        labelled(pull);
      }
      return reply(200, pull.labels);
    }
    if (method === 'GET' && (m = r('/actions/jobs/(\\d+)/logs'))) return reply(200, logs.get(Number(m[1])) ?? '');
    if (method === 'GET' && (m = r('/git/matching-refs/heads/(.+)'))) {
      return reply(200, [...state.refs.keys()].filter((ref) => ref.startsWith(m![1])).map((ref) => ({ ref: `refs/heads/${ref}` })));
    }
    if (method === 'DELETE' && (m = r('/git/refs/heads/(.+)'))) {
      return state.refs.delete(m[1]) ? reply(204) : reply(422, { message: 'Reference does not exist' });
    }
    return reply(404, { message: `the fake has no ${method} ${rest}` });
  });

  /** This repository's issues and labels, which `settle` writes to. */
  function home(method: string, path: string, body: Json, url: URL, reply: (status: number, payload?: unknown) => void) {
    const rest = path.slice(`/repos/${HOME}`.length);
    let m: RegExpMatchArray | null;
    if (method === 'GET' && (m = rest.match(/^\/labels\/(.+)$/))) {
      return state.labels.includes(m[1]) ? reply(200, { name: m[1] }) : reply(404, { message: 'Not Found' });
    }
    if (method === 'POST' && rest === '/labels') {
      state.labels.push(body.name);
      return reply(201, body);
    }
    if (method === 'GET' && rest === '/issues') {
      const label = url.searchParams.get('labels');
      return reply(200, state.issues.filter((i) => i.state === url.searchParams.get('state') && i.labels.includes(label)));
    }
    if (method === 'POST' && rest === '/issues') {
      const issue = { number: state.issues.length + 1, state: 'open', comments: [], ...body };
      state.issues.push(issue);
      return reply(201, issue);
    }
    if ((m = rest.match(/^\/issues\/(\d+)\/comments$/))) {
      state.issues[Number(m[1]) - 1].comments.push(body.body);
      return reply(201, {});
    }
    if (method === 'PATCH' && (m = rest.match(/^\/issues\/(\d+)$/))) {
      Object.assign(state.issues[Number(m[1]) - 1], body);
      return reply(200, {});
    }
    return reply(404, { message: `the fake has no ${method} ${rest}` });
  }

  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  state.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return state;
}
