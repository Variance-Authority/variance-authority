import type { Change, Clustering } from './cluster.js';
import { clusterChanges } from './cluster.js';
import type { NotObserved, RunReport } from './format.js';

/**
 * A claim, and what the run did with it.
 *
 * ## The half nobody asks for
 *
 * Everything else in this package answers *what changed*. That is not the
 * question an agent that just edited a component is asking. It already knows what
 * it meant to do; what it cannot know is whether the edit landed, whether it
 * landed only where it was supposed to, and whether the thing it did not mean to
 * touch moved anyway.
 *
 * So the agent declares first — *I am changing `Button`, paint only, at most 12
 * subjects* — and the run is read back against the declaration. Three arms come
 * out, and they are three different products:
 *
 * - **Delivered.** The change happened where it was declared. Confirmation, and
 *   the cheapest of the three.
 * - **Unclaimed.** Something moved that no claim covers. The collateral to fix,
 *   or to name in the proposal before a human finds it.
 * - **Undelivered.** A claim that matched nothing. *The edit did not take* —
 *   wrong file, dead branch, a rule something else overrides, a stale build.
 *
 * The third arm is the one aimed at the failure mode an agent actually has:
 * acting, observing nothing, and proceeding on the belief that the action landed.
 * A picture cannot produce it. A build with no diff and a build where the edit
 * never ran are the same image, and every tool whose output is a score over two
 * PNGs reports them identically.
 *
 * It also disciplines the other two. An agent that claims everything so nothing
 * can ever be unclaimed walks straight into arm three, because a claim with no
 * matching change is reported rather than absorbed. Over-claiming is visible by
 * construction, not by policy.
 *
 * ## Declared before, not after
 *
 * A claim read out of the diff is not a claim. This function takes the
 * declaration as an input and never derives one, which is what keeps the
 * adjudication from scoring the run against itself.
 *
 * ## Why an undelivered claim has two different answers
 *
 * `Button` was claimed and nothing about `Button` changed. That is either
 *
 * - the run rendered `Button` — in this many subjects — and it did not move, so
 *   the edit did not take; or
 * - the run never rendered `Button` at all, so the claim was not checked and
 *   nothing here may be read as evidence about it.
 *
 * Those are opposite instructions. The first sends an agent back to its own edit;
 * the second sends it to the subject list, or to the provenance that would have
 * named the component. The census in
 * [`CompositionReport`](./composition.ts) is what separates them, and where a run
 * kept no census this says *that*, rather than collapsing the pair into the
 * reading that happens to be more flattering.
 *
 * ## The relationship to core's `adjudicate`
 *
 * `@variance-authority/core` adjudicates a **docket** — roots with bands,
 * impacts, and a project policy — which exists while a run is in memory. A run
 * report keeps no roots (see [`format.ts`](./format.ts): what is kept is what a
 * sentence needs), so this adjudicates at the resolution the artifact actually
 * recorded: the component and the shape. It is the same three arms against less
 * evidence, and the fields it cannot check it names instead of ignoring.
 */

/** What a claim may be made about, at the resolution a run report keeps. */
export type ClaimRootKind = 'component' | 'shape';

export interface Claim {
  /**
   * What the change is about: `component:Button`, `shape:<fingerprint>`, or a
   * bare name read as a component.
   *
   * Matched exactly. A prefix match would let a claim about `Button` silently
   * authorize a change to `ButtonGroup`, which is the one thing a declaration
   * must never do.
   */
  readonly root: string;

  /** Why. Never matched on; carried into the answer so a reader has the context. */
  readonly reason: string;

  /**
   * Cap on how many subjects the change may reach.
   *
   * The most useful field in practice, and the one nobody checks unaided. "I
   * meant to restyle `Button`" is almost always true; "I meant to restyle
   * `Button` in 3 subjects" is the part that turns out to be 40.
   */
  readonly maxSubjects?: number;
}

export type ClaimVerdict =
  /** Matched, within its declared bound. */
  | 'delivered'
  /** Matched, and reached further than declared. Still the intended change. */
  | 'overreached'
  /** Matched nothing, and the run watched it. The edit did not take. */
  | 'undelivered'
  /** Matched nothing, and the run could not have seen it either way. */
  | 'unobservable';

export interface ClaimOutcome {
  readonly claim: Claim;
  readonly verdict: ClaimVerdict;
  /** Changes this claim accounts for, most widespread first. */
  readonly changes: readonly Change[];
  /** Subjects reached, deduplicated across the matched changes. */
  readonly subjects: readonly string[];
  /** One sentence, ready to print, naming the next move rather than the state. */
  readonly because: string;
}

export interface UnclaimedChange {
  readonly change: Change;
  readonly because: string;
}

export interface RunAdjudication {
  readonly claims: readonly ClaimOutcome[];
  /** Changes no claim covers. Arm two, in report order. */
  readonly unclaimed: readonly UnclaimedChange[];

  /**
   * Changed subjects that produced no shape at all.
   *
   * Never folded into either arm. A run with no document behind its comparison
   * cannot say what moved, so it cannot say whether a claim covers it — and
   * counting these as unclaimed would invent collateral out of missing evidence.
   */
  readonly ungrouped: readonly string[];

  /**
   * Subjects the run meant to observe and did not.
   *
   * Carried because it bounds every other line here. A claim checked against a
   * run that failed on 50 of 300 subjects is a claim checked against 250, and an
   * agent told `delivered` without being told that has been told something the
   * run never established.
   */
  readonly blind: readonly NotObserved[];

  /**
   * The worst thing present, in the order an agent should act on it.
   *
   * `unmet` outranks `review`: a claim that did not land means the agent's own
   * last action failed, and there is no point triaging collateral from an edit
   * that never happened.
   */
  readonly verdict: 'clean' | 'review' | 'unmet';
}

export interface AdjudicateOptions {
  /**
   * Claim fields the caller supplied that this resolution cannot check.
   *
   * The boundary that parses agent input passes them through so the answer can
   * say so. Silently dropping a declared band would tell an agent its band claim
   * held when nothing looked at it.
   */
  readonly unchecked?: readonly string[];
}

/** Adjudicate a run against what its author said they were doing. */
export function adjudicateRun(
  report: RunReport,
  claims: readonly Claim[],
  options: AdjudicateOptions = {},
): RunAdjudication {
  const clustering = clusterChanges(report.observations);
  const census = componentCensus(report);

  const taken = new Set<Change>();
  const outcomes = claims.map((claim) => {
    const matched = clustering.changes.filter((change) => covers(claim, change));
    for (const change of matched) taken.add(change);
    return outcomeOf(claim, matched, census, options);
  });

  const unclaimed = clustering.changes
    .filter((change) => !taken.has(change))
    .map((change) => ({ change, because: unclaimedBecause(change) }));

  return {
    claims: outcomes,
    unclaimed,
    ungrouped: clustering.ungrouped,
    blind: report.notObserved ?? [],
    verdict: worst(outcomes, unclaimed, clustering),
  };
}

/**
 * Subjects each component was rendered in, or `undefined` when the run kept no
 * census.
 *
 * `undefined` and an empty map are different claims and both occur: a run with no
 * semantic snapshots to fold has no composition section at all, and reading that
 * as "no component rendered anywhere" would turn every claim into evidence of a
 * failed edit.
 */
function componentCensus(report: RunReport): Map<string, readonly string[]> | undefined {
  const components = report.composition?.components;
  if (components === undefined) return undefined;

  return new Map(components.map((record) => [record.component, record.subjects]));
}

function covers(claim: Claim, change: Change): boolean {
  const { kind, name } = parseRoot(claim.root);

  return kind === 'shape' ? change.fingerprint === name : change.component === name;
}

/** `component:Button`, `shape:ab12…`, or a bare name read as a component. */
export function parseRoot(root: string): { kind: ClaimRootKind; name: string } {
  const separator = root.indexOf(':');
  if (separator === -1) return { kind: 'component', name: root };

  const prefix = root.slice(0, separator);
  const name = root.slice(separator + 1);

  return prefix === 'shape'
    ? { kind: 'shape', name }
    : { kind: 'component', name: prefix === 'component' ? name : root };
}

function outcomeOf(
  claim: Claim,
  matched: readonly Change[],
  census: Map<string, readonly string[]> | undefined,
  options: AdjudicateOptions,
): ClaimOutcome {
  const subjects = [...new Set(matched.flatMap((change) => change.subjects))];
  const caveat = options.unchecked?.length ? ` Not checked here: ${options.unchecked.join(', ')}.` : '';

  if (matched.length === 0) return undeliveredOutcome(claim, census, caveat);

  const exceeded = claim.maxSubjects !== undefined && subjects.length > claim.maxSubjects;
  const where = `${claim.root} changed in ${subjects.length} subject(s): ${preview(subjects)}`;

  return exceeded
    ? {
        claim,
        verdict: 'overreached',
        changes: matched,
        subjects,
        // Not a failure: the change is the declared one. What missed is the
        // author's estimate of its blast radius, which is the half worth showing
        // them rather than blocking on.
        because:
          `declared (${claim.reason}) and delivered, but reached ${subjects.length} ` +
          `subject(s) against the ${claim.maxSubjects} declared — the change is the ` +
          `intended one, its reach is not.${caveat}`,
      }
    : {
        claim,
        verdict: 'delivered',
        changes: matched,
        subjects,
        because: `declared (${claim.reason}) and delivered: ${where}.${caveat}`,
      };
}

/** Arm three, split by whether the run was in a position to see the claim fail. */
function undeliveredOutcome(
  claim: Claim,
  census: Map<string, readonly string[]> | undefined,
  caveat: string,
): ClaimOutcome {
  const { kind, name } = parseRoot(claim.root);
  const blank = { claim, changes: [], subjects: [] } as const;

  if (kind === 'shape') {
    return {
      ...blank,
      verdict: 'undelivered',
      // A shape is a digest of a difference. Claiming one that did not occur is
      // always the strong reading: nothing else could have produced it.
      because:
        `declared (${claim.reason}) and no change in this run carries shape ` +
        `\`${name}\` — nothing produced that difference.${caveat}`,
    };
  }

  if (census === undefined) {
    return {
      ...blank,
      verdict: 'unobservable',
      because:
        `declared (${claim.reason}) and nothing changed under \`${name}\`, but this run ` +
        'kept no component census, so it cannot say whether `' +
        name +
        '` was rendered at all. The claim was not checked.' +
        caveat,
    };
  }

  const rendered = census.get(name);

  if (rendered === undefined) {
    return {
      ...blank,
      verdict: 'unobservable',
      because:
        `declared (${claim.reason}) and this run never rendered \`${name}\` in any subject, ` +
        'so nothing here is evidence about it either way. Check the subject selection, or ' +
        'whether provenance names this component.' +
        caveat,
    };
  }

  return {
    ...blank,
    verdict: 'undelivered',
    because:
      `declared (${claim.reason}) and \`${name}\` rendered in ${rendered.length} subject(s) ` +
      `— ${preview(rendered)} — and did not change. The edit did not take: wrong file, a ` +
      'dead branch, a rule something else overrides, or a stale build.' +
      caveat,
  };
}

function unclaimedBecause(change: Change): string {
  const named = change.component ?? '(no component resolved; grouped by shape alone)';
  const settle =
    change.settles.length === 0
      ? 'nothing it can settle on its own'
      : `settles ${change.settles.length} of them`;

  return (
    `${named} moved and no claim covers it — ${change.subjects.length} subject(s), ` +
    `${change.pixels} pixel(s), ${settle}` +
    (change.cause ? '' : '; it was displaced rather than edited')
  );
}

function worst(
  outcomes: readonly ClaimOutcome[],
  unclaimed: readonly UnclaimedChange[],
  clustering: Clustering,
): RunAdjudication['verdict'] {
  if (outcomes.some((outcome) => outcome.verdict === 'undelivered')) return 'unmet';
  if (unclaimed.length > 0 || clustering.ungrouped.length > 0) return 'review';
  if (outcomes.some((outcome) => outcome.verdict !== 'delivered')) return 'review';
  return 'clean';
}

/**
 * The adjudication as the thing an agent reads before deciding what to do next.
 *
 * Ordered by what it should act on, not by what the run computed first:
 * undelivered claims lead, because an agent triaging collateral from an edit that
 * never happened is an agent about to make its second mistake.
 */
export function describeAdjudication(result: RunAdjudication): string {
  const counts = tally(result);
  const lines: string[] = [headline(result, counts)];

  const order: readonly ClaimVerdict[] = ['undelivered', 'unobservable', 'overreached', 'delivered'];
  for (const verdict of order) {
    for (const outcome of result.claims.filter((claim) => claim.verdict === verdict)) {
      lines.push('', `  [${outcome.verdict}] ${outcome.claim.root}`, `      ${outcome.because}`);
      for (const change of outcome.changes) {
        if (change.file !== undefined) lines.push(`      ${change.file}`);
      }
    }
  }

  for (const entry of result.unclaimed) {
    lines.push('', `  [unclaimed] ${entry.change.component ?? entry.change.fingerprint}`);
    lines.push(`      ${entry.because}`);
    if (entry.change.file !== undefined) lines.push(`      ${entry.change.file}`);
    if (entry.change.settles.length > 0) {
      lines.push(`      variance accept --shape ${entry.change.fingerprint}`);
    }
  }

  if (result.ungrouped.length > 0) {
    lines.push(
      '',
      `  [ungrouped] ${result.ungrouped.length} changed subject(s) carry no shape, so no claim ` +
        'could be checked against them: ' +
        preview(result.ungrouped),
    );
  }

  if (result.blind.length > 0) {
    lines.push(
      '',
      `  [not observed] ${result.blind.length} subject(s) were not looked at, so every line ` +
        'above is bounded by what this run saw: ' +
        preview(result.blind.map((entry) => entry.subject)),
    );
  }

  return lines.join('\n');
}

function headline(result: RunAdjudication, counts: Record<ClaimVerdict, number>): string {
  const claims =
    `${result.claims.length} claim(s): ${counts.delivered} delivered, ` +
    `${counts.undelivered} undelivered, ${counts.overreached} over-reaching, ` +
    `${counts.unobservable} unchecked.`;

  const lead =
    result.verdict === 'unmet'
      ? 'An edit you declared did not take. Fix that before reading anything else.'
      : result.verdict === 'review'
        ? 'Every declared edit landed; something you did not declare also moved.'
        : 'Every declared edit landed, and nothing else moved.';

  return `${lead}\n${claims} ${result.unclaimed.length} unclaimed change(s).`;
}

function tally(result: RunAdjudication): Record<ClaimVerdict, number> {
  const counts: Record<ClaimVerdict, number> = {
    delivered: 0,
    overreached: 0,
    undelivered: 0,
    unobservable: 0,
  };
  for (const outcome of result.claims) counts[outcome.verdict] += 1;
  return counts;
}

/** The first few, because a reader wants examples and not a manifest. */
function preview(items: readonly string[]): string {
  return items.length <= 4
    ? items.join(', ')
    : `${items.slice(0, 4).join(', ')}, and ${items.length - 4} more`;
}
