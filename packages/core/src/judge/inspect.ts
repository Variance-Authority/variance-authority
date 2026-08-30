import type { Band } from '../compare/band.js';
import type { OwnerFrame, SourceLocation } from '../format/provenance.js';
import type { NodePath, SemanticNode, SemanticSnapshot } from '../format/snapshot.js';
import { locate } from '../attribute/locate.js';
import { formatSource, resolveSource, type SourceIndex } from '../attribute/source.js';

/**
 * What a render says without a baseline.
 *
 * Two producers, one `Finding` type. `inspect` reads a single snapshot;
 * `compareLocales` reads two renders of one subject in different languages,
 * which is also not a regression comparison — both renders are correct. Sharing
 * the type is what lets the report, the CLI and the MCP tools carry both without
 * knowing which produced what.
 *
 * The rest of this comment is about `inspect`, which reads one snapshot with no
 * baseline and no second run.
 *
 * Everything else in this package answers *what changed*, which requires two of
 * something. That framing has a blind spot the whole category shares: **a defect
 * that was present on the first run is invisible to a comparison forever.** A
 * button that never had an accessible name compares equal to itself on every run
 * until someone happens to edit it, and a picture of it is a perfectly good
 * picture. Approving the first baseline approves the defect.
 *
 * These rules read the normalized snapshot and report defects in it. Consequences
 * worth stating, because they are the practical argument for having the document
 * rather than an image of it:
 *
 * - **A fresh checkout with zero baselines is already useful.** The expensive
 *   part of adopting a visual-regression tool is that it says nothing until it
 *   has a history; this half says something on the first run.
 * - **Every finding names a component and a file**, through the same provenance
 *   chain a delta uses. A rule engine that reports a DOM path reports where the
 *   symptom is; this reports whose JSX wrote it.
 * - **They band as `a11y`**, so a project that writes `blocking: ['a11y']` gets
 *   both halves under one policy: regressions found by comparison, and defects
 *   found by inspection.
 *
 * Deliberately *not* an axe-core reimplementation. Axe runs against a live DOM
 * with computed visibility, contrast and focus order, and does dozens of things
 * this cannot. What is here is the subset a normalized snapshot can decide
 * without guessing — and the subset it can decide **offline, from a stored
 * artifact, months later**, which is a thing axe cannot do at all.
 *
 * There is no severity field. A rule that needs one to be tolerable is a rule
 * whose condition is too broad, and the fix is a better condition or no rule.
 *
 * **Why there is no contrast rule, stated here so nobody adds one badly later.**
 * The snapshot carries a resolved `color` and `background-color` per node, so a
 * check looks like four lines and would be wrong: the background a glyph is
 * actually painted on is whatever is behind it, which is a stacking question a
 * layout engine answers and a document does not. A node with a transparent
 * background over a dark ancestor, an image, a gradient, or a positioned sibling
 * all read as "background-color: rgba(0,0,0,0)" here. A rule that is right most
 * of the time about accessibility is worse than no rule: it gets disabled after
 * the second false alarm, and takes the four that work with it. Spec 0009
 * records the same for focus order and anything about motion.
 */

export type FindingRule =
  /** An interactive control with no accessible name. Nothing announces it. */
  | 'control-without-name'
  /** A meaningful image with neither a name nor an explicit `alt=""`. */
  | 'image-without-alt'
  /** Heading levels jump forward by more than one. */
  | 'heading-level-skipped'
  /** A control inside another control. Only one of them is reachable. */
  | 'nested-interactive'
  /** An id reference that resolves to nothing inside this subject. */
  | 'dangling-reference'
  /** A control whose accessible name does not contain its visible label. */
  | 'label-mismatch'
  /** Two landmarks of one role that nothing tells apart. */
  | 'duplicate-landmark'
  /** A table with no header cells. */
  | 'table-without-headers'
  /** `tabindex` above zero, which reorders focus for the whole page. */
  | 'positive-tabindex'
  /**
   * The same string in two locales. From `compareLocales`, not from `inspect` —
   * one render cannot know whether its text was translated.
   */
  | 'untranslated'
  /** A box outside the box that contains it, in one locale and not the other. */
  | 'overflows-container';

/**
 * The identity of a finding, as a string two runs can be compared on.
 *
 * A finding is *the same finding* when the same rule fires on the same node. Not
 * the same sentence: `what` quotes the text it found, so a copy edit beside a
 * control with no accessible name would read as the old defect going away and a
 * new one arriving in the same place. And not the same component either — a
 * component renders in many places, and every one of them would collapse to one.
 *
 * Small on purpose. This is what a baseline carries so that the next run can say
 * whether a defect it found was already there, and a baseline sidecar rides
 * beside a PNG in a tracked directory: a mark is a few dozen bytes and a stored
 * `Finding` is a paragraph. It can only answer membership, which is the only
 * question the next run is allowed to ask of it — the same restraint
 * `Described.components` is written under.
 */
export function findingMark(finding: { readonly rule: string; readonly path: string }): string {
  return `${finding.rule}@${finding.path}`;
}

export interface Finding {
  readonly rule: FindingRule;

  /**
   * The band this finding would block under.
   *
   * Carried so that inspection and comparison answer to one policy. A team that
   * blocks `a11y` should not have to discover that it blocks regressions and not
   * defects.
   */
  readonly band: Band;

  readonly path: NodePath;

  /** One sentence, naming the thing rather than the rule. */
  readonly what: string;

  /** Spoken outside-in, from `locate` — `main → region "Todos" → item 2 of 3`. */
  readonly where?: string;

  /** The component whose JSX created the node, when provenance reached it. */
  readonly component?: string;
  readonly owners?: readonly OwnerFrame[];

  /**
   * The line that wrote *this element*, when a JSX runtime recorded one.
   *
   * Different from — and better than — resolving `component` through the source
   * index, which answers with where the component is *declared*. A defect is
   * rarely at a declaration: a button with no accessible name is a specific
   * element on a specific line inside that component, and that line is the edit.
   * The index stays as the fallback, because it needs no build change.
   *
   * Requires `@variance-authority/jsx-source` in the transform. Absent otherwise,
   * and absence is normal.
   */
  readonly source?: SourceLocation;
}

/** Roles that are operated. A control nobody can name is a control nobody can use. */
const INTERACTIVE = new Set([
  'button', 'link', 'checkbox', 'radio', 'switch', 'textbox', 'searchbox',
  'combobox', 'slider', 'spinbutton', 'menuitem', 'menuitemcheckbox',
  'menuitemradio', 'tab', 'treeitem',
]);

/** Attributes whose value the aliaser rewrote, so `#extern:` means unresolved. */
const REFERENCE_ATTRIBUTES = new Set(['for', 'form', 'list', 'headers']);

const HEADING_TAGS: Readonly<Record<string, number>> = {
  h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6,
};

/** Regions of a page a screen reader user navigates between. */
const LANDMARKS = new Set([
  'banner', 'navigation', 'main', 'complementary', 'contentinfo',
  'region', 'form', 'search',
]);

/** Has at least one letter. A glyph is not a visible label. */
const HAS_LETTER = /\p{L}/u;

export function inspect(snapshot: SemanticSnapshot): readonly Finding[] {
  const findings: Finding[] = [];
  const headings: { node: SemanticNode; level: number }[] = [];
  const landmarks = new Map<string, SemanticNode>();

  visit(snapshot.root, false);

  // Heading order is a property of the sequence, not of any one node, so it is
  // decided after the walk. Only *forward* jumps are reported: a component that
  // starts at `h3` is a component rendered inside something, not a defect, and a
  // subject is not a page.
  headings.forEach((heading, index) => {
    const previous = headings[index - 1];
    if (previous === undefined || heading.level <= previous.level + 1) return;

    findings.push(
      finding(
        'heading-level-skipped',
        heading.node,
        `heading level jumps from ${previous.level} to ${heading.level}` +
          (heading.node.name !== undefined ? ` at "${heading.node.name}"` : ''),
        snapshot,
      ),
    );
  });

  return findings;

  function visit(node: SemanticNode, insideControl: boolean): void {
    const interactive = node.role !== undefined && INTERACTIVE.has(node.role);

    if (interactive && node.name === undefined) {
      findings.push(
        finding(
          'control-without-name',
          node,
          `<${node.tag}> is a ${node.role} with no accessible name`,
          snapshot,
        ),
      );
    }

    if (interactive && insideControl) {
      findings.push(
        finding(
          'nested-interactive',
          node,
          `a ${node.role} is nested inside another control; only one of the two is reachable`,
          snapshot,
        ),
      );
    }

    // `alt=""` is the author saying "decorative", which is a correct answer and
    // must not be reported. A missing `alt` is the author saying nothing.
    if (node.role === 'img' && node.name === undefined && node.attributes['alt'] === undefined) {
      findings.push(
        finding(
          'image-without-alt',
          node,
          `<${node.tag}> has an image role, no accessible name, and no alt="" to say it is decorative`,
          snapshot,
        ),
      );
    }

    for (const [attribute, value] of Object.entries(node.attributes)) {
      if (!REFERENCE_ATTRIBUTES.has(attribute) || !value.includes('#extern:')) continue;

      findings.push(
        finding(
          'dangling-reference',
          node,
          // Honest about the ambiguity the aliaser records: from inside the
          // subject, escaping the subtree and pointing at nothing look the same.
          `<${node.tag} ${attribute}> references an element that is not in this subject`,
          snapshot,
        ),
      );
    }

    if (node.role === 'heading') {
      const level = levelOf(node);
      if (level !== undefined) headings.push({ node, level });
    }

    if (node.role !== undefined && LANDMARKS.has(node.role)) {
      // Keyed by role *and* name: two `navigation` landmarks called "Primary"
      // and "Footer" are how a page is meant to be built. Two called nothing are
      // two identical entries in the landmark list.
      const key = `${node.role}\u0000${node.name ?? ''}`;
      const first = landmarks.get(key);

      if (first === undefined) {
        landmarks.set(key, node);
      } else {
        findings.push(
          finding(
            'duplicate-landmark',
            node,
            `a second ${node.role} landmark` +
              (node.name !== undefined ? ` also named "${node.name}"` : ' with no name') +
              ', so nothing tells the two apart in a landmark list',
            snapshot,
          ),
        );
      }
    }

    if (node.role === 'table' && !hasHeaders(node)) {
      findings.push(
        finding(
          'table-without-headers',
          node,
          `<${node.tag}> is a table with no header cells, so every cell is announced without ` +
            'the column it belongs to',
          snapshot,
        ),
      );
    }

    const tabindex = Number(node.attributes['tabindex']);
    if (Number.isInteger(tabindex) && tabindex > 0) {
      findings.push(
        finding(
          'positive-tabindex',
          node,
          `<${node.tag}> has tabindex=${tabindex}, which pulls it ahead of every element in ` +
            'the document that relies on source order',
          snapshot,
        ),
      );
    }

    // WCAG 2.5.3. A control whose accessible name does not contain its visible
    // label cannot be operated by voice: "click Save" does nothing when the
    // button reads Save and is named "Submit form".
    //
    // Only when the visible text carries a letter. An icon button labelled
    // `aria-label="Refresh"` around a glyph is correct, and a rule that reported
    // it would fire on every icon in every design system.
    if (interactive && node.name !== undefined) {
      const visible = visibleTextOf(node);
      if (
        visible.length > 0 &&
        HAS_LETTER.test(visible) &&
        !node.name.toLowerCase().includes(visible.toLowerCase())
      ) {
        findings.push(
          finding(
            'label-mismatch',
            node,
            `reads "${visible}" and is named "${node.name}", so a voice command using the ` +
              'visible words does not reach it',
            snapshot,
          ),
        );
      }
    }

    for (const child of node.children) visit(child, insideControl || interactive);
  }
}

function hasHeaders(node: SemanticNode): boolean {
  if (node.role === 'columnheader' || node.role === 'rowheader') return true;
  return node.children.some(hasHeaders);
}

/**
 * Text a sighted user reads, normalized to single spaces.
 *
 * `aria-hidden` subtrees are excluded, which is what makes the icon-button case
 * work: the glyph is hidden, so the visible text is empty and `label-mismatch`
 * has nothing to compare.
 */
function visibleTextOf(node: SemanticNode): string {
  if (node.state?.['hidden'] === true) return '';

  const own = node.text ?? '';
  const children = node.children.map(visibleTextOf).join(' ');

  return `${own} ${children}`.replace(/\s+/g, ' ').trim();
}

function levelOf(node: SemanticNode): number | undefined {
  // `aria-level` wins, because it is what an assistive technology reads. The tag
  // is the fallback, and a `role="heading"` with neither is not a level at all.
  const declared = node.state?.['level'];
  if (typeof declared === 'number') return declared;
  if (typeof declared === 'string' && /^\d+$/.test(declared)) return Number(declared);

  return HEADING_TAGS[node.tag];
}

function finding(
  rule: FindingRule,
  node: SemanticNode,
  what: string,
  snapshot: SemanticSnapshot,
): Finding {
  const where = locate(snapshot.root, node.path).where;
  const component = node.provenance?.createdBy ?? node.provenance?.owners[0]?.name;

  return {
    rule,
    band: 'a11y',
    path: node.path,
    what,
    ...(where !== '' ? { where } : {}),
    ...(component !== undefined ? { component } : {}),
    ...(node.provenance ? { owners: node.provenance.owners } : {}),
    ...(node.provenance?.source ? { source: node.provenance.source } : {}),
  };
}

export interface InspectionReportOptions {
  /** Component → file, so a finding names an edit rather than an identifier. */
  readonly source?: SourceIndex;
}

/**
 * Findings as the thing a reviewer or an agent reads.
 *
 * Same shape as `summarizeAdjudication`: what, where, which file. A finding a
 * reader has to go and locate is a finding that gets skipped.
 */
export function summarizeFindings(
  findings: readonly Finding[],
  options: InspectionReportOptions = {},
): string {
  if (findings.length === 0) return 'no findings.';

  const byRule = new Map<FindingRule, number>();
  for (const found of findings) byRule.set(found.rule, (byRule.get(found.rule) ?? 0) + 1);

  const header =
    `${findings.length} finding${findings.length === 1 ? '' : 's'}: ` +
    [...byRule].map(([rule, count]) => `${count} ${rule}`).join(', ');

  const lines = findings.flatMap((found) => {
    // The element's own line wins over the component's declaration. Both are
    // `file:line`, so the reader cannot tell them apart and does not need to —
    // either one opens at something worth editing, and the recorded one opens at
    // the element the finding is actually about.
    const declared =
      found.component !== undefined && options.source
        ? resolveSource(found.component, options.source)
        : null;
    const where =
      found.source !== undefined
        ? `${found.source.file}:${String(found.source.line)}`
        : declared
          ? formatSource(declared)
          : '';

    const attribution = [found.component, where === '' ? undefined : where]
      .filter((part): part is string => part !== undefined)
      .join(' ');

    return [
      `  [${found.rule}] ${found.what}`,
      found.where !== undefined ? `      in ${found.where}` : null,
      attribution === '' ? null : `      ${attribution}`,
    ].filter((line): line is string => line !== null);
  });

  return [header, ...lines].join('\n');
}
