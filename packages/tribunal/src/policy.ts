import { createGithubSignIn, cookieOf, SIGN_IN_PATH } from './github-signin.js';
import { createIssuer, unverifiedIssuer } from './issuer.js';
import { equalTokens, type Policy, type Principal } from './worker-auth.js';

/**
 * Who this deployment recognizes, read from what the deployer declared.
 *
 * Two lists say it: `INGEST_CREDENTIALS` for what may write a run and
 * `REVIEW_CREDENTIALS` for who may decide. Nothing here is discovered. A secret
 * lying around in the environment turns nothing on, and a declared mechanism whose
 * configuration is missing refuses to start by name, because a deployment that
 * quietly recognizes less than it says fails the person who is locked out, and one
 * that recognizes more fails everyone else.
 *
 * Names arrive unprefixed. The Node service strips `VARIANCE_TRIBUNAL_` first.
 *
 * ## Which credential a request is read as
 *
 * A bearer is a machine and is read only as a machine. A wrong one is refused even
 * on an open deployment, so a stale CI secret fails loudly instead of being served
 * as an anonymous reader. Without a bearer the request is a person's: the declared
 * reviewer mechanisms, and then `VIEW=public`, the one way to admit nobody in
 * particular. Viewing never decides.
 *
 * A refusal says nothing to the caller. Its reason goes to `log`.
 */

/** The shortest token this will start with. A short shared secret is a public one. */
const MIN_TOKEN = 16;

const GITHUB_ACTIONS_ISSUER = 'https://token.actions.githubusercontent.com';

const INGEST_MECHANISMS = ['token', 'github-actions'];
const REVIEW_MECHANISMS = ['access', 'github', 'loopback'];

/** Configuration that means something only for one mechanism, so setting it without declaring that one is a mistake. */
const COMMITTED: Readonly<Record<string, readonly string[]>> = {
  'github-actions': ['GITHUB_ACTIONS_REPOSITORIES', 'GITHUB_ACTIONS_AUDIENCE', 'GITHUB_ACTIONS_ISSUER'],
  access: ['ACCESS_TEAM_DOMAIN', 'ACCESS_AUD'],
  github: ['GITHUB_REPOSITORY', 'GITHUB_CLIENT_ID'],
};

/** Secrets are logged rather than refused when undeclared: rotating one out must not take a deployment down. */
const SECRETS: Readonly<Record<string, readonly string[]>> = {
  token: ['INGEST_TOKEN'],
  github: ['GITHUB_CLIENT_SECRET', 'GITHUB_SESSION_SECRET'],
};

export interface PolicyOptions {
  /** Whether the socket is reachable only from this machine. Only then may `loopback` be declared. */
  readonly loopback?: boolean;
  readonly log?: (line: string) => void;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

type Values = Readonly<Record<string, unknown>>;

/**
 * Who a deployment recognizes, read from `INGEST_CREDENTIALS`, `REVIEW_CREDENTIALS`
 * and the values their mechanisms need. A declaration that cannot be honoured throws,
 * so a host refuses to serve rather than recognizing somebody it was not told to.
 */
export function declaredPolicy(values: Values, options: PolicyOptions = {}): Policy {
  const log = options.log ?? ((line: string) => console.warn(line));
  const ingest = declared(values, 'INGEST_CREDENTIALS', INGEST_MECHANISMS);
  const review = declared(values, 'REVIEW_CREDENTIALS', REVIEW_MECHANISMS);
  if (ingest.length + review.length === 0) {
    throw new Error(
      'INGEST_CREDENTIALS and REVIEW_CREDENTIALS are both empty, so this deployment recognizes nobody. ' +
        `Declare what may write a run (${INGEST_MECHANISMS.join(', ')}) and who may decide (${REVIEW_MECHANISMS.join(', ')})`,
    );
  }

  const mechanisms = new Set([...ingest, ...review]);
  for (const [mechanism, names] of Object.entries(COMMITTED)) {
    if (mechanisms.has(mechanism)) continue;
    for (const name of names) {
      if (text(values, name) !== null) {
        throw new Error(`${name} is set and ${mechanism} is not declared. Declare it, or remove ${name}`);
      }
    }
  }
  for (const [mechanism, names] of Object.entries(SECRETS)) {
    if (mechanisms.has(mechanism)) continue;
    for (const name of names) {
      if (text(values, name) !== null) log(`${name} is set and ${mechanism} is not declared, so it is not read`);
    }
  }
  if (text(values, 'REVIEW_TOKEN') !== null) log('REVIEW_TOKEN is set and nothing reads it: a decision needs a name');

  const view = text(values, 'VIEW');
  if (view !== null && view !== 'public') throw new Error(`VIEW is "${view}", and the one value it takes is public`);
  if (mechanisms.has('loopback') && options.loopback !== true) {
    throw new Error('REVIEW_CREDENTIALS declares loopback and this deployment is reachable from elsewhere');
  }

  const ingestToken = mechanisms.has('token') ? secret(values, 'INGEST_TOKEN', 'token') : null;
  const shareToken = text(values, 'SHARE_TOKEN');
  if (shareToken !== null) strong('SHARE_TOKEN', shareToken);
  if (shareToken !== null && shareToken === ingestToken) {
    throw new Error(
      'the share token is the same value as the ingest token. The share token exists to be handed to ' +
        'machines that only read a share, and handing one out would then hand out everything the other can do',
    );
  }

  const actions = mechanisms.has('github-actions') ? githubActions(values, options) : null;
  const access = mechanisms.has('access') ? accessMechanism(values, options) : null;
  const github = mechanisms.has('github')
    ? createGithubSignIn({
        repository: needed(values, 'GITHUB_REPOSITORY', 'github'),
        clientId: needed(values, 'GITHUB_CLIENT_ID', 'github'),
        clientSecret: secret(values, 'GITHUB_CLIENT_SECRET', 'github'),
        sessionSecret: secret(values, 'GITHUB_SESSION_SECRET', 'github'),
        ...transport(options),
      })
    : null;
  const reviewer = mechanisms.has('loopback') ? needed(values, 'REVIEWER', 'loopback') : null;

  async function machine(bearer: string): Promise<Principal | null> {
    if (actions !== null && unverifiedIssuer(bearer) === actions.issuer) {
      const refused = await actions.refusal(bearer);
      if (refused === null) return { capability: 'ingest' };
      log(`github-actions refused: ${refused}`);
      return null;
    }
    // Both compared whichever matches, so which token this is costs the same.
    const isIngest = ingestToken !== null && (await equalTokens(bearer, ingestToken));
    const isShare = shareToken !== null && (await equalTokens(bearer, shareToken));
    return isIngest ? { capability: 'ingest' } : isShare ? { capability: 'share' } : null;
  }

  async function person(request: Request): Promise<Principal | null> {
    const email = await access?.email(request, log);
    if (typeof email === 'string') return { capability: 'review', name: email };
    const login = await github?.login(request);
    if (typeof login === 'string') return { capability: 'review', name: login };
    if (reviewer !== null) return { capability: 'review', name: reviewer };
    return view === 'public' ? { capability: 'view' } : null;
  }

  return {
    async principal(request) {
      const bearer = bearerOf(request);
      return bearer === null ? person(request) : machine(bearer);
    },
    ...(github === null ? {} : { serve: (request: Request) => github.serve(request), signIn: SIGN_IN_PATH }),
  };
}

function githubActions(values: Values, options: PolicyOptions) {
  const issuer = text(values, 'GITHUB_ACTIONS_ISSUER') ?? GITHUB_ACTIONS_ISSUER;
  const audience = needed(values, 'GITHUB_ACTIONS_AUDIENCE', 'github-actions');
  const allowed = needed(values, 'GITHUB_ACTIONS_REPOSITORIES', 'github-actions')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '');
  const verifier = createIssuer({ issuer, ...transport(options) });

  return {
    issuer,
    /** Why this token may not write, or `null` when it may. */
    async refusal(token: string): Promise<string | null> {
      const verified = await verifier.verify(token, audience);
      if ('refused' in verified) return verified.refused;
      const repository = String(verified.claims['repository']).toLowerCase();
      const owner = String(verified.claims['repository_owner']).toLowerCase();
      return allowed.includes(repository) || allowed.includes(`${owner}/*`)
        ? null
        : `repository is ${repository}, which GITHUB_ACTIONS_REPOSITORIES does not name`;
    },
  };
}

function accessMechanism(values: Values, options: PolicyOptions) {
  const team = needed(values, 'ACCESS_TEAM_DOMAIN', 'access').replace(/^https:\/\//, '').replace(/\/$/, '');
  const audience = needed(values, 'ACCESS_AUD', 'access');
  const verifier = createIssuer({
    issuer: `https://${team}`,
    keysUrl: `https://${team}/cdn-cgi/access/certs`,
    ...transport(options),
  });

  return {
    async email(request: Request, log: (line: string) => void): Promise<string | null> {
      const token = request.headers.get('cf-access-jwt-assertion') || cookieOf(request, 'CF_Authorization');
      if (token === null) return null;
      const verified = await verifier.verify(token, audience);
      if ('refused' in verified) {
        log(`access refused: ${verified.refused}`);
        return null;
      }
      // A service token carries `common_name` and no email. Machines do not decide.
      const email = verified.claims['email'];
      return typeof email === 'string' && email !== '' ? email : null;
    },
  };
}

function transport(options: PolicyOptions) {
  return {
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.now === undefined ? {} : { now: options.now }),
  };
}

function declared(values: Values, name: string, known: readonly string[]): readonly string[] {
  const list = (text(values, name) ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  for (const mechanism of list) {
    if (!known.includes(mechanism)) {
      throw new Error(`${name} declares "${mechanism}", and the mechanisms it takes are ${known.join(', ')}`);
    }
  }
  return list;
}

function text(values: Values, name: string): string | null {
  const value = values[name];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function needed(values: Values, name: string, mechanism: string): string {
  const value = text(values, name);
  if (value === null) throw new Error(`${mechanism} is declared and needs ${name}, which is not set`);
  return value;
}

function secret(values: Values, name: string, mechanism: string): string {
  const value = needed(values, name, mechanism);
  strong(name, value);
  return value;
}

function strong(name: string, value: string): void {
  if (value.trim().length < MIN_TOKEN) {
    throw new Error(
      `${name} is shorter than ${MIN_TOKEN} characters. This deployment holds every baseline and every ` +
        'observation a project has produced; a guessable shared secret in front of that is a mistake ' +
        'nobody notices until it matters',
    );
  }
}

function bearerOf(request: Request): string | null {
  const match = /^Bearer\s+(.+)$/i.exec((request.headers.get('authorization') ?? '').trim());
  return match?.[1] ?? null;
}
