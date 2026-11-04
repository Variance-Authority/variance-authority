import { beforeAll, describe, expect, it, vi } from 'vitest';
import { declaredPolicy, type PolicyOptions } from './policy.js';
import { signer, type Signer } from './testing-issuer.js';

const NOW = 1_800_000_000;
const ACTIONS = 'https://token.actions.githubusercontent.com';
const TEAM = 'https://team.cloudflareaccess.com';
const INGEST = 'an-ingest-token-of-some-length';
const SHARE = 'a-share-token-of-some-length';

let ci: Signer;
let edge: Signer;

beforeAll(async () => {
  ci = await signer('ci');
  edge = await signer('edge');
});

const transport = (): PolicyOptions => ({
  now: () => NOW * 1000,
  log: () => undefined,
  fetch: async (input) => {
    const url = String(input);
    if (url.endsWith('/.well-known/openid-configuration')) return Response.json({ jwks_uri: `${ACTIONS}/keys` });
    return Response.json({ keys: [url.startsWith(TEAM) ? edge.jwk : ci.jwk] });
  },
});

const ACTIONS_VALUES = {
  INGEST_CREDENTIALS: 'github-actions',
  GITHUB_ACTIONS_REPOSITORIES: 'Owner/name, Org/*',
  GITHUB_ACTIONS_AUDIENCE: 'https://tribunal.example',
};
const ACCESS_VALUES = {
  REVIEW_CREDENTIALS: 'access',
  ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
  ACCESS_AUD: 'application-tag',
};

const bearer = (token: string) => new Request('https://tribunal.example/', { headers: { authorization: `Bearer ${token}` } });
const anonymous = () => new Request('https://tribunal.example/');
const run = (claims: Record<string, unknown>) =>
  ci.sign({ iss: ACTIONS, aud: 'https://tribunal.example', exp: NOW + 300, ...claims });

describe('what a deployment declared', () => {
  it('refuses a deployment that declared nothing', () => {
    expect(() => declaredPolicy({})).toThrow(/recognizes nobody/);
  });

  it.each([
    ['an unknown mechanism', { INGEST_CREDENTIALS: 'password' }, /"password"/],
    ['a declared token that is not set', { INGEST_CREDENTIALS: 'token' }, /INGEST_TOKEN/],
    ['a weak token', { INGEST_CREDENTIALS: 'token', INGEST_TOKEN: 'short' }, /shorter/],
    ['a missing audience', { INGEST_CREDENTIALS: 'github-actions', GITHUB_ACTIONS_REPOSITORIES: 'o/n' }, /GITHUB_ACTIONS_AUDIENCE/],
    ['a missing sign-in secret', { REVIEW_CREDENTIALS: 'github', GITHUB_REPOSITORY: 'o/n', GITHUB_CLIENT_ID: 'i' }, /GITHUB_CLIENT_SECRET/],
    ['configuration for a mechanism not declared', { INGEST_CREDENTIALS: 'token', INGEST_TOKEN: INGEST, ACCESS_AUD: 'x' }, /ACCESS_AUD is set and access is not declared/],
    ['loopback on a network bind', { REVIEW_CREDENTIALS: 'loopback', REVIEWER: 'me' }, /loopback/],
    ['a VIEW value it does not know', { INGEST_CREDENTIALS: 'token', INGEST_TOKEN: INGEST, VIEW: 'open' }, /VIEW/],
    ['a share token equal to the ingest token', { INGEST_CREDENTIALS: 'token', INGEST_TOKEN: INGEST, SHARE_TOKEN: INGEST }, /same value/],
  ])('refuses %s by name', (_name, values, sentence) => {
    expect(() => declaredPolicy(values)).toThrow(sentence);
  });

  it('logs an undeclared secret and never reads it', async () => {
    const log = vi.fn();
    const policy = declaredPolicy({ ...ACTIONS_VALUES, INGEST_TOKEN: INGEST, REVIEW_TOKEN: INGEST }, { ...transport(), log });

    expect(log).toHaveBeenCalledWith(expect.stringMatching(/INGEST_TOKEN .* not read/));
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/REVIEW_TOKEN/));
    expect(await policy.principal(bearer(INGEST))).toBeNull();
  });
});

describe('which credential a request is read as', () => {
  it('reads the ingest token and the share token by what they are for', async () => {
    const policy = declaredPolicy({ INGEST_CREDENTIALS: 'token', INGEST_TOKEN: INGEST, SHARE_TOKEN: SHARE });

    expect(await policy.principal(bearer(INGEST))).toEqual({ capability: 'ingest' });
    expect(await policy.principal(bearer(SHARE))).toEqual({ capability: 'share' });
    expect(await policy.principal(bearer('a-wrong-token-of-some-length'))).toBeNull();
  });

  it.each([
    ['a named repository, in any case', { repository: 'owner/NAME', repository_owner: 'owner' }],
    ['any repository of a named owner', { repository: 'Org/other', repository_owner: 'Org' }],
  ])('lets a workflow in %s write with no stored secret', async (_name, claims) => {
    const policy = declaredPolicy(ACTIONS_VALUES, transport());

    expect(await policy.principal(bearer(await run(claims)))).toEqual({ capability: 'ingest' });
  });

  it('refuses a workflow in another repository, and logs which', async () => {
    const log = vi.fn();
    const policy = declaredPolicy(ACTIONS_VALUES, { ...transport(), log });

    const principal = await policy.principal(bearer(await run({ repository: 'else/name', repository_owner: 'else' })));

    expect(principal).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('else/name'));
  });

  it('names the person Access verified', async () => {
    const policy = declaredPolicy(ACCESS_VALUES, transport());
    const token = await edge.sign({ iss: TEAM, aud: 'application-tag', exp: NOW + 300, email: 'a@example.com' });

    const principal = await policy.principal(
      new Request('https://tribunal.example/', { headers: { cookie: `CF_Authorization=${token}` } }),
    );

    expect(principal).toEqual({ capability: 'review', name: 'a@example.com' });
  });

  it('does not take a decision from an Access service token', async () => {
    const policy = declaredPolicy(ACCESS_VALUES, transport());
    const token = await edge.sign({ iss: TEAM, aud: 'application-tag', exp: NOW + 300, common_name: 'machine' });

    const principal = await policy.principal(
      new Request('https://tribunal.example/', { headers: { 'cf-access-jwt-assertion': token } }),
    );

    expect(principal).toBeNull();
  });

  it('names the person at the machine on loopback', async () => {
    const policy = declaredPolicy({ REVIEW_CREDENTIALS: 'loopback', REVIEWER: 'me' }, { loopback: true });

    expect(await policy.principal(anonymous())).toEqual({ capability: 'review', name: 'me' });
  });

  it('admits an anonymous reader to view only where the deployment opened viewing', async () => {
    const closed = { INGEST_CREDENTIALS: 'token', INGEST_TOKEN: INGEST };

    expect(await declaredPolicy(closed).principal(anonymous())).toBeNull();
    expect(await declaredPolicy({ ...closed, VIEW: 'public' }).principal(anonymous())).toEqual({ capability: 'view' });
  });

  it('refuses a wrong bearer on an open deployment instead of serving it as a reader', async () => {
    const policy = declaredPolicy({ INGEST_CREDENTIALS: 'token', INGEST_TOKEN: INGEST, VIEW: 'public' });

    expect(await policy.principal(bearer('a-stale-token-of-some-length'))).toBeNull();
  });

  it('points a person at sign-in only when github is declared', () => {
    const github = {
      REVIEW_CREDENTIALS: 'github',
      GITHUB_REPOSITORY: 'o/n',
      GITHUB_CLIENT_ID: 'id',
      GITHUB_CLIENT_SECRET: 'a-client-secret-of-some-length',
      GITHUB_SESSION_SECRET: 'a-session-secret-of-some-length',
    };

    expect(declaredPolicy(github).signIn).toBe('/auth/github/login');
    expect(declaredPolicy(ACCESS_VALUES, transport()).signIn).toBeUndefined();
  });
});
