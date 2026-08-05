/**
 * Resolving what the operator excluded, against a live DOM (spec 0024).
 *
 * This is the only step in the ignore mechanism that needs a document, which is
 * why it is here and why it is all that is here. Running a selector and reading a
 * marker attribute both require a DOM; deciding what to do with the result does
 * not, and `core` does that with no DOM at all.
 *
 * The output is a **mark**, never a deletion. A collector that dropped the
 * excluded elements would produce a capture in which nothing was ever ignored —
 * the counts would be right, every one of them would be zero, and the register
 * that makes an ignore accountable would have nothing to report. So the elements
 * stay, carrying the id of the rule that claimed them, and every later stage can
 * still say what it chose not to look at.
 */

/**
 * Marker attribute, for teams who would rather annotate markup than write config.
 *
 * The same affordance every product in this category offers, and the value is the
 * rule id so that a marked element still lands in the register under a name:
 * `data-variance-ignore="carousel"` is one accountable rule, and a bare
 * `data-variance-ignore` falls back to {@link MARKED_RULE} rather than to nothing.
 *
 * Deliberately absent from the attribute allowlist, so it never enters a hash.
 * Adding the marker to a component must not re-baseline every subject that
 * renders it — an ignore changes what a run says, not what it renders.
 */
export const IGNORE_ATTRIBUTE = 'data-variance-ignore';

/** Rule id a bare marker attribute is recorded under. */
export const MARKED_RULE = 'marked';

export interface IgnoreSelector {
  /** `IgnoreRule.id` this selector belongs to. */
  readonly id: string;

  /** A CSS selector, evaluated inside the subject only. */
  readonly select: string;
}

export interface ResolveIgnoresOptions {
  /** Selectors from the operator's config, each carrying the rule that owns it. */
  readonly selectors?: readonly IgnoreSelector[];

  /** Whether {@link IGNORE_ATTRIBUTE} in the markup is honoured. Defaults to `true`. */
  readonly markers?: boolean;
}

export interface ResolvedIgnores {
  /** Rule ids per element, for elements that matched anything. */
  readonly marks: ReadonlyMap<Element, readonly string[]>;

  /**
   * Selectors that matched no element in this subject.
   *
   * Reported per subject rather than per run, because "matched nothing here" is
   * ordinary — a rule scoped to a header says nothing about a button story — and
   * only the run-level register can tell that apart from a selector that has
   * stopped matching anywhere. The collector's job is to supply the evidence.
   */
  readonly unmatched: readonly IgnoreSelector[];
}

/**
 * Resolve selectors and markers into per-element marks.
 *
 * The subject root is tested against each selector as well as searched, because
 * `querySelectorAll` does not match its own context node and an operator
 * excluding a whole subject would otherwise write a selector that matches
 * nothing and be told, correctly and unhelpfully, that their rule is dead.
 *
 * A selector that throws — malformed, or using a pseudo-class this engine does
 * not implement — is reported as unmatched rather than propagated. Failing the
 * whole capture over a typo in an ignore would make the safest possible edit the
 * most dangerous one, and an unmatched selector is already reported.
 */
export function resolveIgnores(
  root: Element,
  options: ResolveIgnoresOptions = {},
): ResolvedIgnores {
  const marks = new Map<Element, string[]>();
  const unmatched: IgnoreSelector[] = [];

  const mark = (element: Element, rule: string): void => {
    const existing = marks.get(element);
    if (existing === undefined) {
      marks.set(element, [rule]);
      return;
    }
    if (!existing.includes(rule)) existing.push(rule);
  };

  for (const selector of options.selectors ?? []) {
    let found = 0;

    try {
      if (root.matches(selector.select)) {
        mark(root, selector.id);
        found += 1;
      }
      for (const element of root.querySelectorAll(selector.select)) {
        mark(element, selector.id);
        found += 1;
      }
    } catch {
      // Left at whatever it reached. A selector list where one arm is invalid
      // matches nothing in any engine, so treating the throw as "no matches" is
      // the same answer the browser would have given.
    }

    if (found === 0) unmatched.push(selector);
  }

  if (options.markers !== false) {
    const marked = [
      ...(root.hasAttribute(IGNORE_ATTRIBUTE) ? [root] : []),
      ...root.querySelectorAll(`[${IGNORE_ATTRIBUTE}]`),
    ];

    for (const element of marked) {
      const value = element.getAttribute(IGNORE_ATTRIBUTE)?.trim();
      mark(element, value === undefined || value === '' ? MARKED_RULE : value);
    }
  }

  return { marks, unmatched };
}
