import type { BrowserContext } from 'playwright';
import { assetUrl, digestBytes, type RenderDocument } from '@variance-authority/core/format';

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

/**
 * Answer an open document's font requests as the page that declared the faces.
 *
 * A render is a `setContent` on `about:blank`, so a face the page served from
 * its own origin is, in the render, a cross-origin font — and a font is fetched
 * in CORS mode, so the browser refuses it unless the server says otherwise, and
 * a collector's server or a developer's has no reason to. What is left is the
 * fallback, in a document that names the face, and a change to that face moves
 * no image. The closed path does not meet this: it answers every request itself
 * and says so.
 *
 * Only fonts are taken over, and only for a document that carries a face: a
 * context with a route holds no HTTP cache, which is a cost every other render
 * has no reason to pay.
 */
export async function serveOpenFaces(context: BrowserContext, document: RenderDocument): Promise<void> {
  if (!document.css.some((sheet) => sheet.includes('@font-face'))) return;

  await context.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'font') {
      await route.continue();
      return;
    }

    let response;
    try {
      response = await route.fetch();
    } catch {
      // Unreachable is what the browser would have met on its own.
      await route.abort('failed');
      return;
    }
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'access-control-allow-origin': '*' },
    });
  });
}

export function assertClosedResources(document: RenderDocument): void {
  if (document.resources === undefined) return;

  for (const [key, expected] of Object.entries(document.assets ?? {})) {
    // An asset the page's own origin serves is keyed by its path, and the
    // bytes are keyed by the URL the browser asked for.
    const url = assetUrl(key, document.baseUrl);
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
