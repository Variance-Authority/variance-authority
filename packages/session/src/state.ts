import { digestString } from '@variance-authority/core/format';

/**
 * Shared-state probe.
 *
 * The cost argument for this whole package is that tearing the world down
 * between subjects is the expensive part, and almost never necessary. So we do
 * not tear it down — we photograph it.
 *
 * A probe is a cheap fingerprint of everything a subject could leave behind that
 * a *later* subject could read: stylesheets, root custom properties, root and
 * body attributes, stray body children, and the title. Diffing two probes gives
 * the set of shared-state keys a subject wrote, which is what makes
 * cross-pollution attributable instead of merely suspected.
 *
 * The probe deliberately does **not** read `getComputedStyle` or measure
 * anything. It must stay far cheaper than the work it replaces, or the saving
 * evaporates.
 */

/**
 * A shared-state address.
 *
 * Strings rather than a union so that a key is legible in a report without a
 * decoder — `sheet:<style:3>` is the finding, and an agent acting on it should
 * not have to look up what a numeric enum meant.
 */
export type StateKey = string;

export interface StateProbe {
  /** Key → fingerprint. A key present in one probe and absent in another moved. */
  readonly values: ReadonlyMap<StateKey, string>;
  /** Nodes directly under `<body>`, for residue detection and targeted rinse. */
  readonly bodyChildren: readonly Element[];
  readonly sheets: ReadonlyMap<StateKey, CSSStyleSheet>;
}

export interface StateDelta {
  readonly written: ReadonlySet<StateKey>;
  /** Keys that existed before and no longer do. Removal is a write too. */
  readonly removed: ReadonlySet<StateKey>;
}

/**
 * Stable per-session ids for stylesheets.
 *
 * `CSSStyleSheet` has no identity a report can name, and index-in-`styleSheets`
 * is not one either: inserting a sheet renumbers every sheet after it, so
 * index-keyed writes would show the whole page as modified whenever anything
 * added a `<style>`. Identity is tracked by owner node instead.
 */
export class SheetRegistry {
  readonly #ids = new WeakMap<object, string>();
  readonly #fingerprints = new WeakMap<object, { source: string; digest: string }>();
  #next = 0;

  /**
   * Fingerprint a sheet, reusing the previous answer when its source is byte
   * identical.
   *
   * This is the difference between a probe that pays for itself and one that does
   * not. Serializing every `cssRules` entry costs O(rules) per probe, twice per
   * subject — so a design system's stylesheet gets re-serialized a few hundred
   * times a session to conclude, every time, that nothing changed.
   *
   * A `<style>` element's `textContent` *is* its source, so comparing that string
   * answers "did this sheet change?" in one pass instead of N serializations, and
   * usually in O(1) because the string is the same reference. Sheets without an
   * owner node — constructed and adopted stylesheets — have no source to compare
   * and fall back to serialization.
   */
  fingerprint(sheet: CSSStyleSheet): string {
    const owner = sheet.ownerNode as (Node & { textContent: string | null }) | null;
    const source = owner?.textContent;

    if (source === undefined || source === null) return serializeRules(sheet);

    const cached = this.#fingerprints.get(owner as object);
    if (cached && cached.source === source) return cached.digest;

    const digest = digestString(source);
    this.#fingerprints.set(owner as object, { source, digest });
    return digest;
  }

  idFor(sheet: CSSStyleSheet): string {
    const owner = (sheet.ownerNode as object | null) ?? (sheet as object);
    const existing = this.#ids.get(owner);
    if (existing !== undefined) return existing;

    const href = sheet.href;
    const id = href ?? `<style:${this.#next++}>`;
    this.#ids.set(owner, id);
    return id;
  }
}

export interface ProbeOptions {
  /**
   * Containers the harness owns.
   *
   * Their contents are the subject under test, not residue, so they are excluded
   * from body-child accounting. Without this every subject would appear to
   * pollute the body with its own output.
   */
  readonly ownedContainers: readonly Element[];
  readonly registry: SheetRegistry;
}

export function probe(document: Document, options: ProbeOptions): StateProbe {
  const values = new Map<StateKey, string>();
  const sheets = new Map<StateKey, CSSStyleSheet>();

  const sheetList = document.styleSheets;
  for (let index = 0; index < sheetList.length; index += 1) {
    const sheet = sheetList[index] as CSSStyleSheet | undefined;
    if (!sheet) continue;

    const id = options.registry.idFor(sheet);
    values.set(`sheet:${id}`, options.registry.fingerprint(sheet));
    sheets.set(`sheet:${id}`, sheet);
  }

  const root = document.documentElement;
  if (root) {
    for (const [name, value] of customPropertiesOf(root)) {
      values.set(`root-custom:${name}`, value);
    }
    for (const name of ROOT_ATTRIBUTES) {
      const value = root.getAttribute(name);
      if (value !== null) values.set(`root-attr:${name}`, value);
    }
  }

  const body = document.body;
  const bodyChildren: Element[] = [];
  if (body) {
    for (const name of ROOT_ATTRIBUTES) {
      const value = body.getAttribute(name);
      if (value !== null) values.set(`body-attr:${name}`, value);
    }

    const children = body.children;
    for (let index = 0; index < children.length; index += 1) {
      const child = children.item(index);
      if (!child) continue;
      if (options.ownedContainers.some((owned) => owned === child || owned.contains(child))) {
        continue;
      }
      bodyChildren.push(child);
    }
    values.set('body-residue', String(bodyChildren.length));
  }

  values.set('title', document.title);

  return { values, bodyChildren, sheets };
}

export function diffProbes(before: StateProbe, after: StateProbe): StateDelta {
  const written = new Set<StateKey>();
  const removed = new Set<StateKey>();

  for (const [key, value] of after.values) {
    if (before.values.get(key) !== value) written.add(key);
  }
  for (const key of before.values.keys()) {
    if (!after.values.has(key)) {
      removed.add(key);
      written.add(key);
    }
  }

  return { written, removed };
}

/**
 * Fingerprint by rule *text*, for sheets with no readable source.
 *
 * Rule text rather than rule count, because the case that matters most is a
 * CSS-in-JS runtime rewriting a rule in place: what every consumer of that class
 * renders changes while the sheet stays exactly as long as it was.
 *
 * A cross-origin sheet throws on access and fingerprints as unreadable. Two
 * unreadable sheets compare equal, so a change inside one is invisible — a known
 * blind spot, recorded rather than papered over, because the alternative
 * (treating every unreadable sheet as changed every time) would mark every
 * subject as polluted by every other and make the report worthless.
 */
function serializeRules(sheet: CSSStyleSheet): string {
  let rules: CSSRuleList;
  try {
    rules = sheet.cssRules;
  } catch {
    return 'unreadable';
  }

  const parts: string[] = [];
  for (let index = 0; index < rules.length; index += 1) {
    const rule = typeof rules.item === 'function' ? rules.item(index) : rules[index];
    if (rule) parts.push(rule.cssText);
  }

  return digestString(parts.join('\n'));
}

/**
 * Custom properties declared inline on an element.
 *
 * Inline only, deliberately. Custom properties set by a stylesheet already show
 * up as a change to that sheet's fingerprint, and reading resolved values would
 * mean `getComputedStyle` on every probe — the exact per-subject cost this
 * package exists to avoid.
 */
function customPropertiesOf(element: Element): Array<[string, string]> {
  const style = (element as HTMLElement).style;
  const entries: Array<[string, string]> = [];
  if (!style) return entries;

  for (let index = 0; index < style.length; index += 1) {
    const name = typeof style.item === 'function' ? style.item(index) : undefined;
    if (name && name.startsWith('--')) entries.push([name, style.getPropertyValue(name)]);
  }

  return entries;
}

/** Attributes on `<html>`/`<body>` that routinely gate CSS: themes, direction, locale. */
const ROOT_ATTRIBUTES: readonly string[] = ['class', 'style', 'dir', 'lang', 'data-theme', 'data-mode'];
