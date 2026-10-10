import { describe, expect, it } from 'vitest';
import { CLI_VERSION, NEEDS_API, reach, shareAt, versionNote } from './version.js';

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
      answering({ service: 'variance-authority-tribunal', api: NEEDS_API, schema: 17 }),
      'https://review.example/api',
      'ingest-token-0123',
    );

    expect(reached).toEqual({ known: true, api: NEEDS_API, schema: 17 });
    // And the agreement is silent: a tool that announces every normal state is
    // a tool whose output people stop reading.
    expect(versionNote(reached, true)).toBeUndefined();
  });

  it('reads a 404 as the strongest available evidence rather than as nothing', async () => {
    const reached = await reach(answering(null, 404), 'https://review.example/api', 'token');

    expect(reached.known).toBe(false);
    // The deployment that predates this route is exactly the deployment that
    // predates everything the route would have warned about, so the absence of
    // an answer is itself the answer.
    expect(versionNote(reached, false)).toContain('older than that route');
    expect(versionNote(reached, false)).toContain('full upload of every image');
    expect(versionNote(reached, false)).toContain('run identity');
    expect(versionNote(reached, false)).not.toContain('/share/');
    expect(versionNote(reached, true)).toContain('404 under /share/');
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
    const behind = versionNote({ known: true, api: 2 }, true);
    expect(behind).toContain('Redeploy the tribunal');
    expect(behind).toContain(`variance ${CLI_VERSION}`);
    // What is missing is said as what the operator would see.
    expect(behind).toContain('404 under /share/');
    expect(behind).not.toContain('full upload');

    const ahead = versionNote({ known: true, api: NEEDS_API + 1 }, true);
    // Not an error and not a fix: an older CLI pushes correctly, and saying so
    // is what stops somebody chasing a version number that is not the problem.
    expect(ahead).toContain('this CLI is the older half');
    expect(ahead).not.toContain('Redeploy');
  });

  it('names every capability a deployment lacks, and only those this project uses', () => {
    // API 1 predates `/review/have` and document identity, and API 2 predates the
    // share. Each level names what it lacks, not only the newest thing.
    const first = versionNote({ known: true, api: 1 }, false);
    expect(first).toContain('full upload of every image');
    expect(first).toContain('run identity');
    expect(first).not.toContain('/share/');
    expect(versionNote({ known: true, api: 1 }, true)).toContain('404 under /share/');

    // A project whose share is not at this deployment loses nothing at API 2,
    // so a push there says nothing rather than asking for a redeploy.
    expect(versionNote({ known: true, api: 2 }, false)).toBeUndefined();

    // API 4 keeps concerns but predates the share token reading what review
    // settled; only a project whose share token is for this deployment would
    // read with it.
    expect(versionNote({ known: true, api: 4 }, true)).toContain('refuses the share token');
    expect(versionNote({ known: true, api: 4 }, false)).toBeUndefined();
  });

  it('counts a share as stored at the deployment only when it is an http share under its endpoint', () => {
    const http = (endpoint: string) => ({ kind: 'http', endpoint }) as const;
    expect(shareAt(http('https://review.example/share'), 'https://review.example')).toBe(true);
    expect(shareAt(http('https://review.example/api/share/'), 'https://review.example/api/')).toBe(true);
    expect(shareAt(http('https://REVIEW.example/api/share'), 'https://review.example/api')).toBe(true);

    expect(shareAt(http('https://bucket.example/share'), 'https://review.example')).toBe(false);
    // A prefix of the path is not a parent of it.
    expect(shareAt(http('https://review.example/api-share'), 'https://review.example/api')).toBe(false);
    expect(shareAt({ kind: 'directory', root: '/srv/share' }, 'https://review.example')).toBe(false);
    expect(shareAt({ kind: 'git' }, 'https://review.example')).toBe(false);
    expect(shareAt(undefined, 'https://review.example')).toBe(false);
  });

  it('reports a version that came from the manifest', () => {
    // Read rather than copied. A constant somebody has to remember to bump is a
    // constant that is wrong on exactly the release where it matters.
    expect(CLI_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
