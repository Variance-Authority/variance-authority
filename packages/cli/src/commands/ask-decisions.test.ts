import { describe, expect, it } from 'vitest';
import { REVIEW_TOOLS } from '@variance-authority/mcp/tools';
import type { Config } from '../config.js';
import { ask } from './ask.js';
import { decisionsSubject } from './ask-decisions.js';

/**
 * `variance ask decisions`, and the `variance_decisions` tool behind it: what
 * reviewers decided, read from the deployment `review` names with the share
 * token, and nothing that could decide.
 */

const [decisions] = REVIEW_TOOLS;
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
    const read = await decisionsSubject(CONFIG, { subject: 'story:a', build: 'ci-1' }, fetch);
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
    await expect(decisionsSubject(alone, {}, fetch)).rejects.toThrow(/share token/);
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
      decisions: (input) => decisionsSubject(CONFIG, input, fetch),
    });
    expect(answer).toBe(`${decisions.run({ from: DEPLOYMENT, decisions: HISTORY.decisions as never }, { subject: 'story:a', build: 'ci-2' })}\n`);
    expect(answer).toContain('2026-06-03T10:00:00.000Z  rejected  story:a  ci-2  marina');
  });
});
