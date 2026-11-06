import { describe, expect, it } from 'vitest';
import { cloudflare } from './cloudflare.js';

interface Sent {
  readonly url: string;
  readonly authorization: string;
}

function api(answer: (sent: Sent) => unknown, status = 200): { client: ReturnType<typeof cloudflare>; sent: Sent[] } {
  const sent: Sent[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    const one: Sent = {
      url,
      authorization: (init.headers as Record<string, string>).authorization!,
    };
    sent.push(one);
    return new Response(JSON.stringify(answer(one)), { status });
  }) as typeof fetch;
  return { client: cloudflare('tok', 'acc', fetcher), sent };
}

const ok = (result: unknown) => ({ success: true, result });
const failed = (code: number) => ({ success: false, errors: [{ code, message: 'no' }], result: null });

describe('the Cloudflare client', () => {
  it('lists the accounts with the login token', async () => {
    const { client, sent } = api(() => ok([{ id: 'acc', name: 'Acme' }]));
    expect(await client.accounts()).toEqual([{ id: 'acc', name: 'Acme' }]);
    expect(sent).toEqual([{ url: 'https://api.cloudflare.com/client/v4/accounts', authorization: 'Bearer tok' }]);
  });

  it('reads the workers.dev subdomain of the account', async () => {
    const { client, sent } = api(() => ok({ subdomain: 'acme' }));
    expect(await client.workersSubdomain()).toBe('acme');
    expect(sent[0]!.url).toBe('https://api.cloudflare.com/client/v4/accounts/acc/workers/subdomain');
  });

  it('throws what Cloudflare said', async () => {
    const { client } = api(() => failed(9999), 500);
    await expect(client.accounts()).rejects.toThrow('9999 no');
  });
});
