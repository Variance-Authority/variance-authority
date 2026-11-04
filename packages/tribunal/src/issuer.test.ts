import { beforeAll, describe, expect, it } from 'vitest';
import { createIssuer } from './issuer.js';
import { signer, type Signer } from './testing-issuer.js';

const ISSUER = 'https://issuer.example';
const AUDIENCE = 'https://tribunal.example';
const NOW = 1_800_000_000;

let key: Signer;

beforeAll(async () => {
  key = await signer('key-1');
});

function issuer(keys: () => readonly JsonWebKey[], fetched: string[] = [], at = (): number => NOW * 1000) {
  return createIssuer({
    issuer: ISSUER,
    now: at,
    fetch: async (url) => {
      fetched.push(String(url));
      if (String(url).endsWith('/.well-known/openid-configuration')) {
        return Response.json({ jwks_uri: `${ISSUER}/keys` });
      }
      return Response.json({ keys: keys() });
    },
  });
}

const claims = { iss: ISSUER, aud: AUDIENCE, exp: NOW + 300, nbf: NOW - 10, repository: 'Owner/name' };

describe('one issuer verifier', () => {
  it('answers the claims of a token its issuer signed for this audience', async () => {
    const verified = await issuer(() => [key.jwk]).verify(await key.sign(claims), AUDIENCE);

    expect(verified).toMatchObject({ claims: { repository: 'Owner/name' } });
  });

  it('refuses a signature that is not base64url, rather than failing', async () => {
    const [head, body] = (await key.sign(claims)).split('.');

    expect(await issuer(() => [key.jwk]).verify(`${head}.${body}.@@@`, AUDIENCE)).toEqual({
      refused: 'the signature is not base64url',
    });
  });

  it('finds the keys through the discovery document', async () => {
    const fetched: string[] = [];
    await issuer(() => [key.jwk], fetched).verify(await key.sign(claims), AUDIENCE);

    expect(fetched).toEqual([`${ISSUER}/.well-known/openid-configuration`, `${ISSUER}/keys`]);
  });

  it.each([
    ['another issuer', { ...claims, iss: 'https://else.example' }, /iss/],
    ['another audience', { ...claims, aud: 'https://else.example' }, /aud/],
    ['an expired token', { ...claims, exp: NOW - 60 }, /exp/],
    ['a token not yet valid', { ...claims, nbf: NOW + 60 }, /nbf/],
    ['a token with no expiry', { ...claims, exp: undefined }, /exp/],
  ])('refuses %s, naming the claim it saw', async (_name, payload, reason) => {
    const verified = await issuer(() => [key.jwk]).verify(await key.sign(payload), AUDIENCE);

    expect(verified).toEqual({ refused: expect.stringMatching(reason) });
  });

  it('accepts a few seconds of skew and not minutes', async () => {
    const verifier = issuer(() => [key.jwk]);

    expect(await verifier.verify(await key.sign({ ...claims, exp: NOW - 5 }), AUDIENCE)).toHaveProperty('claims');
    expect(await verifier.verify(await key.sign({ ...claims, exp: NOW - 120 }), AUDIENCE)).toHaveProperty('refused');
  });

  it('refuses a signature made by a key the issuer never published', async () => {
    const stranger = await signer('key-1');

    const verified = await issuer(() => [key.jwk]).verify(await stranger.sign(claims), AUDIENCE);

    expect(verified).toEqual({ refused: expect.stringMatching(/signature/) });
  });

  it('refuses any algorithm but RS256', async () => {
    const forged = await key.sign(claims, { alg: 'none' });

    expect(await issuer(() => [key.jwk]).verify(forged, AUDIENCE)).toEqual({
      refused: expect.stringMatching(/alg/),
    });
  });

  it('refetches the keys for an unknown kid, at most once per interval', async () => {
    const rotated = await signer('key-2');
    const fetched: string[] = [];
    let published = [key.jwk];
    let at = NOW * 1000;
    const verifier = issuer(() => published, fetched, () => at);

    await verifier.verify(await key.sign(claims), AUDIENCE);
    published = [key.jwk, rotated.jwk];

    // Too soon after the last fetch: an unknown kid must not become a way to
    // make this deployment fetch on every request.
    expect(await verifier.verify(await rotated.sign(claims), AUDIENCE)).toHaveProperty('refused');

    at += 120_000;
    const later = { ...claims, exp: NOW + 600 };
    expect(await verifier.verify(await rotated.sign(later), AUDIENCE)).toHaveProperty('claims');
    expect(fetched.filter((url) => url.endsWith('/keys'))).toHaveLength(2);
  });

  it('does not remember a failed fetch as an issuer with no keys', async () => {
    let up = false;
    const verifier = createIssuer({
      issuer: ISSUER,
      keysUrl: `${ISSUER}/keys`,
      now: () => NOW * 1000,
      fetch: async () => (up ? Response.json({ keys: [key.jwk] }) : new Response('down', { status: 503 })),
    });

    await expect(verifier.verify(await key.sign(claims), AUDIENCE)).rejects.toThrow(/503/);
    up = true;

    expect(await verifier.verify(await key.sign(claims), AUDIENCE)).toHaveProperty('claims');
  });
});
