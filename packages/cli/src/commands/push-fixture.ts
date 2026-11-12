import { createHash } from 'node:crypto';
import type { ReviewConfig } from '../config.js';
import type { PushOptions } from './push.js';
import type { CliRunReport } from './run.js';
import { NEEDS_API } from '../version.js';


/**
 * What reaches a review surface, and what is deliberately kept back.
 *
 * No network and no disk: the fetch and the reader are both injected, so what
 * these assert is the *body* — which is the whole of what this command decides.
 * Everything else about it is one POST.
 */

export const REVIEW: ReviewConfig = {
  endpoint: 'https://review.example/api',
  token: () => 'ingest-token-0123',
};

export function report(images?: Record<string, string>): CliRunReport {
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

export const SIDECAR = JSON.stringify({
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
export function header(width: number, height: number): Buffer {
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
export function disk(files: Record<string, string>) {
  return async (path: string): Promise<Buffer> => {
    const found = files[path];
    if (found === undefined) throw new Error(`ENOENT: no such file, open '${path}'`);
    return Buffer.from(found, 'utf8');
  };
}

/**
 * A surface that answers 201 and keeps what it was sent.
 *
 * Three routes, because a push is three requests: it asks what the deployment
 * is, asks `/review/have` which of its images are already there, and then posts
 * the build. `holds` is what this deployment claims to have — empty by default,
 * which is the deployment that has never seen this suite and the case every
 * assertion about *bytes* wants. `api` is what it says it serves, and
 * `noVersion` is the deployment that predates being able to say.
 */
export function surface(
  answer: {
    status?: number;
    body?: string;
    holds?: readonly string[];
    noHave?: boolean;
    api?: number;
    noVersion?: boolean;
  } = {},
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: init as RequestInit });

    if (String(url).endsWith('/version')) {
      if (answer.noVersion === true) {
        return { ok: false, status: 404, statusText: 'Not Found', text: async () => '' } as Response;
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          service: 'variance-authority-tribunal',
          api: answer.api ?? NEEDS_API,
          schema: 17,
        }),
      } as Response;
    }

    if (String(url).endsWith('/review/have')) {
      if (answer.noHave === true) {
        return { ok: false, status: 404, statusText: 'Not Found', text: async () => '' } as Response;
      }
      const asked = JSON.parse(String((init as RequestInit).body)) as { digests: string[] };
      const holds = new Set(answer.holds ?? []);
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ have: asked.digests.filter((digest) => holds.has(digest)) }),
      } as Response;
    }

    const status = answer.status ?? 201;
    return {
      ok: status < 400,
      status,
      statusText: status === 201 ? 'Created' : 'Forbidden',
      text: async () => answer.body ?? '',
    } as Response;
  }) as typeof globalThis.fetch;

  const posted = (): { url: string; init: RequestInit } | undefined =>
    calls.find((call) => call.url.endsWith('/review/builds'));

  return {
    calls,
    fetch,
    posted,
    asked: (): { url: string; init: RequestInit } | undefined =>
      calls.find((call) => call.url.endsWith('/review/have')),
    sent: () => JSON.parse(String(posted()?.init.body)) as Record<string, unknown>,
  };
}

/** The key the deployment stores bytes under, as the push computes it. */
export function bytesDigest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function digestOf(text: string): string {
  return bytesDigest(Buffer.from(text, 'utf8'));
}

export function options(overrides: Partial<PushOptions> = {}): PushOptions {
  return {
    report: report(),
    reportDir: '/out',
    review: REVIEW,
    build: 'github-9-1',
    commit: 'abc123',
    ...overrides,
  };
}
