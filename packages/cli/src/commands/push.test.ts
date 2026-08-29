import { describe, expect, it } from 'vitest';
import { OperatorError } from '../exit.js';
import type { ReviewConfig } from '../config.js';
import { formatPush, push, type PushOptions } from './push.js';
import type { CliRunReport } from './run.js';

/**
 * What reaches a review surface, and what is deliberately kept back.
 *
 * No network and no disk: the fetch and the reader are both injected, so what
 * these assert is the *body* — which is the whole of what this command decides.
 * Everything else about it is one POST.
 */

const REVIEW: ReviewConfig = {
  endpoint: 'https://review.example/api',
  token: () => 'ingest-token-0123',
};

function report(images?: Record<string, string>): CliRunReport {
  return {
    runVersion: 1,
    at: '2026-08-29T00:00:00.000Z',
    identity: { engine: 'chromium', engineVersion: '1', platform: 'darwin', digest: 'd' },
    retention: 'durable',
    observations: [
      {
        subject: 'story:card',
        verdict: 'changed',
        because: '120 pixel(s) differ',
        changedPixels: 120,
        regions: [],
        ...(images === undefined ? {} : { images }),
      },
    ],
  } as unknown as CliRunReport;
}

const SIDECAR = JSON.stringify({
  documentDigest: 'v1:abc',
  identity: { engine: 'chromium' },
  width: 800,
  height: 600,
  missingFonts: [],
});

/**
 * A PNG's first 24 bytes: signature, then the IHDR length, type and dimensions.
 *
 * Only the header, because only the header is read — the codec lives in
 * `@variance-authority/png` and is tested against real files there. Writing a
 * whole image here would mean this package installing an encoder to assert that
 * a push forwards two numbers.
 */
function header(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(24);
  bytes.writeUInt32BE(0x89504e47, 0);
  bytes.writeUInt32BE(0x0d0a1a0a, 4);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

/** A disk holding exactly what it is given, and nothing else. */
function disk(files: Record<string, string>) {
  return async (path: string): Promise<Buffer> => {
    const found = files[path];
    if (found === undefined) throw new Error(`ENOENT: no such file, open '${path}'`);
    return Buffer.from(found, 'utf8');
  };
}

/** A surface that answers 201 and keeps what it was sent. */
function surface(answer: { status?: number; body?: string } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: init as RequestInit });
    const status = answer.status ?? 201;
    return {
      ok: status < 400,
      status,
      statusText: status === 201 ? 'Created' : 'Forbidden',
      text: async () => answer.body ?? '',
    } as Response;
  }) as typeof globalThis.fetch;
  return { calls, fetch, sent: () => JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown> };
}

function options(overrides: Partial<PushOptions> = {}): PushOptions {
  return {
    report: report(),
    reportDir: '/out',
    review: REVIEW,
    build: 'github-9-1',
    commit: 'abc123',
    ...overrides,
  };
}

describe('putting a finished run in front of a reviewer', () => {
  it('posts the build to the ingest route, bearing the token it was given', async () => {
    const service = surface();

    await push(options({ deps: { fetch: service.fetch, read: disk({}) }, branch: 'main' }));

    expect(service.calls[0]?.url).toBe('https://review.example/api/review/builds');
    expect(service.calls[0]?.init.method).toBe('POST');
    expect((service.calls[0]!.init.headers as Record<string, string>)['authorization']).toBe(
      'Bearer ingest-token-0123',
    );
    expect(service.sent()).toMatchObject({ build: 'github-9-1', commit: 'abc123', branch: 'main' });
  });

  it('joins the endpoint to the route without doubling the slash', async () => {
    const service = surface();

    await push(
      options({
        review: { ...REVIEW, endpoint: 'https://review.example/api/' },
        deps: { fetch: service.fetch, read: disk({}) },
      }),
    );

    expect(service.calls[0]?.url).toBe('https://review.example/api/review/builds');
  });

  it('sends the candidate with the sidecar that makes it approvable', async () => {
    const service = surface();

    const result = await push(
      options({
        report: report({ after: 'images/card.after.png', before: 'images/card.before.png', diff: 'images/card.diff.png' }),
        deps: {
          fetch: service.fetch,
          read: disk({
            '/out/images/card.after.png': 'AFTER',
            '/out/images/card.after.json': SIDECAR,
            '/out/images/card.before.png': 'BEFORE',
            '/out/images/card.diff.png': 'DIFF',
          }),
        },
      }),
    );

    const images = (service.sent()['images'] as Record<string, Record<string, unknown>>)['story:card']!;
    expect(images['after']).toEqual({
      bytes: Buffer.from('AFTER', 'utf8').toString('base64'),
      documentDigest: 'v1:abc',
      width: 800,
      height: 600,
      missingFonts: [],
    });
    expect(images['before']).toEqual({ bytes: Buffer.from('BEFORE', 'utf8').toString('base64') });
    expect(result.images).toEqual({ after: 1, before: 1, diff: 1 });
    expect(result.withheld).toEqual([]);
  });

  it('measures the baseline it is sending, because its size is sometimes the change', async () => {
    // The candidate's dimensions come from a sidecar the run wrote. The baseline
    // has no sidecar — it is a file that arrived from a previous run, possibly a
    // previous version of this tool — so its size is read from its own header.
    // Without it a viewer has one pair of numbers for two images and draws both
    // to it, which turns a page that got 80 pixels wider into a hairline.
    const service = surface();
    const baseline = header(1200, 8868);

    await push(
      options({
        report: report({ after: 'images/card.after.png', before: 'images/card.before.png' }),
        deps: {
          fetch: service.fetch,
          read: async (path: string): Promise<Buffer> => {
            if (path === '/out/images/card.before.png') return baseline;
            if (path === '/out/images/card.after.json') return Buffer.from(SIDECAR, 'utf8');
            return Buffer.from('AFTER', 'utf8');
          },
        },
      }),
    );

    const images = (service.sent()['images'] as Record<string, Record<string, unknown>>)[
      'story:card'
    ]!;

    expect(images['before']).toMatchObject({ width: 1200, height: 8868 });
    // And the candidate's own numbers still come from the sidecar, which is a
    // claim about the *document*, not about the file.
    expect(images['after']).toMatchObject({ width: 800, height: 600 });
  });

  it('says nothing about the size of a baseline it could not read as a PNG', async () => {
    // Absent, not zero, and not the candidate's. A number here that nobody
    // measured would arrive on the review page next to ones that were, in the
    // same typeface, and there would be no way to tell them apart.
    const service = surface();

    await push(
      options({
        report: report({ before: 'images/card.before.png' }),
        deps: {
          fetch: service.fetch,
          read: disk({ '/out/images/card.before.png': '<html>404 Not Found</html>' }),
        },
      }),
    );

    const images = (service.sent()['images'] as Record<string, Record<string, unknown>>)[
      'story:card'
    ]!;

    expect(images['before']).toEqual({
      bytes: Buffer.from('<html>404 Not Found</html>', 'utf8').toString('base64'),
    });
  });

  it('withholds a candidate whose sidecar is missing, rather than inventing its digest', async () => {
    const service = surface();

    const result = await push(
      options({
        report: report({ after: 'images/card.after.png', before: 'images/card.before.png' }),
        deps: {
          fetch: service.fetch,
          // The PNG is there. The sidecar is not, and the digest is only in it.
          read: disk({ '/out/images/card.after.png': 'AFTER', '/out/images/card.before.png': 'BEFORE' }),
        },
      }),
    );

    const images = (service.sent()['images'] as Record<string, Record<string, unknown>>)['story:card']!;
    expect(images['after']).toBeUndefined();
    // The subject still goes up and can still be looked at. What it loses is the
    // button, and the reason is said here rather than discovered on the page.
    expect(images['before']).toBeDefined();
    expect(result.withheld).toEqual([
      {
        subject: 'story:card',
        kind: 'after',
        because: expect.stringContaining('/out/images/card.after.json could not be read'),
      },
    ]);
    expect(formatPush(result)).toContain('[withheld] story:card after');
  });

  it('withholds a candidate whose sidecar carries no digest', async () => {
    const service = surface();

    const result = await push(
      options({
        report: report({ after: 'images/card.after.png' }),
        deps: {
          fetch: service.fetch,
          read: disk({
            '/out/images/card.after.png': 'AFTER',
            '/out/images/card.after.json': JSON.stringify({ width: 800, height: 600 }),
          }),
        },
      }),
    );

    expect(result.withheld[0]?.because).toContain('never approved');
  });

  it('sends no `images` key at all when the run kept none', async () => {
    const service = surface();

    await push(options({ deps: { fetch: service.fetch, read: disk({}) } }));

    expect(service.sent()['images']).toBeUndefined();
  });

  it('reports a refusal as an operator error carrying what the surface said', async () => {
    const service = surface({ status: 403, body: 'ingest requires the ingest token' });

    await expect(
      push(options({ deps: { fetch: service.fetch, read: disk({}) } })),
    ).rejects.toThrow(/403 Forbidden.*ingest requires the ingest token/s);
  });

  it('says the report survived when the surface could not be reached', async () => {
    const unreachable = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof globalThis.fetch;

    const failure = push(options({ deps: { fetch: unreachable, read: disk({}) } }));
    await expect(failure).rejects.toThrow(OperatorError);
    await expect(failure).rejects.toThrow(/may be run again against it/);
  });
});
