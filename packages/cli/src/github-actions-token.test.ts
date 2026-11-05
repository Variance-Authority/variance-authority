import { describe, expect, it, vi } from 'vitest';
import { githubActionsToken } from './github-actions-token.js';

const ENV = { ACTIONS_ID_TOKEN_REQUEST_URL: 'https://actions.example/token?api-version=2.0', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'runner-held' };

function jwt(exp: number): string {
  const part = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'RS256' })}.${part({ exp })}.signature`;
}

function issuing(...exps: number[]) {
  const asked: { url: string; authorization: string | null }[] = [];
  let at = 0;
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    asked.push({ url: String(url), authorization: new Headers(init?.headers).get('authorization') });
    return Response.json({ value: jwt(exps[at++] ?? 0) });
  }) as unknown as typeof globalThis.fetch;
  return { asked, fetch };
}

describe('the token the runner issues', () => {
  it('asks the runner for this audience, with the runner’s own credential', async () => {
    const { asked, fetch } = issuing(2_000);

    await githubActionsToken('https://t.example', 'review.token', { env: ENV, fetch, now: () => 1_000_000 })();

    expect(new URL(asked[0]?.url ?? '').searchParams.get('audience')).toBe('https://t.example');
    expect(new URL(asked[0]?.url ?? '').searchParams.get('api-version')).toBe('2.0');
    expect(asked[0]?.authorization).toBe('Bearer runner-held');
  });

  it('keeps a token until it is near its expiry, then asks again', async () => {
    const { asked, fetch } = issuing(1_300, 2_000);
    let now = 1_000_000;
    const token = githubActionsToken('aud', 'review.token', { env: ENV, fetch, now: () => now });

    const first = await token();
    expect(await token()).toBe(first);
    expect(asked).toHaveLength(1);

    now = 1_280_000;
    expect(await token()).not.toBe(first);
    expect(asked).toHaveLength(2);
  });

  it('names the permission when the job was not given one', async () => {
    const token = githubActionsToken('aud', 'review.token', { env: {}, fetch: issuing().fetch });

    await expect(async () => token()).rejects.toThrow(/review\.token.*`id-token: write`/s);
  });

  it('says what the runner answered when it refuses', async () => {
    const fetch = (async () => new Response('nope', { status: 403 })) as unknown as typeof globalThis.fetch;

    await expect(githubActionsToken('aud', 'review.token', { env: ENV, fetch })()).rejects.toThrow(/403/);
  });
});
