import {
  type Diagnostic,
  type MatchedRule,
  type ObservationProfile,
  type RenderDocument,
  type FrameElement,
  type SubjectRef,
  type Viewport,
} from '@variance-authority/core';
import { detectProfile } from './collect.js';
import { inheritedSeed } from './inherit.js';
import { indexStyleSheets, matchRulesFor, type StyleIndex } from './css.js';
import type { ConditionEnvironment } from './media.js';
import { attributesOf, elements } from './dom-list.js';

/**
 * Acquisition — phase one: a live DOM becomes something you can send somewhere.
 *
 * This is the same extraction the semantic collector performs, aimed at a
 * different target. `collect()` produces a value built to be *compared*, so it
 * throws away everything volatile: ids become aliases, classes vanish, the
 * cascade is resolved. A render document is built to be *repainted*, so it keeps
 * all of that — a selector cannot match a class that was normalized away.
 *
 * What the two share is the expensive, load-bearing half: applicability pruning
 * (ADR-0003). A subject carrying Storybook's chrome, a preview reset, the design
 * system, and a CSS-in-JS tag that has been accreting since page load ships as
 * the rules that actually touch it — on the todomvc corpus, 1007 rules to 1.
 * That is a correctness result for comparison and a *transport* result here: an
 * offloaded render is only worth offloading if the payload is not the whole
 * application.
 *
 * ## What this makes possible
 *
 * jsdom cannot rasterize. It can produce one of these, which is the sub-renderer
 * split ADR-0002 describes and the direct answer to paying for a container on
 * every tier: the deciding tier runs anywhere, and the residue that genuinely
 * needs pinned pixels is a serializable payload that can be sent to the one
 * machine that is pinned.
 */

export interface AcquireOptions {
  readonly subject: SubjectRef;
  readonly viewport: Viewport;

  /** See `CollectOptions.fonts`. Carried into the document, never resolved here. */
  readonly fonts?: readonly string[];
  readonly features?: Readonly<Record<string, string>>;
  readonly assets?: Readonly<Record<string, string>>;

  /**
   * Inherited values and custom properties in force at the subject root.
   *
   * Defaults to resolving the ancestor cascade, which is not an optimization
   * anyone can skip: design tokens are declared on `:root`, `:root` is outside
   * every subject's subtree, and pruning therefore *correctly* drops the rule
   * that defines them. Ship the pruned sheet without this and `var(--brand)`
   * resolves to nothing — the render is the design system with its colours
   * removed, which looks exactly like a catastrophic regression.
   */
  readonly inherited?: Readonly<Record<string, string>>;

  /** Reuse an index already built for a capture of the same document. */
  readonly index?: StyleIndex;

  /** Defaults to whichever profile the host can support. */
  readonly profile?: ObservationProfile;
}

/**
 * Attribute stamped on every element, carrying its path from the subject root.
 *
 * Two jobs. It lets this function verify its own output — a rule is only worth
 * shipping if it still matches once the subtree is standing on a reconstructed
 * frame rather than inside the real page — and it survives into the rendered
 * document, where it is the exact node correspondence a geometric region join
 * has to approximate.
 *
 * Data attributes paint nothing, so its presence cannot move a pixel. It does
 * enter the document digest, which is correct: a different tree is a different
 * render.
 */
export const PATH_ATTRIBUTE = 'data-va-path';

export function acquireDocument(root: Element, options: AcquireOptions): RenderDocument {
  const ownerDocument = root.ownerDocument;
  const view = ownerDocument.defaultView;
  const diagnostics: Diagnostic[] = [];

  const conditions: ConditionEnvironment = {
    width: options.viewport.width,
    height: options.viewport.height,
    deviceScaleFactor: options.viewport.deviceScaleFactor,
    colorScheme: options.viewport.colorScheme,
    ...(options.features ? { features: options.features } : {}),
  };

  const index = options.index ?? indexStyleSheets(ownerDocument, conditions);
  diagnostics.push(...index.diagnostics);

  // Stamped on the live tree and removed again. Cloning first and stamping the
  // clone would be tidier and would also break `matches()` for any selector
  // depending on an ancestor, since the clone has none until the frame is built.
  const stamped = stamp(root);

  try {
    const { css, bindings } = applicableCss(root, index);
    const frame = frameOf(root);
    settleStamps(stamped);
    const html = root.outerHTML;

    diagnostics.push(...verify(ownerDocument, html, frame, bindings));

    if (options.fonts === undefined) {
      diagnostics.push({
        severity: 'warn',
        code: 'unverified-fonts',
        message:
          'no font identities supplied; a renderer substituting a font changes every metric ' +
          'in the image and nothing in this document would say so',
      });
    }

    return {
      documentVersion: 1,
      subject: options.subject,
      html,
      frame,
      css,
      viewport: options.viewport,
      inherited:
        options.inherited ??
        inheritedSeed(root, options.profile ?? detectProfile(view), view, index),
      fonts: options.fonts ?? [],
      ...(options.assets ? { assets: options.assets } : {}),
      diagnostics,
    };
  } finally {
    for (const element of stamped) element.removeAttribute(PATH_ATTRIBUTE);
  }
}

/**
 * Force the host to write back any attribute it is still holding in memory,
 * before this code adds one of its own.
 *
 * **The cause of the whole ordering problem, and the half that had to be fixed
 * where it happens.** Blink does not serialize an inline style into the `style`
 * attribute when JavaScript mutates it — `element.style.padding = …` marks the
 * declaration dirty and the attribute is regenerated lazily, the next time
 * anything reads the element's attributes. `outerHTML` is such a read, and the
 * regenerated attribute is *appended*.
 *
 * So a freshly mounted React component holds `[type]` with a pending style, our
 * stamp appends `[type, data-va-path]`, and serialization then materializes the
 * style at the end: `<button type data-va-path style>`. Collect the same story
 * again with no remount and the style attribute already exists, so the stamp goes
 * last: `<button type style data-va-path>`. Same tree, same pixels, two digests —
 * decided by whether the subject had been read before.
 *
 * Reading the names first materializes anything pending while our attribute is
 * still absent, so the stamp is appended after the page's own attributes on every
 * reading. Measured on `cases/storybook-case`: every story in it produced two
 * digests for two consecutive readings before this, and one after.
 */
function materializeAttributes(element: Element): void {
  // The call *is* the operation; its value is the host's, and it is never read.
  void element.getAttributeNames();
}

/**
 * Move every stamp to the end of its element's attribute list, immediately
 * before serialization.
 *
 * **This is a determinism fix, not a tidiness one.** `outerHTML` writes
 * attributes in the order the element holds them, so the digest of a document is
 * a function of *when each attribute was set* — and the page sets its own
 * attributes on a schedule this code does not control. See
 * `materializeAttributes` for the mechanism that produced it in Blink.
 *
 * What that costs is the whole cheap tier. `settle` skips a render when this
 * run's document digest equals the digest the baseline was painted from, so a
 * subject whose digest depends on whether it was collected before loses its
 * settlement — not to a change, but to the *history of the run that recorded the
 * baseline*. The verdict stays right and the economy silently stops working,
 * which is the failure that never gets reported by anything.
 *
 * This is the second half of the fix and it covers a different case:
 * `materializeAttributes` keeps a *new* stamp in the right place, and this keeps
 * an *existing* one there. `setAttribute` on an attribute already present updates
 * it where it sits, so a stamp that survived an earlier acquisition would hold
 * whatever position that one gave it.
 *
 * Only our own attribute is moved, and that is deliberate. Sorting the element's
 * whole attribute list would be more thorough and would require removing the
 * page's attributes to re-add them, which is not an inspection: removing `src`
 * refetches an image and removing `value` resets a field. So the page's own
 * ordering is left exactly as found, and if it is itself nondeterministic that
 * is a finding about the page — which `again` in `packages/cli` now reports with
 * a component attached, rather than a digest quietly drifting.
 *
 * Found by that check, on its first contact with a real Storybook.
 */
function settleStamps(stamped: readonly Element[]): void {
  for (const element of stamped) {
    const path = element.getAttribute(PATH_ATTRIBUTE);
    if (path === null) continue;
    element.removeAttribute(PATH_ATTRIBUTE);
    element.setAttribute(PATH_ATTRIBUTE, path);
  }
}

/** Stamp `data-va-path` on the subtree. Returns what was touched, to undo it. */
function stamp(root: Element): readonly Element[] {
  const touched: Element[] = [];

  const walk = (element: Element, path: string): void => {
    materializeAttributes(element);
    element.setAttribute(PATH_ATTRIBUTE, path);
    touched.push(element);

    let index = 0;
    for (const child of elements(element.children)) {
      walk(child, `${path}/${index}`);
      index += 1;
    }
  };
  walk(root, '0');

  return touched;
}

/**
 * The pruned stylesheet: every rule matching something in the subtree, once.
 *
 * Emitted as a single sheet ordered by the index's global rule counter, because
 * that counter *is* document order across every sheet in the page. Grouping by
 * origin sheet would read better and would also reorder the cascade wherever two
 * sheets interleave — which changes which declaration wins, and therefore the
 * image, while looking like a formatting choice.
 *
 * Conditions are already resolved: `indexStyleSheets` flattened `@media` and
 * `@supports` against the viewport, so a rule present here is one that applies at
 * this viewport, and the renderer is told the viewport rather than the condition.
 */
function applicableCss(
  root: Element,
  index: StyleIndex,
): { css: readonly string[]; bindings: readonly Binding[] } {
  const byOrder = new Map<number, MatchedRule>();
  const bindings: Binding[] = [];

  const walk = (element: Element): void => {
    const path = element.getAttribute(PATH_ATTRIBUTE)!;
    for (const rule of matchRulesFor(element, index).matched) {
      byOrder.set(rule.order, rule);
      bindings.push({ path, selector: rule.selector });
    }
    for (const child of elements(element.children)) walk(child);
  };
  walk(root);

  // And the frame, which is rendered and was not collected.
  //
  // `frameOf` reproduces `<html>`, `<body>` and every ancestor by tag and
  // attributes, and `assemble` emits them — so they are part of the page the
  // renderer paints. Their *rules* were not, because this walk started at the
  // subject and went down. A Storybook preview that centres its story with
  // `body { display: flex; justify-content: center }` therefore painted the
  // subject full-width at the top-left, and `cases/storybook-case` measured the
  // gap at 1024 device pixels against an acquired subject 147.33 CSS pixels wide.
  // Every baseline it had was a photograph of a layout that exists in no browser.
  //
  // Ancestors carry no `data-va-path` — they are reconstructed from tag and
  // attributes, not serialized — so they produce no binding and `verify` cannot
  // re-test them. That is the honest limit and it is narrower than it sounds: a
  // rule that fails to match an ancestor in the render can only *lose* styling
  // the page had, and `subject-size-diverged` is the detector for the outcome.
  for (const ancestor of frameChain(root)) {
    for (const rule of matchRulesFor(ancestor, index).matched) byOrder.set(rule.order, rule);
  }

  const rules = [...byOrder.values()].sort((a, b) => a.order - b.order);
  const text = rules.map(
    (rule) =>
      `${rule.selector} {${rule.declarations
        .map((d) => `${d.property}:${d.value}${d.important ? ' !important' : ''}`)
        .join(';')}}`,
  );

  return { css: text.length > 0 ? [text.join('\n')] : [], bindings };
}

/** One (element, rule) pair that held in the live page and must hold in the render. */
interface Binding {
  readonly path: string;
  readonly selector: string;
}

/**
 * Every element the frame reproduces, outermost first.
 *
 * The same walk `frameOf` makes, and deliberately a separate function rather
 * than a second reading of its output: what is *rendered* is elements, and what
 * `frameOf` returns is tags and attribute bags. Matching a rule needs the live
 * element.
 */
function frameChain(root: Element): readonly Element[] {
  const chain: Element[] = [];
  for (let node = root.parentElement; node !== null; node = node.parentElement) {
    chain.unshift(node);
  }
  return chain;
}

/** Tags, ids, classes and attributes above the subject, outermost first. */
function frameOf(root: Element): RenderDocument['frame'] {
  const ownerDocument = root.ownerDocument;
  const ancestors: FrameElement[] = [];

  for (let node = root.parentElement; node !== null; node = node.parentElement) {
    const tag = node.tagName.toLowerCase();
    if (tag === 'html' || tag === 'body') continue;
    ancestors.unshift({ tag, attributes: attributesOf(node) });
  }

  // Zero under a profile with no layout engine, and omitted rather than recorded
  // as `0` — a container width of zero is a claim, and an unobservable one must
  // never be reported as an observed value (ADR-0002).
  const containerWidth = root.parentElement?.getBoundingClientRect().width ?? 0;

  return {
    html: ownerDocument.documentElement ? attributesOf(ownerDocument.documentElement) : {},
    body: ownerDocument.body ? attributesOf(ownerDocument.body) : {},
    ancestors,
    ...(containerWidth > 0 ? { containerWidth } : {}),
  };
}

/**
 * Check that every shipped rule still matches once the frame is reconstructed.
 *
 * This is the one thing that can go quietly wrong here. A rule kept because
 * `.app .item` matched inside the real page matches nothing if `.app` was an
 * ancestor the frame failed to reproduce — and the render then differs from the
 * original in exactly the styling that was proven to apply. It would look like a
 * regression, in a component nobody touched.
 *
 * So the document is assembled, parsed, and re-tested here rather than trusted.
 * A rule that fails is reported and *kept*: dropping it would hide the defect,
 * and shipping a rule that matches nothing costs bytes and paints nothing.
 */
function verify(
  ownerDocument: Document,
  html: string,
  frame: RenderDocument['frame'],
  bindings: readonly Binding[],
): readonly Diagnostic[] {
  const view = ownerDocument.defaultView;
  if (view === null) return [];

  const parsed = new view.DOMParser().parseFromString(
    assembleForVerification(html, frame),
    'text/html',
  );

  const lost: string[] = [];
  for (const binding of bindings) {
    // The exact pair, not "does this selector still match something". A rule that
    // slid from the element it styled to a sibling paints a different picture and
    // would pass a laxer check.
    const element = parsed.querySelector(`[${PATH_ATTRIBUTE}="${binding.path}"]`);
    if (element === null) {
      lost.push(`${binding.selector} (node ${binding.path} did not survive serialization)`);
      continue;
    }

    let matches = false;
    try {
      matches = element.matches(binding.selector);
    } catch {
      // An unparseable selector is the collector's problem, not this phase's;
      // `indexStyleSheets` already reports it and re-reporting adds noise.
      continue;
    }
    if (!matches) lost.push(binding.selector);
  }

  const distinct = [...new Set(lost)];
  if (distinct.length === 0) return [];

  return [
    {
      severity: 'warn',
      code: 'frame-incomplete',
      message:
        `${distinct.length} applicable rule(s) no longer match once the subject stands on its ` +
        `reconstructed frame, so the render will differ from the page it was acquired from: ` +
        distinct.slice(0, 5).join(', ') +
        (distinct.length > 5 ? `, +${distinct.length - 5} more` : ''),
    },
  ];
}

function assembleForVerification(html: string, frame: RenderDocument['frame']): string {
  const open = frame.ancestors.map((a) => `<${a.tag}${serializeAttributes(a.attributes)}>`).join('');
  const close = [...frame.ancestors].reverse().map((a) => `</${a.tag}>`).join('');

  return (
    `<html${serializeAttributes(frame.html)}>` +
    `<body${serializeAttributes(frame.body)}>${open}${html}${close}</body></html>`
  );
}

export function serializeAttributes(attributes: Readonly<Record<string, string>>): string {
  return Object.entries(attributes)
    .map(([name, value]) => ` ${name}="${value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`)
    .join('');
}
