/**
 * An issuer of its own, for a test: a key pair, its published form, and tokens
 * signed with it.
 *
 * Real RS256 through `crypto.subtle`, so what a test verifies is the verifier
 * and not a paraphrase of it. Exported beside the rest of the doubles in
 * `@variance-authority/tribunal/testing`.
 */
export interface Signer {
  readonly jwk: JsonWebKey;
  sign(claims: Readonly<Record<string, unknown>>, header?: Readonly<Record<string, unknown>>): Promise<string>;
}

export async function signer(kid: string): Promise<Signer> {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ['sign', 'verify'],
  );
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid } as JsonWebKey;

  return {
    jwk,
    async sign(claims, header = {}) {
      const signed = `${encoded({ alg: 'RS256', kid, ...header })}.${encoded(claims)}`;
      const signature = await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        pair.privateKey,
        new TextEncoder().encode(signed),
      );
      return `${signed}.${Buffer.from(signature).toString('base64url')}`;
    },
  };
}

function encoded(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
