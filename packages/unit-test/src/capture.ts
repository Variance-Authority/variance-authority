import type { CaptureArtifact } from '@variance-authority/core';
import {
  digestBytes,
  type Holding,
  type Provenance,
  type Wiring,
  type RenderDocument,
  type RenderResource,
  type SubjectRef,
  type Viewport,
} from '@variance-authority/core/format';
import { normalize } from '@variance-authority/core/rules';
import {
  acquireDocument,
  collect,
  conditionsFor,
  indexStyleSheets,
  referencedAssets,
} from '@variance-authority/dom';

export interface ResolvedResource {
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

export interface UnitCaptureOptions {
  readonly subject: string | SubjectRef;
  readonly viewport: Viewport;
  readonly engine?: string;
  readonly fonts?: readonly string[];
  readonly features?: Readonly<Record<string, string>>;
  readonly sourceRoot?: string;
  readonly resolveResource?: (url: string) => Promise<ResolvedResource | null>;

  /**
   * Framework readers, passed straight through to `collect`.
   *
   * Three callbacks rather than one adapter object, mirroring `CollectOptions`
   * exactly, because they are opted into separately and cost differently: an
   * owner chain is a name, and a holding is a digest of every hook cell and
   * every prop in the tree. A caller reading a subject twice to ask whether it
   * is stable wants all three; a caller archiving a fixture for a pixel diff
   * wants none, and neither should be inferred from the other.
   *
   * Absent by default. This package does not import React, and a capture taken
   * without them carries no component names — not empty ones.
   */
  readonly provenanceOf?: (element: Element) => Provenance | undefined;
  readonly wiringOf?: (element: Element) => Wiring | undefined;
  readonly holdingOf?: (element: Element) => Holding | undefined;
}

/** Capture a mounted DOM tree without importing or launching a browser. */
export async function capture(
  root: Element,
  options: UnitCaptureOptions,
): Promise<CaptureArtifact> {
  const subject: SubjectRef =
    typeof options.subject === 'string'
      ? { id: options.subject, kind: 'fixture' }
      : options.subject;
  const owner = root.ownerDocument;
  const index = indexStyleSheets(
    owner,
    conditionsFor(owner, options.viewport, options.features),
  );
  const acquireOptions = {
    subject,
    viewport: options.viewport,
    ...(options.fonts === undefined ? {} : { fonts: options.fonts }),
    ...(options.features === undefined ? {} : { features: options.features }),
    index,
  };
  const acquired = acquireDocument(root, acquireOptions);
  const urls = resourceUrls(root, acquired);
  const resources = await closeResources(urls, options.resolveResource);
  const assets = Object.fromEntries(
    Object.entries(resources).map(([url, resource]) => [url, resource.digest]),
  );
  const raw = collect(root, {
    ...acquireOptions,
    engine: options.engine ?? engineOf(owner),
    assets,
    ...(options.provenanceOf === undefined ? {} : { provenanceOf: options.provenanceOf }),
    ...(options.wiringOf === undefined ? {} : { wiringOf: options.wiringOf }),
    ...(options.holdingOf === undefined ? {} : { holdingOf: options.holdingOf }),
  });

  const document: RenderDocument = {
    ...acquired,
    assets,
    baseUrl: owner.baseURI,
    resources,
  };

  return {
    artifactVersion: 1,
    subject,
    material: { kind: 'document', document },
    snapshot: normalize(
      raw,
      options.sourceRoot === undefined ? {} : { sourceRoot: options.sourceRoot },
    ),
  };
}

function engineOf(document: Document): string {
  return document.defaultView?.navigator.userAgent ?? 'dom/unknown';
}

const URL_REFERENCE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)/g;

/**
 * The five entities a serializer writes into an attribute value.
 *
 * An inline `style` reaches us through HTML serialization, so a stylesheet's
 * `url("/a.png?x=1&y=2")` arrives spelled `url(&quot;/a.png?x=1&amp;y=2&quot;)`.
 * Reading that literally asks the caller to produce bytes for a URL that exists
 * nowhere but in the escaping.
 */
function unescapeAttribute(value: string): string {
  return value.replace(
    /&(?:quot|apos|#39|amp|lt|gt);/g,
    (entity) =>
      ({ '&quot;': '"', '&apos;': "'", '&#39;': "'", '&amp;': '&', '&lt;': '<', '&gt;': '>' })[
        entity
      ] ?? entity,
  );
}

function resourceUrls(root: Element, document: RenderDocument): readonly string[] {
  const found = new Set(referencedAssets(root));
  const base = root.ownerDocument.baseURI;
  const text = [document.html, ...document.css].join('\n');

  for (const match of document.html.matchAll(URL_REFERENCE)) {
    const value = unescapeAttribute(match[1] ?? match[2] ?? match[3] ?? '');
    addReference(found, value.replace(/^["']|["']$/g, ''), base);
  }
  for (const sheet of document.css) {
    for (const match of sheet.matchAll(URL_REFERENCE)) {
      addReference(found, match[1] ?? match[2] ?? match[3] ?? '', base);
    }
  }

  if (/\bblob:/i.test(text)) {
    throw new Error(
      `capture ${document.subject.id} is not portable: blob URLs have process-local bytes`,
    );
  }

  return [...found].sort();
}

function addReference(found: Set<string>, value: string, base: string): void {
  if (value === '' || /^(data|about|javascript):/i.test(value) || value.startsWith('#')) return;
  try {
    found.add(new URL(value, base).toString());
  } catch {
    throw new Error(`capture contains an unresolved resource reference: ${value}`);
  }
}

async function closeResources(
  urls: readonly string[],
  resolve: UnitCaptureOptions['resolveResource'],
): Promise<Readonly<Record<string, RenderResource>>> {
  if (urls.length > 0 && resolve === undefined) {
    throw new Error(
      `capture is not resource-closed; supply resolveResource for: ${urls.join(', ')}`,
    );
  }

  const closed: Record<string, RenderResource> = {};
  for (const url of urls) {
    const response = await resolve!(url);
    if (response === null) throw new Error(`capture could not archive resource: ${url}`);
    closed[url] = {
      contentType: response.contentType,
      bytes: Buffer.from(response.bytes).toString('base64'),
      digest: digestBytes(response.bytes),
    };
  }
  return closed;
}
