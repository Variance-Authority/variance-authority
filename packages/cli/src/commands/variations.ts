import {
  deriveVariation,
  type Observability,
  type Variation,
} from '@variance-authority/core/compare';
import type { SemanticSnapshot } from '@variance-authority/core/format';
import type { VariationRecord } from '@variance-authority/report';
import type { NamesConfig } from '../config-names.js';
import type { Plan, PlannedSubject } from './collector.js';
import { BOUNDARY, nameIndex, structuralParent, type Step } from './names.js';

/**
 * Subjects that are variations of other subjects, and what the variation is.
 *
 * ## Why a link, and not a variation language
 *
 * A suite watches a component. Somebody puts a new arm of it behind a feature
 * flag, adds a story for the arm, and the tool says `new` — one more baseline,
 * an empty diff, and no statement anywhere about what the flag *does*. The same
 * shape produces the same silence for a second viewport, a dark scheme, and a
 * backend fixture that returns the empty state: each one is a subject nobody can
 * ask a question about, because the only thing it is ever compared to is itself,
 * yesterday.
 *
 * The temptation is a vocabulary — a `variants` block with viewports, schemes,
 * flags and scenarios in it — and it is the wrong shape twice over. Every
 * collector expresses these differently and only the collector can produce them:
 * a story sets args, a route sets a query, a Playwright fixture sets a cookie or
 * routes a request. And the list is open, so a vocabulary is a thing this project
 * would extend forever while every adopter waits for their case.
 *
 * So this holds no vocabulary at all. **A subject declares which subject it is a
 * variation of, and the difference between the two is computed.** How the
 * variation came about stays entirely the collector's business, which is the
 * boundary `collector.ts` already draws for everything else.
 *
 * ## Where the declaration lives
 *
 * On the subject, as a tag, because tags are the one per-subject declaration
 * that survives every collector this project has: Storybook's built index
 * carries a story's `tags` and not its `parameters`, and a hand-written
 * collector puts whatever it likes on {@link PlannedSubject.tags}. A central
 * config listing pairs would have been a second file to keep in step with every
 * story rename, and the rename is the common event.
 *
 * **And in the name, for suites that already write it there.** A subject called
 * `checkout-dark` is `checkout` plus an axis, and saying so twice — once in the
 * name, once in a tag — is a second thing to keep in step. So a subject with no
 * tag is asked its own name, and the answer is the longest other subject in the
 * run whose id it extends. See {@link namedParent} for the ordering constraint
 * that makes a name readable at all.
 *
 * The two routes are not equal and the record says which was used. A tag is a
 * statement; a name is an inference from a convention, correct exactly as often
 * as the convention is kept.
 *
 * ## What it never does
 *
 * It writes nothing, promotes nothing, and reaches no verdict. A variation is a
 * difference somebody built on purpose; a run that went red because a dark story
 * is darker than its light parent would be a run reporting a subject for
 * existing. What a variation can do is make a *review* shorter, and that is what
 * the difference's digest is for.
 */

/** The tag that names a subject's parent: `variance-parent:<id>`. */
export const PARENT_TAG = 'variance-parent:';

/** The tag value a subject declared, before it is known to name anything. */
export function declaredParent(planned: PlannedSubject): string | undefined {
  const tag = planned.tags?.find((word) => word.startsWith(PARENT_TAG));
  return tag === undefined ? undefined : tag.slice(PARENT_TAG.length);
}

/** How a subject's parent came to be known. */
export type Declaration =
  /** A `variance-parent:` tag somebody wrote. */
  | 'declared'
  /** The name said it: this subject's id extends another subject's id. */
  | 'named';

/** A declaration, resolved against the plan it was declared in. */
export type ParentLink =
  | {
      readonly ok: true;
      readonly parent: string;
      readonly how: Declaration;
      /**
       * The axis the name crossed, when a grammar read it.
       *
       * Present only for a `named` link resolved through `names` in the config.
       * It is what turns "these two differ" into "these two differ in `scheme`,
       * which is `dark` here and `light` there" — the question a coordinate can
       * be asked and a pair of strings cannot.
       */
      readonly step?: Step;
    }
  | { readonly ok: false; readonly because: string };

/**
 * The parent a subject's own name names, if any: the longest other subject in
 * the run whose id this one extends.
 *
 * **The great green dragon rule.** English will not let you say *green great
 * dragon*: adjective order is fixed, so one dragon has one name. The same
 * constraint is what makes a name readable as a variation vector here. Write the
 * axes in a settled order — `checkout`, `checkout-dark`, `checkout-dark-narrow`
 * — and every name has exactly one parent, found by dropping what was added
 * last, with nothing declared anywhere.
 *
 * Break the order and nothing errors; something worse happens quietly.
 * `checkout-dark-narrow` and `checkout-narrow-dark` are one render under two
 * names, so they carry two baselines, sit on two chains, and each reports a
 * two-axis difference where a one-axis difference was meant. That duplication is
 * already visible — two subjects with one rendering is a shared rendering, which
 * `variance_composition` reports — but it is reported as an echo rather than as
 * the naming mistake it is.
 *
 * Longest wins, so a chain is a chain rather than every step being a variation
 * of the base: `checkout-dark-narrow` varies `checkout-dark`, which varies
 * `checkout`. Each link is then one axis, which is the only reason the
 * difference between two of them is worth reading.
 */
function namedParent(id: string, ids: ReadonlySet<string>): string | undefined {
  let best: string | undefined;

  for (const candidate of ids) {
    if (candidate === id || candidate.length >= id.length) continue;
    if (!id.startsWith(candidate)) continue;
    if (!BOUNDARY.has(id[candidate.length]!)) continue;
    // A name that is only a separator longer adds no axis; it is a typo or a
    // trailing dash, and comparing a subject to it explains nothing.
    if (id.length <= candidate.length + 1) continue;
    if (best === undefined || candidate.length > best.length) best = candidate;
  }

  return best;
}

/**
 * Resolve every declared parent against the subjects this run planned.
 *
 * Two forms are accepted and the second is the one that makes the tag writable.
 * A subject id is namespaced — `story:components-button--primary` — and a story
 * declaring its parent inside Storybook knows the story id and not the prefix
 * this tool puts in front of it. So an exact id wins, and otherwise a **unique**
 * subject whose id ends in `:<value>` is taken.
 *
 * Ambiguity is refused rather than resolved by order. Two subjects ending in the
 * same suffix is a plan where the tag means two things, and picking the first
 * would attach a difference to the wrong parent and print it with full
 * confidence.
 */
export function resolveParents(plan: Plan, names?: NamesConfig): ReadonlyMap<string, ParentLink> {
  const ids = new Set(plan.subjects.map((planned) => planned.subject.id));
  const links = new Map<string, ParentLink>();
  // Built once for the run, and only when a grammar was configured. Without one
  // the prefix rule stands, which is the reading for a suite nobody has told
  // what its own words mean.
  const index = names === undefined ? undefined : nameIndex(ids, names);

  for (const planned of plan.subjects) {
    const id = planned.subject.id;
    const declared = declaredParent(planned);

    if (declared === undefined) {
      // No tag, so the name is asked instead. A tag is never overridden by a
      // name: a written declaration that failed to resolve is a mistake to
      // report, and quietly answering it with a guess would hide the mistake
      // behind an answer that looks like the one that was asked for.
      // A grammar replaces the prefix rule rather than backing it up. It is a
      // statement about how this suite's names are written, so a name it finds
      // nothing in is a name with nothing in it — falling through to a longest
      // common prefix would answer a configured question with an unconfigured
      // guess, and print both the same way.
      if (index !== undefined) {
        const structural = structuralParent(id, index);
        if (structural === undefined) continue;
        if (structural.ok) {
          links.set(id, {
            ok: true,
            parent: structural.parent,
            how: 'named',
            step: structural.step,
          });
        } else {
          links.set(id, { ok: false, because: structural.because });
        }
        continue;
      }

      const named = namedParent(id, ids);
      if (named !== undefined) links.set(id, { ok: true, parent: named, how: 'named' });
      continue;
    }

    if (declared === id) {
      links.set(id, { ok: false, because: `it declares itself its own parent` });
      continue;
    }
    if (ids.has(declared)) {
      links.set(id, { ok: true, parent: declared, how: 'declared' });
      continue;
    }

    const matching = [...ids].filter((candidate) => candidate.endsWith(`:${declared}`));
    if (matching.length === 1 && matching[0] !== id) {
      links.set(id, { ok: true, parent: matching[0]!, how: 'declared' });
    } else if (matching.length > 1) {
      links.set(id, {
        ok: false,
        because:
          `it declares \`${PARENT_TAG}${declared}\`, and ${matching.length} subjects in this ` +
          'run end that way; name the parent by its full subject id',
      });
    } else {
      links.set(id, {
        ok: false,
        because: `it declares \`${PARENT_TAG}${declared}\`, and this run planned no such subject`,
      });
    }
  }

  return links;
}

/**
 * Every subject a variation will be measured from or against.
 *
 * Read before anything is collected, so the loop keeps the snapshots it will
 * need and no others. A run of three hundred subjects holds three hundred
 * normalized trees otherwise, to compare four of them.
 *
 * Both ends of every link, and that is the point rather than an oversight in the
 * other direction. A lattice's leaves are the parent of nothing:
 * `product-card--sale-dark` is the cell where two arms meet, which is the cell an
 * A/B grammar exists to measure, and a set of parents alone is exactly the set
 * that omits it. Asking each subject for its own tag instead recovers the ones
 * that declared a parent and none of the ones a name grammar read, which is the
 * same omission wearing a coincidence: a named variation survives only when it
 * happens to be somebody else's parent too.
 */
export function variationsWanted(plan: Plan, names?: NamesConfig): ReadonlySet<string> {
  const wanted = new Set<string>();
  for (const [subject, link] of resolveParents(plan, names)) {
    if (!link.ok) continue;
    wanted.add(link.parent);
    wanted.add(subject);
  }
  return wanted;
}

export interface VariationsInput {
  readonly plan: Plan;
  /** Snapshots kept for this run, by subject id. Parents, and the variations. */
  readonly snapshots: ReadonlyMap<string, SemanticSnapshot>;

  /** The name grammar, when the config has one. See `config-names.ts`. */
  readonly names?: NamesConfig;
}

/**
 * One record per declared variation, in plan order.
 *
 * Including the ones that could not be computed. A parent that failed to render
 * is a variation that was not measured, and a section that quietly dropped it
 * would report a broken link as a subject with nothing to say — the same
 * distinction `notObserved` exists to hold for the run as a whole.
 */
export function variationsOf(input: VariationsInput): readonly VariationRecord[] | undefined {
  const links = resolveParents(input.plan, input.names);
  if (links.size === 0) return undefined;

  const records: VariationRecord[] = [];

  for (const planned of input.plan.subjects) {
    const link = links.get(planned.subject.id);
    if (link === undefined) continue;
    const subject = planned.subject.id;

    if (!link.ok) {
      records.push({ subject, because: `\`${subject}\` was not compared: ${link.because}` });
      continue;
    }

    const parent = input.snapshots.get(link.parent);
    const variant = input.snapshots.get(subject);
    if (parent === undefined || variant === undefined) {
      const missing = parent === undefined ? link.parent : subject;
      records.push({
        subject,
        parent: link.parent,
        because:
          `\`${subject}\` was not compared against \`${link.parent}\`: this run has no ` +
          `semantic snapshot of \`${missing}\``,
      });
      continue;
    }

    records.push(recordOf(deriveVariation(parent, variant), link.how, link.step));
  }

  return records;
}

function recordOf(variation: Variation, how: Declaration, step?: Step): VariationRecord {
  // Roots first, collateral after. A variation's report is read top-down and the
  // first name in it is the one somebody will go look at, so it has to be the
  // component the difference originates in rather than whichever component the
  // traversal reached first.
  const named = [
    ...variation.components.filter((entry) => entry.role === 'root').map((entry) => entry.name),
    ...variation.components.filter((entry) => entry.role !== 'root').map((entry) => entry.name),
  ];

  return {
    subject: variation.subject,
    parent: variation.parent,
    identical: variation.identical,
    bands: variation.bands,
    ...(variation.unobserved.length > 0 ? { unobserved: variation.unobserved } : {}),
    ...(variation.narrowed.length > 0 ? { narrowed: variation.narrowed } : {}),
    ...(named.length > 0 ? { components: named } : {}),
    digest: variation.digest,
    how,
    because: because(variation, named, how, step),
  };
}

function because(
  variation: Variation,
  named: readonly string[],
  how: Declaration,
  step?: Step,
): string {
  // Said on every line rather than once at the top of the section, because a
  // record is read one at a time — through `variance_variations`, through the
  // report, through whatever reads the artifact — and a caveat that lives in the
  // heading is a caveat that reaches whoever read the heading.
  const source =
    how === 'declared'
      ? ''
      : step !== undefined
        ? ` Nothing declared this pair. The configured name format reads the two as one ` +
          `subject at two coordinates: \`${step.axis}\` is \`${step.to}\` here and ` +
          `\`${step.from}\` there, and every other axis is the same word in both — so what ` +
          'is measured above is that axis and nothing else.'
        : ` Nothing declared this pair: \`${variation.subject}\` is \`${variation.parent}\` ` +
          'plus a name, which is a convention being read rather than a statement being kept.';

  const blind =
    variation.unobserved.length === 0
      ? ''
      : ` This profile could not decide ${list(variation.unobserved)}, so the two are ` +
        'unmeasured there rather than alike.';

  // The other half of the same caveat, and the one with no verdict to give it
  // away. A band this profile could not decide is reported as undecided; a band
  // it decided narrowly comes back in the same word a full reading uses, so the
  // only place the difference can appear is here.
  const narrow = variation.narrowed
    .map((band) => ` \`${band}\` was compared on ${COVERAGE[variation.observability[band]]}.`)
    .join('');

  const tail = `${blind}${narrow}${source}`;

  if (variation.identical) {
    return (
      `\`${variation.subject}\` renders identically to \`${variation.parent}\`, so whatever ` +
      `makes it a variation reaches nothing this run could read.${tail}`
    );
  }

  const where = named.length === 0 ? '' : `, led by \`${named[0]!}\``;
  return (
    `\`${variation.subject}\` differs from \`${variation.parent}\` in ` +
    `${list(variation.bands)}${where}. The difference is \`${variation.digest.slice(0, 12)}\`, ` +
    'and it is unchanged for as long as the two subjects keep moving together.' +
    tail
  );
}

/**
 * What a reading of a band actually covered, in the reader's own terms.
 *
 * Keyed by `Observability` rather than by band so that a level added without a
 * sentence is a compile error. `full` and `none` are here to make the record
 * total and are never reached: a full band is not narrowed and an undecidable one
 * is unobserved, and each has its own sentence above.
 */
const COVERAGE: Readonly<Record<Observability, string>> = {
  full: 'everything the band is made of',
  'declared-only': 'what the stylesheets declare, not what an engine resolved',
  'structural-only': 'nodes entering and leaving the tree, not boxes moving on screen',
  none: 'nothing',
};

function list(words: readonly string[]): string {
  if (words.length === 0) return 'nothing';
  if (words.length === 1) return words[0]!;
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)!}`;
}
