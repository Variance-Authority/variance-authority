import type { BrowserContext } from 'playwright';
import { digestBytes, type RenderDocument } from '@variance-authority/core/format';

/**
 * Serving a resource-closed document out of what it carries.
 *
 * A document declaring itself closed brought its own bytes, and a renderer that
 * reaches past them for the network paints a page that depends on the day. So
 * every request is answered from `resources` or refused, and a refusal is
 * carried to the end of the render rather than swallowed: the subject that came
 * back is missing something, and the caller has to hear which URL.
 */
export async function serveClosedResources(
  context: BrowserContext,
  document: RenderDocument,
  missing: Set<string>,
): Promise<void> {
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    const resource = document.resources?.[url];
    if (resource === undefined) {
      missing.add(url);
      await route.abort('blockedbyclient');
      return;
    }

    if (resource.status !== undefined && resource.status >= 400) {
      // Recorded as absent on the acquiring side. The subject is supposed to
      // look like this; answering it any other way paints a page nobody has.
      await route.fulfill({ status: resource.status, body: '' });
      return;
    }

    const bytes = Buffer.from(resource.bytes, 'base64');
    const actual = digestBytes(bytes);
    if (actual !== resource.digest) {
      missing.add(`${url} (digest ${resource.digest} does not match ${actual})`);
      await route.abort('blockedbyclient');
      return;
    }

    await route.fulfill({
      body: bytes,
      contentType: resource.contentType,
      headers: {
        'access-control-allow-origin': '*',
        'cross-origin-resource-policy': 'cross-origin',
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
  });
}

export function assertClosedResources(document: RenderDocument): void {
  if (document.resources === undefined) return;

  for (const [url, expected] of Object.entries(document.assets ?? {})) {
    const resource = document.resources[url];
    if (resource === undefined) {
      throw new Error(
        `resource-closed document ${document.subject.id} has no bytes for ${url}`,
      );
    }
    const actual = digestBytes(Buffer.from(resource.bytes, 'base64'));
    if (actual !== expected || actual !== resource.digest) {
      throw new Error(
        `resource-closed document ${document.subject.id} has inconsistent bytes for ${url}`,
      );
    }
  }
}

export function refuseMissingResources(
  document: RenderDocument,
  missing: ReadonlySet<string>,
): void {
  if (missing.size === 0) return;
  throw new Error(
    `resource-closed document ${document.subject.id} requested unavailable resources: ` +
      [...missing].sort().join(', '),
  );
}
