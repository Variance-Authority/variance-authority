import type { Diagnostic } from '@variance-authority/core/format';
import { fileAttributes } from './assets.js';

/**
 * Images a page made from bytes it held, carried as those bytes.
 *
 * A page that computes an image — a canvas encoded to a blob, a file the user
 * dropped, a response read as a blob — shows it through an object URL,
 * `blob:<origin>/<uuid>`. That URL names memory in the document that minted
 * it, and nothing else can resolve it. The deferred renderer paints the render
 * document in a page of its own, so a document that carried the URL painted a
 * broken image where the page showed a picture; and the uuid is new on every
 * load, so one picture acquired twice was two documents, and `settle` never
 * found the baseline's digest again.
 *
 * So each object URL in an attribute that names a file is read here, in the
 * page that can still read it, and written into the document as a `data:` URL
 * of the same bytes. The document then holds what the image shows, and its
 * digest moves when the picture does and only then. `referencedAssets` leaves
 * `data:` out of the asset key for that reason: the bytes are in the document.
 *
 * The read is a synchronous request, because acquisition is one synchronous
 * pass and an object URL is answered from memory. Its response is taken as
 * `x-user-defined` text, the one way a synchronous request in a window hands
 * back bytes, since a window refuses it a `responseType`.
 *
 * An object URL nothing can read any more — revoked after the image loaded,
 * or in a host with no request — keeps its URL and is reported as an `error`:
 * the render paints that image broken where the page shows it whole, and a
 * comparison of the two would agree with a picture nobody saw.
 */

/** One attribute of one element, as the render document must write it. */
export interface AttributeEdit {
  readonly name: string;
  readonly namespace: string | null;
  readonly value: string;
}

export interface CarriedObjectUrls {
  /** The attribute edits that put each object URL's bytes in its place, by element. */
  readonly edits: ReadonlyMap<Element, readonly AttributeEdit[]>;
  readonly diagnostics: readonly Diagnostic[];
}

const OBJECT_URL = /^\s*blob:/i;

/** Every object URL in `root`'s subtree, `root` included, read into a `data:` URL. */
export function carryObjectUrls(root: Element, pathAttribute: string): CarriedObjectUrls {
  const view = root.ownerDocument.defaultView;
  const read = new Map<string, string | undefined>();
  const bytesOf = (url: string): string | undefined => {
    if (!read.has(url)) read.set(url, dataUrlOf(url, view));
    return read.get(url);
  };

  const edits = new Map<Element, AttributeEdit[]>();
  const diagnostics: Diagnostic[] = [];

  for (const element of [root, ...root.querySelectorAll('*')]) {
    for (const attribute of fileAttributes(element)) {
      const value = element.getAttributeNS(attribute.namespace, attribute.name);
      if (value === null || !/blob:/i.test(value)) continue;

      const unreadable: string[] = [];
      const carried = (attribute.candidates ? candidatesOf(value) : [{ url: value.trim(), rest: '' }])
        .map(({ url, rest }) => {
          if (!OBJECT_URL.test(url)) return url + rest;
          const data = bytesOf(url);
          if (data === undefined) unreadable.push(url);
          return (data ?? url) + rest;
        })
        .join(', ');

      for (const url of unreadable) {
        const path = element.getAttribute(pathAttribute);
        diagnostics.push({
          severity: 'error',
          code: 'unreadable-object-url',
          message:
            `<${element.tagName.toLowerCase()} ${attribute.name}="${url}"> names memory in the page ` +
            'that this host could no longer read, so the render paints it broken where the page ' +
            'shows it; keep the URL until the subject has been acquired',
          ...(path !== null ? { nodePath: path } : {}),
        });
      }

      if (carried !== value) {
        const list = edits.get(element) ?? [];
        list.push({ name: attribute.name, namespace: attribute.namespace, value: carried });
        edits.set(element, list);
      }
    }
  }

  return { edits, diagnostics };
}

/** `a.png 1x, blob:… 2x` → each URL with what follows it. Descriptors are not URLs. */
function candidatesOf(value: string): readonly { readonly url: string; readonly rest: string }[] {
  return value
    .split(',')
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate !== '')
    .map((candidate) => {
      const space = candidate.search(/\s/);
      return space === -1
        ? { url: candidate, rest: '' }
        : { url: candidate.slice(0, space), rest: candidate.slice(space) };
    });
}

/** The bytes behind an object URL, as a `data:` URL of the type the blob was given. */
function dataUrlOf(url: string, view: Window | null): string | undefined {
  if (view === null) return undefined;
  // On the global and not on `Window`'s type: jsdom and every browser put it there.
  const Request = (view as Window & { XMLHttpRequest?: typeof XMLHttpRequest }).XMLHttpRequest;
  if (Request === undefined) return undefined;

  let text: string;
  let type: string;
  try {
    const request = new Request();
    request.open('GET', url, false);
    request.overrideMimeType('text/plain; charset=x-user-defined');
    request.send();
    if (request.status !== 200) return undefined;
    text = request.responseText;
    type = request.getResponseHeader('content-type') ?? '';
  } catch {
    // A revoked URL fails the request outright; nothing here can read it.
    return undefined;
  }

  // Each character carries one byte in its low eight bits.
  const chunks: string[] = [];
  for (let start = 0; start < text.length; start += 0x8000) {
    const codes: number[] = [];
    const end = Math.min(start + 0x8000, text.length);
    for (let index = start; index < end; index += 1) codes.push(text.charCodeAt(index) & 0xff);
    chunks.push(String.fromCharCode(...codes));
  }
  return `data:${type};base64,${view.btoa(chunks.join(''))}`;
}
