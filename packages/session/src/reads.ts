import type { RawCapture, RawNode, SemanticSnapshot } from '@variance-authority/core';
import type { StateKey } from './state.js';

/**
 * What a subject read from shared state.
 *
 * Pollution is a read-write conflict: subject B is polluted by subject A when B's
 * result depends on something A wrote. Writes come from the probe; reads come
 * from here.
 *
 * Everything in this file resolves toward **over**-reporting a read. A read we
 * miss is a pollution finding we never make — a silent order-dependent baseline,
 * which is the same class of failure as a false `unchanged`. A read we invent
 * costs a suspicion the empirical pass then clears.
 */

export interface ReadSet {
  readonly keys: ReadonlySet<StateKey>;
  /** Why each key is considered read. Turns a finding into an explanation. */
  readonly evidence: ReadonlyMap<StateKey, string>;
}

export function readsOf(capture: RawCapture, snapshot: SemanticSnapshot): ReadSet {
  const keys = new Set<StateKey>();
  const evidence = new Map<StateKey, string>();

  const note = (key: StateKey, why: string): void => {
    keys.add(key);
    if (!evidence.has(key)) evidence.set(key, why);
  };

  // Every sheet with a rule that *matched*, not only one that won.
  //
  // A losing declaration is one specificity bump away from winning, so a subject
  // whose outcome is currently unaffected by a sheet is still coupled to it. Using
  // winners only would miss the case where another subject's edit flips which rule
  // wins — which is exactly the pollution worth catching.
  walk(capture.root, (node) => {
    for (const rule of node.matchedRules) {
      note(`sheet:${rule.sheet}`, `matched \`${rule.selector}\``);
    }
  });
  for (const portal of capture.portals ?? []) {
    walk(portal, (node) => {
      for (const rule of node.matchedRules) {
        note(`sheet:${rule.sheet}`, `matched \`${rule.selector}\` (portalled)`);
      }
    });
  }

  // Custom properties the subject resolved through, wherever they were declared.
  // A token defined on `:root` by a theme fixture and consumed here is the most
  // common real coupling in a component library.
  for (const [name, value] of Object.entries(tokensOf(snapshot.root))) {
    note(`root-custom:${name}`, `resolved ${name} → ${value}`);
  }

  // Inherited values arriving from outside the subject's own subtree.
  for (const property of Object.keys(capture.inheritedSeed)) {
    if (property.startsWith('--')) {
      note(`root-custom:${property}`, 'inherited from an ancestor outside the subject');
    } else {
      note(`inherited:${property}`, 'inherited from an ancestor outside the subject');
    }
  }

  // Latent couplings the collector found: rules that do not apply now but would
  // the moment root state changes. This is the half a matched-rules-only view
  // cannot see, and the half that makes theme leakage predictable rather than
  // merely diagnosable after the fact.
  for (const key of capture.couplings ?? []) {
    note(key, 'a rule targeting this subject is gated on root state');
  }

  // A selector anchored above the subject — `html.dark .btn`, `[data-theme] &`,
  // `body > *` — makes the subject's rendering depend on root state it does not
  // own. Detected from selector text because the alternative is re-matching every
  // rule against a mutated root, which costs more than the probe it feeds.
  walk(capture.root, (node) => {
    for (const rule of node.matchedRules) {
      for (const attribute of rootAnchorsIn(rule.selector)) {
        note(attribute, `selector \`${rule.selector}\` is anchored above the subject`);
      }
    }
  });

  return { keys, evidence };
}

/**
 * Root-anchored portions of a selector, as the state keys they depend on.
 *
 * Only the part *left* of the last combinator is examined: `.btn.dark` is a class
 * on the subject's own node and couples it to nothing, while `html.dark .btn`
 * couples it to the root's class attribute.
 */
function rootAnchorsIn(selector: string): StateKey[] {
  const ancestor = ancestorPortion(selector);
  if (ancestor === null) return [];

  const keys: StateKey[] = [];
  const lower = ancestor.toLowerCase();

  if (/(^|[\s>+~,(])(html|:root)\b/.test(lower)) {
    if (/[.[]/.test(lower)) keys.push('root-attr:class', 'root-attr:data-theme');
  }
  if (/(^|[\s>+~,(])body\b/.test(lower)) {
    if (/[.[]/.test(lower)) keys.push('body-attr:class', 'body-attr:data-theme');
  }

  for (const match of ancestor.matchAll(/\[([\w-]+)/g)) {
    const attribute = match[1]!;
    if (attribute.startsWith('data-') || attribute === 'dir' || attribute === 'lang') {
      keys.push(`root-attr:${attribute}`);
    }
  }

  return keys;
}

/** Everything before the final compound selector, or `null` if there is none. */
function ancestorPortion(selector: string): string | null {
  let depth = 0;
  let lastBreak = -1;

  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index]!;
    if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (depth === 0 && (char === ' ' || char === '>' || char === '+' || char === '~')) {
      lastBreak = index;
    }
  }

  return lastBreak < 0 ? null : selector.slice(0, lastBreak);
}

function tokensOf(node: { tokens?: Readonly<Record<string, string>>; children: readonly unknown[] }): Record<string, string> {
  const found: Record<string, string> = {};

  const visit = (current: typeof node): void => {
    for (const [name, value] of Object.entries(current.tokens ?? {})) {
      found[name] = value;
    }
    for (const child of current.children) visit(child as typeof node);
  };

  visit(node);
  return found;
}

function walk(node: RawNode, visit: (node: RawNode) => void): void {
  visit(node);
  for (const child of node.children) walk(child, visit);
  for (const child of node.shadowChildren ?? []) walk(child, visit);
}
