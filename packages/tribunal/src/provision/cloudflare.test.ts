import { describe, expect, it } from 'vitest';
import { CloudflareError, NOT_AUTHORIZED, cloudflare } from './cloudflare.js';

interface Sent {
  readonly method: string;
  readonly url: string;
  readonly authorization: string;
  readonly body?: unknown;
}

function api(answer: (sent: Sent) => unknown, status = 200): { client: ReturnType<typeof cloudflare>; sent: Sent[] } {
  const sent: Sent[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    const one: Sent = {
      method: init.method!,
      url,
      authorization: (init.headers as Record<string, string>).authorization!,
      ...(init.body === undefined ? {} : { body: JSON.parse(init.body as string) }),
    };
    sent.push(one);
    return new Response(JSON.stringify(answer(one)), { status });
  }) as typeof fetch;
  return { client: cloudflare('tok', 'acc', fetcher), sent };
}

const ok = (result: unknown) => ({ success: true, result });
const failed = (code: number) => ({ success: false, errors: [{ code, message: 'no' }], result: null });

describe('the Cloudflare client', () => {
  it('calls the account-scoped API with the login token', async () => {
    const { client, sent } = api(() => ok({ id: 'a1', name: 'app', aud: 'aud1' }));
    await client.createApp({ name: 'app' });
    expect(sent).toEqual([
      {
        method: 'POST',
        url: 'https://api.cloudflare.com/client/v4/accounts/acc/access/apps',
        authorization: 'Bearer tok',
        body: { name: 'app' },
      },
    ]);
  });

  it('reads the team domain the organization holds', async () => {
    const { client } = api(() => ok({ auth_domain: 'team.cloudflareaccess.com' }));
    expect(await client.teamDomain()).toBe('team.cloudflareaccess.com');
  });

  it('answers no team domain when the account has no organization', async () => {
    const { client } = api(() => failed(9999), 404);
    expect(await client.teamDomain()).toBeUndefined();
  });

  it('throws on a failure that does not say the organization is absent', async () => {
    const { client } = api(() => failed(9999), 500);
    await expect(client.teamDomain()).rejects.toBeInstanceOf(CloudflareError);
  });

  it('throws when the login may not read Access', async () => {
    const { client } = api(() => failed(NOT_AUTHORIZED));
    const thrown = await client.teamDomain().catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(CloudflareError);
    expect((thrown as CloudflareError).codes).toEqual([NOT_AUTHORIZED]);
  });

  it('lists the identity providers by type', async () => {
    const { client } = api(() => ok([{ type: 'onetimepin' }, { type: 'github' }]));
    expect(await client.identityProviderTypes()).toEqual(['onetimepin', 'github']);
  });
});
