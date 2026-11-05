import { OperatorError } from './exit.js';

/**
 * The credential a GitHub Actions job already has: a token the runner signs for one
 * audience, so a repository stores no secret to push with.
 *
 * Fetched when it is used, because a run that never pushes has no reason to need the
 * permission, and kept until it nears its expiry, because a long run outlives one
 * token. A job without `id-token: write` has neither variable, and that absence is the
 * one thing a person has to fix, so the refusal comes before the first request and
 * names the line.
 */

/** A token this close to its expiry could lapse on the wire, so it is replaced first. */
const EXPIRY_MARGIN_MS = 60_000;

export interface GithubActionsTokenOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
}

export function githubActionsToken(
  audience: string,
  field: string,
  options: GithubActionsTokenOptions = {},
): () => Promise<string> {
  const { env = process.env, fetch = globalThis.fetch, now = Date.now } = options;
  let held: { readonly value: string; readonly until: number } | undefined;

  return async () => {
    if (held !== undefined && now() < held.until - EXPIRY_MARGIN_MS) return held.value;

    const address = env['ACTIONS_ID_TOKEN_REQUEST_URL'];
    const bearer = env['ACTIONS_ID_TOKEN_REQUEST_TOKEN'];
    if (address === undefined || bearer === undefined) {
      throw new OperatorError(
        `\`${field}\` is a GitHub Actions credential and this job has none to ask for. ` +
          "Add `id-token: write` to the workflow's `permissions`",
      );
    }

    const url = new URL(address);
    url.searchParams.set('audience', audience);
    const response = await fetch(url, { headers: { authorization: `Bearer ${bearer}` } });
    if (!response.ok) {
      throw new OperatorError(`\`${field}\`: the runner answered ${response.status} when asked for a token`);
    }

    const { value } = (await response.json()) as { readonly value: string };
    held = { value, until: expiryOf(value) };
    return value;
  };
}

function expiryOf(token: string): number {
  const payload = token.split('.')[1] ?? '';
  const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { readonly exp: number };
  return exp * 1000;
}
