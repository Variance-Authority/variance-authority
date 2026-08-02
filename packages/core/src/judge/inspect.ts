import type { Band } from '../compare/band.js';
import type { OwnerFrame } from '../format/provenance.js';
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
  /**
   * The same string in two locales. From `compareLocales`, not from `inspect` —
   * one render cannot know whether its text was translated.
   */
  | 'untranslated'
  /** A box outside the box that contains it, in one locale and not the other. */
  | 'overflows-container';

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

export function inspect(snapshot: SemanticSnapshot): readonly Finding[] {
  const findings: Finding[] = [];
  const headings: { node: SemanticNode; level: number }[] = [];

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

    for (const child of node.children) visit(child, insideControl || interactive);
  }
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
    const source =
      found.component !== undefined && options.source
        ? resolveSource(found.component, options.source)
        : null;

    return [
      `  [${found.rule}] ${found.what}`,
      found.where !== undefined ? `      in ${found.where}` : null,
      found.component !== undefined
        ? `      ${found.component}${source ? ` ${formatSource(source)}` : ''}`
        : null,
    ].filter((line): line is string => line !== null);
  });

  return [header, ...lines].join('\n');
}
