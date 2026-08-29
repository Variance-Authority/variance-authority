/**
 * What the config *declared*, and what each declaration did in this run.
 *
 * The two ledgers a run keeps about its own settings. An ignore says *part of
 * this page is not my subject*; a sensitivity says *assert on this much of it*.
 * Both make a run less observant on purpose, and both are only safe because
 * every run counts what they absorbed — a declaration that stopped being needed
 * is invisible without a count of zero, and a mask that outlives its cause grows
 * quietly over a real regression.
 *
 * They live here rather than with the command that computes them for the reason
 * the rest of this package exists: they have several readers. The CLI folds them,
 * a terminal prints them, an HTML page tabulates them, and a review service
 * stores them so the audit survives the machine the run happened on. A shape
 * owned by the first of those bends towards a terminal.
 *
 * ## One decision, taken once
 *
 * A rule's *state* — spent, mistyped, expired, or simply working — is a reading
 * of the counts, not another count. It is taken by {@link ignoreState} and
 * {@link sensitivityState} and nowhere else, because a second reader that
 * re-derived it would eventually disagree: the first HTML report to try shipped
 * `pixels === 0` as the whole test for *dead*, which calls every rule in a fresh
 * checkout dead, on the run that proves least about any of them.
 */

/** What one ignore rule did this run. */
export interface IgnoreUsage {
  readonly rule: string;
  readonly reason: string;

  /** Changed pixels this rule absorbed across the run. */
  readonly pixels: number;

  /** Subjects where it excluded something, whether or not it absorbed anything. */
  readonly subjects: number;

  /**
   * Subjects where it excluded something **and a comparison happened**.
   *
   * The denominator that stops "absorbed nothing" from being an accusation. A
   * subject that is `new`, `incomparable`, or settled from a digest compared no
   * pixels, so an ignore over it had nothing to absorb — which says nothing at
   * all about whether the rule is still needed. Without this a fresh checkout
   * reported every ignore in the config as dead.
   */
  readonly comparedIn: number;

  /** Subjects where it excluded something and absorbed nothing there. */
  readonly inertIn: number;

  /** `true` when it never resolved to a place in any subject. */
  readonly unresolved: boolean;

  /**
   * Tags the rule names that no subject in this run wears.
   *
   * The only defence a tag has. A misspelled *key* is refused by name because
   * the config's objects are closed; a misspelled *tag* is a legal word that
   * simply matches nothing, and the rule then silently applies nowhere while the
   * operator reads their config and believes it applies somewhere. So the words
   * nothing answered to are named, with the near-misses that were present, and
   * an empty list is the ordinary case rather than the interesting one.
   */
  readonly unwornTags: readonly string[];

  /** `true` when it is past `until` and no longer absorbing. */
  readonly expired: boolean;
}

/** Every ignore rule the config named, and what the run as a whole absorbed. */
export interface IgnoreLedger {
  readonly rules: readonly IgnoreUsage[];

  /**
   * Rules that absorbed nothing anywhere this run.
   *
   * The list an operator is meant to act on. Named separately rather than left
   * to be derived, because a derivation nobody writes is a report nobody reads.
   */
  readonly dead: readonly string[];

  /** Subjects whose only differences were absorbed. Green, and not `unchanged`. */
  readonly fullyIgnored: readonly string[];

  readonly totalPixels: number;

  /** Every tag worn by a subject this run planned, for the near-miss hint. */
  readonly vocabulary: readonly string[];
}

/** What one sensitivity rule did this run. */
export interface SensitivityUsage {
  readonly rule: string;
  readonly reason: string;
  readonly level: string;

  /** Subjects this rule was in scope for, whether or not it absorbed them. */
  readonly scoped: number;

  /** Subjects whose verdict it decided. */
  readonly absorbed: readonly string[];

  /** Bands it absorbed, across every subject it decided. */
  readonly bands: readonly string[];

  /**
   * `true` when the rule matched no subject this run planned.
   *
   * A different failure from absorbing nothing, and worth its own word: a rule
   * naming `route/*` in a project whose subjects are all `story:*` is a typo,
   * not a policy that has outlived its cause.
   */
  readonly unscoped: boolean;
}

/** Every sensitivity rule the config named, and how much they relaxed. */
export interface SensitivityLedger {
  readonly rules: readonly SensitivityUsage[];
  readonly totalAbsorbed: number;
}

/**
 * What an ignore rule turned out to be, read from what it did.
 *
 * - `expired` — past its date. The differences it used to absorb are back.
 * - `unworn` — it names a tag no subject in this run wears, so it applied nowhere.
 * - `unresolved` — its selector matched no element in any subject.
 * - `untested` — it excluded a subtree, and nothing it covered was compared.
 * - `dead` — it excluded a subtree in subjects that *were* compared, and took nothing.
 * - `live` — it absorbed something.
 *
 * The order is the order the checks run in, and it matters: an expired rule that
 * also names a mistyped tag is expired, because that is the fact that explains
 * the other. `untested` and `dead` are the pair worth keeping apart — the first
 * is an absence of evidence and the second is evidence of absence, and a report
 * that spells both *dead* tells an operator to delete a rule on the run that
 * proves least about it.
 */
export type IgnoreState = 'expired' | 'unworn' | 'unresolved' | 'untested' | 'dead' | 'live';

/**
 * What a sensitivity rule turned out to be.
 *
 * - `unscoped` — it matched no subject this run planned.
 * - `dead` — it was in scope and decided nothing; nothing here needed relaxing.
 * - `live` — it decided at least one verdict.
 */
export type SensitivityState = 'unscoped' | 'dead' | 'live';

/** The single reading of an ignore's counts. Every surface asks this one. */
export function ignoreState(entry: IgnoreUsage): IgnoreState {
  if (entry.expired) return 'expired';
  if (entry.unwornTags.length > 0) return 'unworn';
  if (entry.unresolved) return 'unresolved';
  if (entry.pixels === 0) return entry.comparedIn === 0 ? 'untested' : 'dead';
  return 'live';
}

/** The single reading of a sensitivity's counts. */
export function sensitivityState(entry: SensitivityUsage): SensitivityState {
  if (entry.unscoped) return 'unscoped';
  return entry.absorbed.length === 0 ? 'dead' : 'live';
}

/**
 * Whether a state names something to do about the config.
 *
 * `untested` is deliberately not one. It is the absence of evidence, and a
 * report that flagged it would ask an operator to act on a run that measured
 * nothing — which is how audits stop being read.
 */
export function isActionable(state: IgnoreState | SensitivityState): boolean {
  return state !== 'live' && state !== 'untested';
}

/* --- what a surface says about a rule ------------------------------------- */

/**
 * The sentence behind an ignore's state.
 *
 * Here rather than in a renderer for the reason the state itself is here: an
 * HTML table, a terminal and a review page all have to answer *why is this rule
 * marked* and there is one answer. Two of them writing their own is how a report
 * and a service come to disagree about the same run in front of the same person.
 *
 * The near-miss on `unworn` is the part worth carrying: the likeliest cause of a
 * tag nothing wears is a typo, and naming the tags that *are* worn turns a
 * report into a fix.
 */
export function ignoreSays(entry: IgnoreUsage, ledger: IgnoreLedger): string {
  switch (ignoreState(entry)) {
    case 'expired':
      return 'Past its date. The differences it absorbed are being reported again.';
    case 'unworn': {
      const worn =
        ledger.vocabulary.length === 0
          ? ''
          : ` Tags worn in this run: ${ledger.vocabulary.join(', ')}.`;
      return (
        `No subject in this run wears ${entry.unwornTags.join(', ')}, ` +
        `so the rule applied nowhere.${worn}`
      );
    }
    case 'unresolved':
      return (
        'Its selector matched nothing in any subject. Either it is no longer needed, or it ' +
        'stopped matching and something you believe is silenced is being reported.'
      );
    case 'untested':
      return (
        `It excluded a subtree in ${String(entry.subjects)} subject(s), none of which was ` +
        'compared this run. Nothing here says whether it is still needed.'
      );
    case 'dead':
      return (
        `It excluded a subtree in ${String(entry.subjects)} subject(s), ` +
        `${String(entry.comparedIn)} of them compared, and absorbed nothing.`
      );
    default:
      return `Absorbed ${String(entry.pixels)} pixel(s) across ${String(entry.subjects)} subject(s).`;
  }
}

/**
 * The run-level line under the ignore table, vocabulary included.
 *
 * The last clause is the one that has to be there. With no vocabulary the
 * unworn-tag check did not run at all, and a footer that said nothing about it
 * would read as every tag having been checked and every tag having been found.
 *
 * The first clause counts the rules that *absorbed*, over the rules that were
 * declared, and the two are only the same number on a run where every rule
 * worked. Counting declarations there put the whole run's pixels behind the size
 * of the config: two rules, one of them matching nothing, read as *647 pixels
 * absorbed by 2 rules* directly above a table saying one of them resolved
 * nowhere. The table is the audit; the footer must not contradict it.
 */
export function ignoreTotals(ledger: IgnoreLedger): string {
  const parts = [
    `${ledger.totalPixels.toLocaleString('en-US')} pixel(s) absorbed by ${ignoreShare(ledger)}`,
  ];
  if (ledger.fullyIgnored.length > 0) {
    parts.push(`${String(ledger.fullyIgnored.length)} subject(s) differed only there`);
  }
  parts.push(
    ledger.vocabulary.length === 0
      ? 'no subject in this run declared a tag, so no tag was checked'
      : `checked against ${String(ledger.vocabulary.length)} declared tag(s)`,
  );
  return parts.join(' · ');
}

/** The sentence behind a sensitivity's state. */
export function sensitivitySays(entry: SensitivityUsage): string {
  switch (sensitivityState(entry)) {
    case 'unscoped':
      return (
        'It matched no subject this run planned. Check the subjects and tags it names — this is ' +
        'a typo rather than a policy that has outlived its cause.'
      );
    case 'dead':
      return (
        `It was in scope for ${String(entry.scoped)} subject(s) and decided none of them. ` +
        'Nothing here needed relaxing.'
      );
    default:
      return (
        `It decided ${String(entry.absorbed.length)} of ${String(entry.scoped)} ` +
        'subject(s) in scope.'
      );
  }
}

/**
 * The run-level line under the sensitivity table.
 *
 * Rules that decided something, over rules declared — the same reading as
 * {@link ignoreTotals}, and for the same reason. *0 subjects not asserted on in
 * full, by 1 rule* is a sentence with a rule in it that did nothing.
 */
export function sensitivityTotals(ledger: SensitivityLedger): string {
  return (
    `${String(ledger.totalAbsorbed)} subject(s) not asserted on in full, ` +
    `by ${sensitivityShare(ledger)}`
  );
}

/**
 * How many of the declared ignores absorbed anything, over how many were written.
 *
 * A phrase rather than a number because there are four footers printing it — an
 * HTML report, a review page and two terminal summaries — and the arithmetic is
 * the part that has to be identical between them. Whether a rule counts here is
 * the same reading {@link ignoreState} takes, and a surface that re-derived it
 * would eventually take a different one.
 */
export function ignoreShare(ledger: IgnoreLedger): string {
  return over(ledger.rules.filter((rule) => rule.pixels > 0).length, ledger.rules.length);
}

/** The same reading for sensitivities: rules that decided a verdict, over rules written. */
export function sensitivityShare(ledger: SensitivityLedger): string {
  return over(ledger.rules.filter((rule) => rule.absorbed.length > 0).length, ledger.rules.length);
}

/**
 * *n rule(s)* when every declaration did the thing, *n of m* when they did not.
 *
 * The bare count is kept for the ordinary case because *2 of 2 rule(s)* invites a
 * reader to go looking for the one that is missing.
 */
function over(did: number, declared: number): string {
  return did === declared
    ? `${String(did)} rule(s)`
    : `${String(did)} of ${String(declared)} rule(s)`;
}

/**
 * The bands a rule absorbed, or the fact that they were not kept.
 *
 * `undefined` is the third answer, and it is the whole reason this is a function
 * rather than a field read. A rule that decided verdicts with no band recorded is
 * not a rule that absorbed nothing — it is a report written before the bands were
 * kept, or by a writer that dropped them, and an empty list says the first.
 */
export function absorbedBands(entry: SensitivityUsage): readonly string[] | undefined {
  if (entry.absorbed.length === 0) return [];
  return entry.bands.length === 0 ? undefined : entry.bands;
}

/* --- what made one subject green ------------------------------------------ */

/**
 * The part of an observation that says why it came back green.
 *
 * Structural rather than the whole `ObservationRecord`, because the second
 * caller is a review service whose subjects arrive from a database and carry
 * only what was stored. Writing the relation over the fields it actually reads
 * is what lets both of them ask the same question, and stops the answer from
 * being re-derived on the far side of the wire.
 */
export interface GreenSubject {
  readonly verdict: 'unchanged' | 'changed' | 'new' | 'incomparable' | 'ignored';
  //
  // Both are written `| undefined` as well as optional, because the second
  // caller reads its subjects out of a database and declares them by indexed
  // access — which puts `undefined` in the property's type rather than in its
  // optionality. Under `exactOptionalPropertyTypes` those are different types,
  // and this is the one place the two spellings have to meet.
  readonly ignored?:
    | {
        readonly pixels: number;
        readonly boxes: number;
        readonly byRule: Readonly<Record<string, number>>;
      }
    | undefined;
  readonly relaxed?:
    | { readonly rule: string; readonly level: string; readonly bands: readonly string[] }
    | undefined;
}

/**
 * Why one subject is green.
 *
 * - `measured` — nothing differed, and no declaration stood over it.
 * - `masked` — nothing differed, and a rule was watching anyway. Its boxes
 *   caught nothing here, which is how a mask starts outliving its cause.
 * - `relaxed` — it differed, and every band that moved is one this subject is
 *   not asserted on.
 * - `absorbed` — it differed, and every differing pixel fell inside an excluded
 *   subtree. The rules that took them are named.
 * - `unsaid` — it is `ignored` and the record does not say what did it.
 */
export type Green =
  | { readonly kind: 'measured' }
  | { readonly kind: 'masked'; readonly boxes: number }
  | {
      readonly kind: 'relaxed';
      readonly rule: string;
      readonly level: string;
      readonly bands: readonly string[];
    }
  | { readonly kind: 'absorbed'; readonly rules: readonly string[]; readonly pixels: number }
  | { readonly kind: 'unsaid' };

/**
 * What decided a green subject, in the words of whatever decided it.
 *
 * `unsaid` is the case this exists for. A subject reported `ignored` whose
 * record carries neither block says *a declaration absorbed this* and does not
 * say which — and both obvious renderings of that are false. Printing nothing
 * reads as *nothing was absorbed*; printing `0 px` reads as *a rule absorbed
 * nothing*. So the absence is a state, and every surface has to render it.
 *
 * It is reachable two ways and they are worth telling apart when reading a bug:
 * an older report written before the blocks were kept, and a store that dropped
 * them on the way in. The second is the one that turns a report and a service
 * into two different accounts of one run.
 */
export function greenBecause(entry: GreenSubject): Green {
  if (entry.verdict !== 'ignored') {
    const boxes = entry.ignored?.boxes ?? 0;
    return boxes === 0 ? { kind: 'measured' } : { kind: 'masked', boxes };
  }

  if (entry.relaxed !== undefined) {
    const { rule, level, bands } = entry.relaxed;
    return { kind: 'relaxed', rule, level, bands };
  }

  const rules = Object.entries(entry.ignored?.byRule ?? {})
    .filter(([, pixels]) => pixels > 0)
    .map(([rule]) => rule);

  return rules.length === 0
    ? { kind: 'unsaid' }
    : { kind: 'absorbed', rules, pixels: entry.ignored?.pixels ?? 0 };
}
