import type { RawNode } from '../../format/capture.js';
import { ID_REFERENCE_ATTRIBUTES, ID_REFERENCE_LIST_ATTRIBUTES } from '../ruleset.js';

/**
 * Structural id aliasing (ADR-0003).
 *
 * React's `useId` allocates in mount order, so mounting an unrelated component
 * earlier renumbers every id on the page. Headless component libraries generate
 * an id for every `label ↔ input` and `aria-*` association. None of those values
 * mean anything; all of them churn.
 *
 * Masking them to a constant would work, and would also erase the difference
 * between "the id was renumbered" and "the association was broken" — the second
 * being a real accessibility regression. Aliasing keeps the relationship and
 * discards only the value: every id becomes `#a0`, `#a1`, … in document order,
 * and every reference is rewritten to match.
 */

export interface AliasMap {
  /** Original id → `#aN`, for ids defined inside the subject subtree. */
  readonly local: ReadonlyMap<string, string>;
  /** Original id → `#extern:N`, for references that escape the subtree. */
  readonly external: ReadonlyMap<string, string>;
}

export interface AliasResult extends AliasMap {
  /** Ids referenced but never defined anywhere. A real defect, kept visible. */
  readonly dangling: readonly string[];
}

const ID_LIST_ATTRIBUTES = new Set(ID_REFERENCE_LIST_ATTRIBUTES);
const ID_REFERENCE = new Set(ID_REFERENCE_ATTRIBUTES);

/**
 * Assign aliases by walking the subtree in document order.
 *
 * Two passes, because a reference may precede its definition — `aria-labelledby`
 * pointing forward at a sibling is ordinary markup. Collecting every definition
 * first is what keeps the alias of an id independent of where it is mentioned.
 */
export function buildAliasMap(root: RawNode, portals: readonly RawNode[] = []): AliasResult {
  const local = new Map<string, string>();
  const external = new Map<string, string>();
  const dangling: string[] = [];

  // Portalled content is part of the subject (ADR-0007), so it shares one alias
  // space with the container. A dialog whose `aria-labelledby` points at a title
  // inside the portal must resolve, not report as dangling.
  const roots = [root, ...portals];
  const walkAll = (visit: (node: RawNode) => void): void => {
    for (const each of roots) walk(each, visit);
  };

  walkAll((node) => {
    const id = node.attributes['id'];
    if (id !== undefined && id.length > 0 && !local.has(id)) {
      local.set(id, `#a${local.size}`);
    }
  });

  walkAll((node) => {
    for (const [name, value] of Object.entries(node.attributes)) {
      for (const reference of referencesIn(name, value)) {
        if (local.has(reference) || external.has(reference)) continue;
        // Escaping the subtree is not the same as pointing at nothing, but from
        // inside the subject the two are indistinguishable — so both are aliased
        // and flagged rather than normalized into invisibility.
        external.set(reference, `#extern:${external.size}`);
        dangling.push(reference);
      }
    }
  });

  return { local, external, dangling };
}

/**
 * Rewrite one attribute value through the alias map.
 *
 * Only attributes that actually hold id references are touched. Aliasing
 * anything else would rewrite ordinary values — `type="button"` has no id in it,
 * and mapping it through would corrupt every attribute in the snapshot.
 */
export function aliasAttributeValue(map: AliasMap, name: string, value: string): string {
  if (!ID_REFERENCE.has(name) && name !== 'href' && name !== 'xlink:href') return value;

  if (name === 'id') return map.local.get(value) ?? aliasOf(map, value);

  if (ID_LIST_ATTRIBUTES.has(name)) {
    return value
      .trim()
      .split(/\s+/)
      .filter((part) => part.length > 0)
      .map((part) => aliasOf(map, part))
      .join(' ');
  }

  if (name === 'href' || name === 'xlink:href') {
    return value.startsWith('#') ? aliasOf(map, value.slice(1)) : value;
  }

  return aliasOf(map, value);
}

/**
 * Rewrite `url(#…)` fragments inside a style value.
 *
 * SVG filters, clip paths, masks, and gradients are referenced this way, and
 * their ids are generated exactly as often as any other. A `filter: url(#blur-7)`
 * that renumbers to `url(#blur-9)` paints identical pixels.
 */
export function aliasStyleValue(map: AliasMap, value: string): string {
  return value.replace(/url\(\s*(['"]?)#([^'")]+)\1\s*\)/g, (_match, quote: string, id: string) => {
    return `url(${quote}${aliasOf(map, id)}${quote})`;
  });
}

function aliasOf(map: AliasMap, id: string): string {
  return map.local.get(id) ?? map.external.get(id) ?? `#extern:?${id.length}`;
}

function referencesIn(name: string, value: string): readonly string[] {
  if (name === 'id') return [];

  if (ID_LIST_ATTRIBUTES.has(name)) {
    return value.trim().split(/\s+/).filter((part) => part.length > 0);
  }

  if (name === 'for' || name === 'form' || name === 'list') {
    return value.length > 0 ? [value] : [];
  }

  if (name === 'href' || name === 'xlink:href') {
    return value.startsWith('#') ? [value.slice(1)] : [];
  }

  // Only the `aria-*` attributes that actually hold IDREFs. `aria-label` and
  // `aria-hidden` carry text and booleans; treating them as references would
  // report a dangling-id diagnostic for every labelled node in the tree.
  if (ID_REFERENCE.has(name)) {
    return value.length > 0 ? [value] : [];
  }

  return [];
}

function walk(node: RawNode, visit: (node: RawNode) => void): void {
  visit(node);
  for (const child of node.children) walk(child, visit);
  for (const child of node.shadowChildren ?? []) walk(child, visit);
}
