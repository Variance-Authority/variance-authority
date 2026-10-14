import type { Diagnostic } from '@variance-authority/core/format';
import { fileAttributes, srcsetCandidates } from './assets.js';
import { URL_TOKEN } from './css-url.js';

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
 * So each object URL the document would carry is read here, in the page that
 * can still read it, and written into the document as a `data:` URL of the
 * same bytes. The document then holds what the image shows, and its
 * digest moves when the picture does and only then. `referencedAssets` leaves
 * `data:` out of the asset key for that reason: the bytes are in the document.
 *
 * The read is a synchronous request, because acquisition is one synchronous
 * pass and an object URL is answered from memory. Its response is taken as
 * `x-user-defined` text, the one way a synchronous request in a window hands
 * back bytes, since a window refuses it a `responseType`.
 *
 * An object URL nothing can read — revoked after the image loaded, or in a
 * host with no request — keeps its URL. In a host that paints, it is an
 * `error`: the render paints that image broken where the page shows it whole,
 * and a comparison of the two would agree with a picture nobody saw. A host
 * that paints nothing, such as jsdom, mints no object URLs either, so the URL is
 * a string a test wrote and no page showed its picture; that is the host's
 * standing limit, and a `warn`, as an unread font face is.
 */

/** One attribute of one element, as the render document must write it. */
export interface AttributeEdit {
  readonly name: string;
  readonly namespace: string | null;
  readonly value: string;
}

/** The text a `<style>` must hold, written in place of what it holds. */
export interface TextEdit {
  readonly text: string;
}

export interface ObjectUrls {
  /** What `element` must write so none of its own attributes names an object URL. */
  editsOf(element: Element): readonly AttributeEdit[];
  /**
   * The edits of every element in `root`'s subtree, `root` included, that needs
   * one: its attributes, and the text of a `<style>`, which the markup carries
   * as written.
   */
  editsIn(root: Element): ReadonlyMap<Element, readonly (AttributeEdit | TextEdit)[]>;
  /** `css` with every `url()` that names an object URL naming its bytes; `place` says where it was read. */
  inCss(css: string, place: string, nodePath?: string): string;
  /** An `unreadable-object-url` error for each place an object URL could not be read. */
  readonly diagnostics: readonly Diagnostic[];
}

const OBJECT_URL = /^\s*blob:/i;

/**
 * `type/subtype`, the media type a `data:` URL may be written with. A blob's
 * type is any printable text the page gave it, and written as given it could
 * close the `url("…")` or the `<style>` holding it; parameters are dropped.
 */
const MEDIA_TYPE = /^[\w!#$&^.+-]+\/[\w!#$&^.+-]+/;

/**
 * One reader per acquisition, so a URL named in markup, in a rule and in a
 * custom property is read once.
 *
 * A style names a file as surely as `src` does, so the attributes that name a
 * file, an element's `style`, the rules the subject is painted with and the
 * values it inherits are all carried: a `background-image` set from script is
 * the same broken picture in the render as an `<img>` was.
 *
 * `painted` is whether this host paints, as the acquisition's profile says; it
 * decides whether an unreadable URL is an error or a warning.
 */
export function objectUrls(view: Window | null, pathAttribute: string, painted: boolean): ObjectUrls {
  const read = new Map<string, string | undefined>();
  const diagnostics: Diagnostic[] = [];

  const carried = (url: string, place: string, nodePath: string | undefined): string => {
    if (!OBJECT_URL.test(url)) return url;
    if (!read.has(url)) read.set(url, dataUrlOf(url.trim(), view));
    const data = read.get(url);
    if (data !== undefined) return data;
    diagnostics.push({
      severity: painted ? 'error' : 'warn',
      code: 'unreadable-object-url',
      message: painted
        ? `${place} names memory in the page that this host could not read, so the ` +
          'render paints it broken where the page shows it; keep the URL until the subject ' +
          'has been acquired'
        : `${place} names memory this host could not read, and this host paints nothing ` +
          'to show it; the render paints a broken image in its place',
      ...(nodePath !== undefined ? { nodePath } : {}),
    });
    return url;
  };

  const inCss = (css: string, place: string, nodePath?: string): string => {
    if (!/blob:/i.test(css)) return css;
    return css.replace(URL_TOKEN, (token, double?: string, single?: string, bare?: string) => {
      const url = double ?? single ?? bare ?? '';
      if (!OBJECT_URL.test(url)) return token;
      const data = carried(url, `url(${url}) in ${place}`, nodePath);
      return data === url ? token : `url("${data}")`;
    });
  };

  const editsOf = (element: Element): readonly AttributeEdit[] => {
    const tag = element.tagName.toLowerCase();
    const nodePath = element.getAttribute(pathAttribute) ?? undefined;
    const edits: AttributeEdit[] = [];

    for (const attribute of fileAttributes(element)) {
      const value = element.getAttributeNS(attribute.namespace, attribute.name);
      if (value === null || !/blob:/i.test(value)) continue;
      const written = (attribute.candidates ? srcsetCandidates(value) : [{ url: value.trim(), descriptor: '' }])
        .map(({ url, descriptor }) => {
          const data = carried(url, `<${tag} ${attribute.name}="${url}">`, nodePath);
          return descriptor === '' ? data : `${data} ${descriptor}`;
        })
        .join(', ');
      if (written !== value) edits.push({ name: attribute.name, namespace: attribute.namespace, value: written });
    }

    const style = element.getAttribute('style');
    if (style !== null) {
      const written = inCss(style, `the style of <${tag}>`, nodePath);
      if (written !== style) edits.push({ name: 'style', namespace: null, value: written });
    }

    return edits;
  };

  return {
    editsOf,
    editsIn(root) {
      const edits = new Map<Element, readonly (AttributeEdit | TextEdit)[]>();
      for (const element of [root, ...root.querySelectorAll('*')]) {
        const own: (AttributeEdit | TextEdit)[] = [...editsOf(element)];
        if (element.localName === 'style') {
          const text = element.textContent ?? '';
          const nodePath = element.getAttribute(pathAttribute) ?? undefined;
          const written = inCss(text, 'a <style> in the subject', nodePath);
          if (written !== text) own.push({ text: written });
        }
        if (own.length > 0) edits.set(element, own);
      }
      return edits;
    },
    inCss,
    diagnostics,
  };
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
    type = MEDIA_TYPE.exec(request.getResponseHeader('content-type') ?? '')?.[0] ?? '';
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
