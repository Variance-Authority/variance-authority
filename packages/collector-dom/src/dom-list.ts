/**
 * Index-based iteration over legacy DOM collections.
 *
 * `CSSStyleDeclaration`, `CSSRuleList`, `StyleSheetList`, `NamedNodeMap`, and
 * `HTMLCollection` are all `length`-plus-`item()` interfaces. Browsers have
 * retrofitted `Symbol.iterator` onto several of them; JSDOM has not, and which
 * ones are covered differs by engine and version.
 *
 * `for...of` over them therefore works in Chromium and throws in JSDOM — an
 * engine-dependent crash in the one component whose entire purpose is to behave
 * identically on both. Everything here goes through these helpers instead.
 */

interface IndexedCollection<T> {
  readonly length: number;
  item?(index: number): T | null;
  readonly [index: number]: T;
}

/**
 * Read a collection by index, preferring `item()` and falling back to bracket
 * access.
 *
 * The fallback is not defensive padding. JSDOM's CSS object model comes from
 * `cssom`, whose `CSSRuleList` is a bare array-like with a `length` and no
 * `item` method at all — so a browser-correct `item()` call throws there, while
 * bracket access works on both. Neither form alone covers both engines.
 */
export function items<T>(collection: IndexedCollection<T> | null | undefined): T[] {
  if (!collection) return [];

  const result: T[] = [];
  for (let index = 0; index < collection.length; index += 1) {
    const value =
      typeof collection.item === 'function' ? collection.item(index) : collection[index];
    if (value !== null && value !== undefined) result.push(value);
  }
  return result;
}

/**
 * Property names of a `CSSStyleDeclaration`.
 *
 * Separate from {@link items} because its `item()` returns property *names*
 * rather than nodes, and because a declaration block with a `length` of 0 is
 * routine rather than exceptional.
 */
export function propertyNames(style: CSSStyleDeclaration | null | undefined): string[] {
  if (!style) return [];

  const names: string[] = [];
  for (let index = 0; index < style.length; index += 1) {
    // Same split as `items`: JSDOM's `cssom`-backed declaration blocks expose
    // indices without an `item` method.
    const name =
      typeof style.item === 'function'
        ? style.item(index)
        : (style as unknown as Record<number, string>)[index];
    if (name) names.push(name);
  }
  return names;
}

/** Elements of an `HTMLCollection`, which has `item()` but not always an iterator. */
export function elements(collection: HTMLCollection | null | undefined): Element[] {
  if (!collection) return [];

  const result: Element[] = [];
  for (let index = 0; index < collection.length; index += 1) {
    const element =
      typeof collection.item === 'function' ? collection.item(index) : collection[index];
    if (element) result.push(element);
  }
  return result;
}

/** Attributes of an element, as plain name/value pairs. */
export function attributesOf(element: Element): Record<string, string> {
  const attributes: Record<string, string> = {};
  const map = element.attributes;

  for (let index = 0; index < map.length; index += 1) {
    const attribute = typeof map.item === 'function' ? map.item(index) : map[index];
    if (attribute) attributes[attribute.name] = attribute.value;
  }

  return attributes;
}

/** Child nodes, via `childNodes.item`. */
export function childNodesOf(node: Node): Node[] {
  const children: Node[] = [];
  const list = node.childNodes;

  for (let index = 0; index < list.length; index += 1) {
    const child = typeof list.item === 'function' ? list.item(index) : list[index];
    if (child) children.push(child);
  }

  return children;
}

/** Class names, without relying on `DOMTokenList` being iterable. */
export function classNamesOf(element: Element): string[] {
  const value = element.getAttribute('class');
  if (!value) return [];
  return value.trim().split(/\s+/).filter((name) => name.length > 0);
}
