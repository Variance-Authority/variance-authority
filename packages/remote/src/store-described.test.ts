import { variancePrecondition } from '@variance-authority/sense/precondition';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RenderIdentity } from '@variance-authority/core/format';
import { createRemoteStore } from './store.js';

/**
 * A description the cheap lookup cannot trust, refused rather than read.
 *
 * `describe` is asked of every subject before any image, and `settle` decides
 * from its answer alone whether a subject needs one. A field defaulted here is
 * a verdict reached for a whole run without anybody having said it: so each
 * field that decides a settlement is refused when it is absent or malformed.
 */

const MAC: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'darwin/arm64',
  deviceScaleFactor: 1,
  fonts: ['Inter/400/normal/abc'],
};

describe('a description that cannot be trusted', () => {
  beforeEach(() => variancePrecondition('fixture', { network: 'stubbed', remote: 'garbled' }));
  it('refuses a description body that is not an answer', async () => {
    // The cheap route is the one a caller reaches for on every subject, so a body
    // it is willing to guess at is a body that settles a whole run.
    const store = createRemoteStore({
      endpoint: 'http://stub',
      fetch: async () => new Response('{"nothing":true}', { status: 200 }),
    });

    await expect(store.describe({ subject: 's' }, MAC)).rejects.toThrow(/no `described` field/);
  });

  it('refuses a description with no document digest rather than rendering everything', async () => {
    // The quiet one. Absent, the digest compares as `undefined` against a real one
    // and never matches, so every subject renders: a broken server hidden behind a
    // bill for images and a run that still reports verdicts.
    const store = createRemoteStore({
      endpoint: 'http://stub',
      fetch: async () =>
        new Response(JSON.stringify({ described: { comparable: true, storedUnder: MAC } }), {
          status: 200,
        }),
    });

    await expect(store.describe({ subject: 's' }, MAC)).rejects.toThrow(/documentDigest/);
  });

  it('refuses a description whose comparability it was not told', async () => {
    const store = createRemoteStore({
      endpoint: 'http://stub',
      fetch: async () =>
        new Response(
          JSON.stringify({ described: { documentDigest: 'v1:doc', storedUnder: MAC } }),
          { status: 200 },
        ),
    });

    await expect(store.describe({ subject: 's' }, MAC)).rejects.toThrow(/comparable/);
  });

  it('refuses a description that does not say which fonts were missing', async () => {
    // The loudest failure of the three if it were allowed through, and the one
    // with a precedent in this repository. Defaulting the field to `[]` reads as
    // "no fonts were missing", which is a *verdict*: the subject settles to a
    // bare `unchanged` while the baseline is an image of a substituted typeface.
    // Absent and empty must not be the same value on a wire, which is exactly
    // what `stabilization` taught here when the identity codec dropped it.
    const store = createRemoteStore({
      endpoint: 'http://stub',
      fetch: async () =>
        new Response(
          JSON.stringify({
            described: {
              documentDigest: 'v1:doc',
              comparable: true,
              storedUnder: MAC,
              pictured: true,
              keepsSnapshot: false,
            },
          }),
          { status: 200 },
        ),
    });

    await expect(store.describe({ subject: 's' }, MAC)).rejects.toThrow(/missingFonts/);
  });

  it('refuses a description that does not say whether the baseline kept its snapshot', async () => {
    // Defaulted to `true`, a baseline that kept none would settle forever and
    // never be re-stamped; defaulted to `false`, every subject on the wire would
    // render on every run. Either is a claim the codec cannot make.
    const store = createRemoteStore({
      endpoint: 'http://stub',
      fetch: async () =>
        new Response(
          JSON.stringify({
            described: {
              documentDigest: 'v1:doc',
              comparable: true,
              storedUnder: MAC,
              pictured: true,
              missingFonts: [],
            },
          }),
          { status: 200 },
        ),
    });

    await expect(store.describe({ subject: 's' }, MAC)).rejects.toThrow(
      /`keepsSnapshot` missing or not a boolean, which a server older than this client does not send \(tribunal before API 6, or `serveRasterStore` from an earlier `@variance-authority\/remote`\): upgrade the server first/,
    );
  });

  it('refuses a description whose missing fonts are not strings', async () => {
    const store = createRemoteStore({
      endpoint: 'http://stub',
      fetch: async () =>
        new Response(
          JSON.stringify({
            described: {
              documentDigest: 'v1:doc',
              comparable: true,
              storedUnder: MAC,
              pictured: true,
              keepsSnapshot: false,
              missingFonts: [{ family: 'Inter' }],
            },
          }),
          { status: 200 },
        ),
    });

    await expect(store.describe({ subject: 's' }, MAC)).rejects.toThrow(/missingFonts/);
  });
});
