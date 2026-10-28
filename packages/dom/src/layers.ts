/**
 * Cascade layers, read from the page and written back into the render document.
 *
 * A layer decides a cascade before specificity does: a normal declaration in an
 * earlier layer loses to one in a later layer, and every layered one loses to an
 * unlayered one, whatever their selectors weigh. The index flattens a sheet into
 * rules, and a flattened rule that forgets its layer is ranked by specificity
 * alone. Tailwind v4 puts its preflight in `base`, so `h2 { font-size: inherit }`
 * then beat a page's own `:where(.prose h2) { font-size: 1.65rem }`, and every
 * heading on the site's reference pages painted at body size.
 *
 * So the index records the layer each rule sat in and the order the page
 * declared the layers in, and the render document declares that order once and
 * puts each rule back in its layer. Order within a layer stays document order,
 * which is the order the rules are emitted in.
 */

/** The full name of a layer, as the page would address it: `components.cards`. */
export type LayerName = string;

/** Layer names in the order the page declared them, parents ahead of their children. */
export class LayerOrder {
  private readonly declared: LayerName[] = [];
  private readonly seen = new Set<LayerName>();
  private anonymous = 0;

  /** Declares a layer and every layer it is nested in, each the first time it is seen. */
  declare(name: LayerName): void {
    const parts = name.split('.');
    for (let depth = 1; depth <= parts.length; depth += 1) {
      const prefix = parts.slice(0, depth).join('.');
      if (this.seen.has(prefix)) continue;
      this.seen.add(prefix);
      this.declared.push(prefix);
    }
  }

  /**
   * A name for a layer the page left anonymous.
   *
   * Every `@layer { … }` block is a layer of its own that nothing else can add
   * to, and the render document has to write each rule's layer by name. The
   * prefix is ours; a page naming a layer `va-anonymous-1` is the collision this
   * accepts.
   */
  anonymousWithin(parent: LayerName | undefined): LayerName {
    this.anonymous += 1;
    return within(parent, `va-anonymous-${this.anonymous}`);
  }

  get names(): readonly LayerName[] {
    return this.declared;
  }
}

/** A layer's full name, given the layer its rule is nested in. */
export function within(parent: LayerName | undefined, name: string): LayerName {
  return parent === undefined ? name : `${parent}.${name}`;
}

/** The names an `@layer a, b;` statement declares; `null` for any other rule. */
export function layerStatementNames(rule: CSSRule): readonly string[] | null {
  if (!('nameList' in rule)) return null;
  return Array.from((rule as CSSRule & { nameList: ArrayLike<string> }).nameList);
}

/**
 * The name of an `@layer name { … }` block, `''` when it has none; `null` for
 * any other rule.
 *
 * Read by the rule's constructor, as `conditionOf` reads `@media`: `name` alone
 * would also admit `@keyframes`.
 */
export function layerBlockName(rule: CSSRule): string | null {
  if (rule.constructor.name !== 'CSSLayerBlockRule') return null;
  return (rule as CSSRule & { name: string }).name;
}

/** A rule's text, and the layer it sat in; absent when it sat in none. */
export interface LayeredText {
  readonly text: string;
  readonly layer?: LayerName;
}

/**
 * Rules in document order, written back into their layers.
 *
 * One statement declares the layers the rules use, in the page's order, ahead
 * of every rule; after it, the position a layer is first written at decides
 * nothing. A run of rules in one layer shares a block.
 */
export function inLayers(rules: readonly LayeredText[], order: readonly LayerName[]): string {
  const used = new Set<LayerName>();
  for (const rule of rules) if (rule.layer !== undefined) used.add(rule.layer);
  if (used.size === 0) return rules.map((rule) => rule.text).join('\n');

  const declared = order.filter((name) =>
    [...used].some((layer) => layer === name || layer.startsWith(`${name}.`)),
  );
  const lines = [`@layer ${declared.join(', ')};`];
  let open: LayerName | undefined;
  for (const rule of rules) {
    if (rule.layer !== open) {
      if (open !== undefined) lines.push('}');
      if (rule.layer !== undefined) lines.push(`@layer ${rule.layer} {`);
      open = rule.layer;
    }
    lines.push(rule.text);
  }
  if (open !== undefined) lines.push('}');
  return lines.join('\n');
}
