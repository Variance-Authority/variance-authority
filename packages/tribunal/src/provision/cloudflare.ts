// compass: variance-authority.review
import { HISTORY_API_VERSION } from '@variance-authority/history';
import { SHARE_PREFIX } from '../worker-share.js';
import { VERSION_PATH } from '../version.js';
import { CONCERNS_PATH } from '../worker-concerns.js';

/**
 * The Cloudflare API calls `wrangler` has no command for: Zero Trust Access.
 *
 * A deployment's reviewers sign in through Access, and the Worker verifies the
 * assertion against two values — the team domain and the application's AUD.
 * Both exist only once an organization and an application exist, so
 * provisioning makes them and reads the values back rather than asking the
 * operator to copy them out of a dashboard.
 */

const API = 'https://api.cloudflare.com/client/v4';

/** Cloudflare's code for a token that may not make the call. */
export const NOT_AUTHORIZED = 10000;

export class CloudflareError extends Error {
  constructor(
    readonly codes: readonly number[],
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The first segment of every path a machine calls: CI with a bearer token, the
 * runner reading baselines, a share link. Access stands in front of the pages
 * and is bypassed here, because a bearer request has no browser to sign in
 * with. The prefixes come from the routes' own constants where the package
 * exports them; `worker.ts` keeps the baseline and cache paths private, and the
 * test pins those two against `remote`'s.
 */
export const MACHINE_PREFIXES: readonly string[] = [
  ...new Set(
    ['/baseline/', '/cache/', CONCERNS_PATH, SHARE_PREFIX, VERSION_PATH, `/${HISTORY_API_VERSION}/`].map(
      (path) => `/${path.split('/')[1]!}`,
    ),
  ),
];

interface Envelope<T> {
  readonly success: boolean;
  readonly errors?: readonly { readonly code: number; readonly message: string }[];
  readonly result: T;
}

export interface AccessApp {
  readonly id: string;
  readonly name: string;
  readonly aud: string;
  readonly domain?: string;
}

export interface Cloudflare {
  /** The accounts the login can act in. */
  accounts(): Promise<readonly { readonly id: string; readonly name: string }[]>;
  email(): Promise<string>;
  workersSubdomain(): Promise<string>;
  /** The organization's team domain, or `undefined` when the account has none. */
  teamDomain(): Promise<string | undefined>;
  createOrganization(name: string, teamDomain: string): Promise<string>;
  identityProviderTypes(): Promise<readonly string[]>;
  createOneTimePin(): Promise<void>;
  apps(): Promise<readonly AccessApp[]>;
  createApp(body: Record<string, unknown>): Promise<AccessApp>;
}

export function cloudflare(token: string, account: string, fetcher: typeof fetch): Cloudflare {
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const response = await fetcher(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const envelope = (await response.json()) as Envelope<T>;
    if (!envelope.success) {
      const errors = envelope.errors ?? [];
      throw new CloudflareError(
        errors.map((each) => each.code),
        response.status,
        `${method} ${path}: ${errors.map((each) => `${each.code} ${each.message}`).join('; ') || response.status}`,
      );
    }
    return envelope.result;
  };
  const at = `/accounts/${account}`;

  return {
    accounts: () => call<readonly { id: string; name: string }[]>('GET', '/accounts'),
    email: async () => (await call<{ email: string }>('GET', '/user')).email,
    workersSubdomain: async () => (await call<{ subdomain: string }>('GET', `${at}/workers/subdomain`)).subdomain,
    teamDomain: async () => {
      try {
        return (await call<{ auth_domain?: string }>('GET', `${at}/access/organizations`)).auth_domain;
      } catch (error) {
        // Absent is a 404; anything else is no answer, and creating an
        // organization on no answer writes to the operator's account.
        if (error instanceof CloudflareError && error.status === 404 && !error.codes.includes(NOT_AUTHORIZED)) {
          return undefined;
        }
        throw error;
      }
    },
    createOrganization: async (name, teamDomain) =>
      (await call<{ auth_domain: string }>('POST', `${at}/access/organizations`, { name, auth_domain: teamDomain }))
        .auth_domain,
    identityProviderTypes: async () =>
      (await call<readonly { type: string }[]>('GET', `${at}/access/identity_providers`)).map((each) => each.type),
    createOneTimePin: async () => {
      await call('POST', `${at}/access/identity_providers`, { name: 'One-time PIN', type: 'onetimepin', config: {} });
    },
    apps: () => call<readonly AccessApp[]>('GET', `${at}/access/apps`),
    createApp: (body) => call<AccessApp>('POST', `${at}/access/apps`, body),
  };
}
