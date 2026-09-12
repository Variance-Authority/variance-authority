import { describe, expect, it } from 'vitest';
import { CLI_VERSION, NEEDS_API, reach, versionNote } from './version.js';

/**
 * Whether the two halves can tell each other apart.
 *
 * The failure this exists for produced no error anywhere: a CLI newer than its
 * deployment uploaded every image it held, waited half a minute for a body it
 * did not need to send, and reported success. Every assertion here is about the
 * sentence that would have named it in one line.
 */

function answering(payload: unknown, status = 200): typeof globalThis.fetch {
  return (async () =>
    ({
      ok: status < 400,
      status,
      statusText: 'x',
      json: async () => payload,
      text: async () => '',
    }) as Response) as typeof globalThis.fetch;
}

describe('knowing which halves are talking', () => {
  it('reads the API version a deployment states', async () => {
    const reached = await reach(
      answering({ service: 'variance-authority-tribunal', api: 2, schema: 17 }),
      'https://review.example/api',
      'ingest-token-0123',
    );

    expect(reached).toEqual({ known: true, api: 2, schema: 17 });
    // And the agreement is silent: a tool that announces every normal state is
    // a tool whose output people stop reading.
    expect(versionNote(reached)).toBeUndefined();
  });

  it('reads a 404 as the strongest available evidence rather than as nothing', async () => {
    const reached = await reach(answering(null, 404), 'https://review.example/api', 'token');

    expect(reached.known).toBe(false);
    // The deployment that predates this route is exactly the deployment that
    // predates everything the route would have warned about, so the absence of
    // an answer is itself the answer.
    expect(versionNote(reached)).toContain('older than that route');
    expect(versionNote(reached)).toContain('full upload of every image');
  });

  it('survives a deployment that cannot be reached at all', async () => {
    const reached = await reach(
      (() => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof globalThis.fetch,
      'https://review.example/api',
      'token',
    );

    // Never thrown. The request that is allowed to fail a push is the one that
    // carries the build; a version probe that could stop a deployment from
    // being pushed to would make upgrading this package a breaking change for
    // everybody running an older service.
    expect(reached.known).toBe(false);
  });

  it('names which half is older, in both directions', async () => {
    const behind = versionNote({ known: true, api: NEEDS_API - 1 });
    expect(behind).toContain('Redeploy the tribunal');
    expect(behind).toContain(`variance ${CLI_VERSION}`);

    const ahead = versionNote({ known: true, api: NEEDS_API + 1 });
    // Not an error and not a fix: an older CLI pushes correctly, and saying so
    // is what stops somebody chasing a version number that is not the problem.
    expect(ahead).toContain('this CLI is the older half');
    expect(ahead).not.toContain('Redeploy');
  });

  it('reports a version that came from the manifest', () => {
    // Read rather than copied. A constant somebody has to remember to bump is a
    // constant that is wrong on exactly the release where it matters.
    expect(CLI_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
