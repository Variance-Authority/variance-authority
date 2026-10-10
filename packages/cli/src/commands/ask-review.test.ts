import { describe, expect, it } from 'vitest';
import { REVIEW_TOOLS } from '@variance-authority/mcp/tools';
import type { Config } from '../config.js';
import { OperatorError } from '../exit.js';
import { ask } from './ask.js';
import { reviewSubject } from './ask-review.js';

/**
 * `variance ask decisions`, and the `variance_decisions` tool behind it: what
 * reviewers decided, read from the deployment `review` names with the share
 * token, and nothing that could decide.
 */

const [decisions, concerns] = REVIEW_TOOLS;
const DEPLOYMENT = 'https://tribunal.example';

const CONFIG = {
  project: 'design-system',
  retention: 'durable',
  review: { endpoint: `${DEPLOYMENT}/`, token: () => 'ingest-secret' },
  share: { kind: 'http', endpoint: `${DEPLOYMENT}/share`, token: () => 'share-secret' },
} as unknown as Config;

const HISTORY = {
  decisions: [
    { build: 'ci-2', subject: 'story:a', decision: 'rejected', by: 'marina', at: '2026-06-03T10:00:00.000Z' },
    { build: 'ci-1', subject: 'story:a', decision: 'approved', by: 'marina', at: '2026-06-02T10:00:00.000Z' },
  ],
};

function answering(status: number, body: unknown) {
  const asked: { url: string; method: string; authorization: string | null }[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    asked.push({
      url: String(url),
      method: init?.method ?? 'GET',
      authorization: new Headers(init?.headers).get('authorization'),
    });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof globalThis.fetch;
  return { asked, fetch };
}

describe('the decisions a deployment recorded', () => {
  it('are read from the review deployment with the share token, never the ingest one', async () => {
    const { asked, fetch } = answering(200, HISTORY);
    const read = await reviewSubject(CONFIG, decisions, { subject: 'story:a', build: 'ci-1' }, fetch);
    expect(asked).toEqual([
      {
        url: `${DEPLOYMENT}/review/decisions?subject=story%3Aa&build=ci-1&limit=20`,
        method: 'GET',
        authorization: 'Bearer share-secret',
      },
    ]);
    expect(read).toEqual({ from: DEPLOYMENT, decisions: HISTORY.decisions });
  });

  it('are refused, by name, where no share is stored at the deployment', async () => {
    const { asked, fetch } = answering(200, HISTORY);
    const alone = { ...CONFIG, share: { kind: 'directory', root: '/tmp/share' } } as unknown as Config;
    await expect(reviewSubject(alone, decisions, { subject: 'story:a' }, fetch)).rejects.toThrow(/share token/);
    expect(asked).toEqual([]);
  });

  it('are refused, naming the deployment to declare, where the config declares only a share', async () => {
    const { asked, fetch } = answering(200, HISTORY);
    const shareOnly = { project: 'design-system', retention: 'durable', share: CONFIG.share } as unknown as Config;
    await expect(reviewSubject(shareOnly, decisions, { subject: 'story:a' }, fetch)).rejects.toThrow(
      /names no deployment: declare it as `"review": \{ "endpoint"/,
    );
    expect(asked).toEqual([]);
  });

  it('answer `variance ask decisions --subject --build`, through the same tool the server mounts', async () => {
    const { fetch } = answering(200, HISTORY);
    const answer = await ask({
      question: 'decisions',
      subject: 'story:a',
      build: 'ci-2',
      report: 'unused.json',
      read: () => Promise.reject(new Error('a decision is not read from a report')),
      review: (tool, input) => reviewSubject(CONFIG, tool, input, fetch),
    });
    expect(answer).toBe(`${decisions.run({ from: DEPLOYMENT, decisions: HISTORY.decisions as never }, { subject: 'story:a', build: 'ci-2' })}\n`);
    expect(answer).toContain('2026-06-03T10:00:00.000Z  rejected  story:a  ci-2  marina');
  });

  it('are refused without a config, which names the deployment and the token', async () => {
    await expect(
      ask({
        question: 'concerns',
        build: 'ci-1',
        report: 'unused.json',
        read: () => Promise.reject(new Error('a concern is not read from a report')),
      }),
    ).rejects.toThrow(/`concerns` needs a config: it names the deployment and the share token/);
    await expect(
      ask({
        question: 'decisions',
        subject: 'story:a',
        report: 'unused.json',
        read: () => Promise.reject(new Error('a decision is not read from a report')),
      }),
    ).rejects.toThrow(/`decisions` needs a config: it names the deployment and the share token/);
  });
});

const FLAGGED = {
  concerns: [
    {
      id: 3,
      build: 'ci-1',
      subject: 'story:a',
      title: 'The border is clipped',
      evidence: ['CartSummary.tsx:84'],
      by: 'marina',
      at: '2026-06-01T10:00:00.000Z',
      state: 'open',
      events: [{ state: 'open', by: 'marina', at: '2026-06-01T10:00:00.000Z', note: 'the right edge is cut' }],
    },
  ],
  tally: { open: 1, investigating: 0, resolved: 0 },
};

describe('the concerns reviewers raised', () => {
  it('are read from the same deployment, with the same share token, by the same reader', async () => {
    const { asked, fetch } = answering(200, FLAGGED);
    const read = await reviewSubject(CONFIG, concerns, { build: 'ci-1', state: 'open' }, fetch);
    expect(asked).toEqual([
      { url: `${DEPLOYMENT}/review/concerns?build=ci-1&state=open`, method: 'GET', authorization: 'Bearer share-secret' },
    ]);
    expect(read).toEqual({ from: DEPLOYMENT, ...FLAGGED });
  });

  it('are refused before anything is sent when the call names neither a subject nor a build', async () => {
    const { asked, fetch } = answering(200, FLAGGED);
    await expect(reviewSubject(CONFIG, concerns, { state: 'open' }, fetch)).rejects.toThrow(/needs a `subject` or a `build`/);
    expect(asked).toEqual([]);
  });

  it('answer `variance ask concerns --build --state`, through the same tool the server mounts', async () => {
    const { fetch } = answering(200, FLAGGED);
    const answer = await ask({
      question: 'concerns',
      build: 'ci-1',
      state: 'open',
      report: 'unused.json',
      read: () => Promise.reject(new Error('a concern is not read from a report')),
      review: (tool, input) => reviewSubject(CONFIG, tool, input, fetch),
    });
    expect(answer).toContain('  #3  open  story:a  ci-1  "The border is clipped"');
    expect(answer).toContain('      evidence CartSummary.tsx:84');
  });

  it('refuse a call that names neither a subject nor a build as the operator’s, not as a defect', async () => {
    const { asked, fetch } = answering(200, FLAGGED);
    const asking = ask({
      question: 'concerns',
      state: 'open',
      report: 'unused.json',
      read: () => Promise.reject(new Error('a concern is not read from a report')),
      review: (tool, input) => reviewSubject(CONFIG, tool, input, fetch),
    });
    await expect(asking).rejects.toBeInstanceOf(OperatorError);
    await expect(asking).rejects.toThrow(/needs a `subject` or a `build`/);
    expect(asked).toEqual([]);
  });
});
