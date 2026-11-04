// compass: variance-authority.review

/**
 * The two Cloudflare answers `wrangler` has no command for: which accounts a login
 * sees, and the subdomain a Worker with no custom domain is served on.
 */

const API = 'https://api.cloudflare.com/client/v4';

interface Envelope<T> {
  readonly success: boolean;
  readonly errors?: readonly { readonly code: number; readonly message: string }[];
  readonly result: T;
}

export interface Cloudflare {
  /** The accounts the login can act in. */
  accounts(): Promise<readonly { readonly id: string; readonly name: string }[]>;
  workersSubdomain(): Promise<string>;
}

export function cloudflare(token: string, account: string, fetcher: typeof fetch): Cloudflare {
  const call = async <T>(path: string): Promise<T> => {
    const response = await fetcher(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
    const envelope = (await response.json()) as Envelope<T>;
    if (!envelope.success) {
      const errors = (envelope.errors ?? []).map((each) => `${each.code} ${each.message}`).join('; ');
      throw new Error(`GET ${path}: ${errors || response.status}`);
    }
    return envelope.result;
  };

  return {
    accounts: () => call<readonly { id: string; name: string }[]>('/accounts'),
    workersSubdomain: async () => (await call<{ subdomain: string }>(`/accounts/${account}/workers/subdomain`)).subdomain,
  };
}
