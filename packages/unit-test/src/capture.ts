import {
  digestBytes,
  normalize,
  type CaptureArtifact,
  type RenderDocument,
  type RenderResource,
  type SubjectRef,
  type Viewport,
} from '@variance-authority/core';
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

function resourceUrls(root: Element, document: RenderDocument): readonly string[] {
  const found = new Set(referencedAssets(root));
  const base = root.ownerDocument.baseURI;
  const text = [document.html, ...document.css].join('\n');

  for (const match of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)/g)) {
    addReference(found, match[1] ?? match[2] ?? match[3] ?? '', base);
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
