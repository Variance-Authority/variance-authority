import { identityDigest } from '@variance-authority/core';
import type { LexiconField, LexiconReport, SubjectLexicon } from '@variance-authority/report';
import { OperatorError } from '../exit.js';
import { isShardFilter, type CliRunReport, type NotObserved } from './run-report.js';
import { ledgerOf, type IgnoreLedger } from './ignores.js';

/**
 * N shard reports into one, or a refusal naming which two disagreed.
 *
 * A suite big enough to shard runs `variance run --subjects <glob>` once per CI
 * job and ends with N artifacts. Every question anyone actually asks is about the
 * *suite* — did anything change, what needs review, what should the one PR
 * comment say — and none of the N can answer it. Posting N comments is the
 * workaround, and it is the reason a sharded suite drifts into being read by
 * nobody.
 *
 * ## The whole design is in one rule
 *
 * A merged report must not be able to say anything a single run could not. So
 * every field that is *singular* in a run report — the renderer identity, the
 * retention, the intent — has to agree across the shards or the merge is refused
 * by name. Picking one and carrying on would attribute half the observations to a
 * machine that never saw them, which is precisely the failure `identityDigest`
 * partitioning exists to prevent (ADR-0011). A merge that guesses is worse than
 * no merge, because the artifact it produces looks exactly like a real one.
 *
 * ## What sharding does to the coverage list, and what this does back
 *
 * `--subjects` records every subject outside the slice as `excluded`. Merge
 * three shards naively and each subject is observed once and excluded twice — a
 * report that contradicts itself. The resolution is not to drop exclusions,
 * because that would throw away the only evidence of the case that matters:
 *
 * **A subject no shard claimed is a hole in the split, and it exits 1.** If every
 * shard filtered a subject out, then the globs did not cover the suite and
 * nobody looked at that component. Left as `excluded` it would be a green build
 * over an unwatched surface — the exact thing `notObserved` was added to prevent —
 * so it is promoted to `failed` and `exitFor` refuses the run. This is the
 * property that makes sharding safe here, and it costs the operator nothing: a
 * correct split never produces one.
 *
 * ## The one section a merge cannot carry, and the one it can
 *
 * Everything above is a fold over per-subject answers, and folds shard. The
 * composition section is not one: it is the run's subjects compared to *each
 * other*, and the split is exactly what destroys it. It is dropped, out loud —
 * see `unmergeable`. The lexicon is the other kind: every name a subject carried,
 * per subject, and a subject is in exactly one shard. It is carried — see
 * `lexiconOf` — under the fields every shard read.
 */

export interface Shard {
  /** Where it was read from. Named in every refusal, because "two disagree" is useless without both. */
  readonly path: string;
  readonly report: CliRunReport;
}

export function mergeReports(shards: readonly Shard[]): CliRunReport {
  const [first, ...rest] = shards;
  if (first === undefined) throw new OperatorError('merging needs at least one report');
  if (rest.length === 0) return first.report;

  agree(shards, 'renderer identity', (shard) => identityDigest(shard.report.identity));
  agree(shards, 'retention', (shard) => shard.report.retention);
  agree(shards, 'run version', (shard) => String(shard.report.runVersion));
  // Absent is a value here, not a skip: one shard run with `--intent` and one
  // without were given different questions to answer, and the merged report
  // carries the answer into every sentence it prints.
  agree(shards, 'intent', (shard) => shard.report.intent ?? '(none)');

  // Field by field rather than a spread of the first shard, and the difference
  // matters twice. `notObserved` must be able to come out *absent* when a shard
  // never said what it skipped, which a spread of a shard that did say would
  // quietly overwrite. And a field added to `RunReport` later stops compiling
  // here if it is required — which is the only moment anyone will think about
  // whether N shards can have one of it.
  //
  // `composition` is the case that moment missed, because it is optional: it
  // vanished from every merged report and nothing said so. Dropping it is still
  // the right answer, and now it is an answer rather than an omission.
  return {
    runVersion: first.report.runVersion,
    at: earliest(shards),
    identity: first.report.identity,
    retention: first.report.retention,
    ...(first.report.intent !== undefined ? { intent: first.report.intent } : {}),
    observations: observationsOf(shards),
    ...coverageOf(shards),
    ...warningsOf(shards, unmergeable(shards)),
    ...ignoresOf(shards),
    ...lexiconOf(shards),
  };
}

/**
 * Every shard's lexicon entries, in shard order, under the fields all of them read.
 *
 * A subject's names are a fact about that subject, so concatenating the per-subject
 * entries is the union — `observationsOf` has already refused a subject two shards
 * both claim. The field list is the intersection, and the entries are cut to it:
 * `fields` is the run's admission of what it looked at, and one shard that ran
 * without a journal did not look at `regions` for its subjects. A merged report
 * listing `regions` would send a reader searching a field half the suite never
 * had, and a no-match there would read as *no subject entered it*.
 *
 * Absent when no shard wrote one, and present when any did: a shard that
 * composed nothing (a raster-only slice) contributes no subjects, and the
 * remaining entries are still every name the suite held for the subjects that
 * were composed.
 */
function lexiconOf(shards: readonly Shard[]): { lexicon?: LexiconReport } {
  const written = shards.filter((shard) => shard.report.lexicon !== undefined);
  const [first] = written.map((shard) => shard.report.lexicon!);
  if (first === undefined) return {};

  agree(written, 'lexicon version', (shard) => String(shard.report.lexicon!.version));

  const fields = first.fields.filter((field) =>
    written.every((shard) => shard.report.lexicon!.fields.includes(field)),
  );
  const read = new Set<LexiconField>(fields);

  const subjects = written.flatMap((shard) =>
    shard.report.lexicon!.subjects.map((entry) => cut(entry, read)),
  );

  return { lexicon: { version: first.version, fields, subjects } };
}

/** One subject's entry restricted to the fields the merged report may claim. */
function cut(entry: SubjectLexicon, read: ReadonlySet<LexiconField>): SubjectLexicon {
  const keep = <T>(record: Partial<Record<LexiconField, T>> | undefined) =>
    Object.fromEntries(
      Object.entries(record ?? {}).filter(([field]) => read.has(field as LexiconField)),
    ) as Partial<Record<LexiconField, T>>;

  const elided = keep(entry.elided);
  return {
    subject: entry.subject,
    boundaries: entry.boundaries,
    terms: keep(entry.terms),
    ...(Object.keys(elided).length === 0 ? {} : { elided }),
  };
}

/**
 * The ignore ledger, recomputed over the merged observations.
 *
 * Not summed from the shards, and the difference is the whole reason this exists.
 * A rule is dead when it absorbed nothing *anywhere*, so a shard that saw none of
 * the subjects a rule matches would call it dead and a shard that saw all of them
 * would not — and adding those two answers together produces neither. The counts
 * are a fold over observations, so the merged report folds the merged list.
 *
 * The rules come from the first shard because `agree` has already refused a merge
 * across shards that were configured differently, and an ignore is configuration.
 * Absent when no shard had a ledger: a merged report must be able to say the
 * writer never configured any, which is not the same as "none absorbed anything".
 */
function ignoresOf(shards: readonly Shard[]): { ignores?: IgnoreLedger } {
  const rules = shards
    .map((shard) => shard.report.ignores)
    .find((ledger): ledger is IgnoreLedger => ledger !== undefined);
  if (rules === undefined) return {};

  const merged = ledgerOf(
    rules.rules.map((entry) => ({ id: entry.rule, reason: entry.reason })),
    observationsOf(shards),
  );
  return merged === undefined ? {} : { ignores: merged };
}

function agree(shards: readonly Shard[], field: string, of: (shard: Shard) => string): void {
  const [first, ...rest] = shards;
  const mine = of(first!);

  for (const other of rest) {
    if (of(other) === mine) continue;
    throw new OperatorError(
      `these reports were not one run: ${first!.path} has ${field} ${mine} and ` +
        `${other.path} has ${of(other)}. Shards of one suite must be produced by ` +
        'the same configuration on the same machine image; merging them anyway ' +
        'would put both answers under one heading with no way to tell which is which.',
    );
  }
}

/**
 * The oldest, so a merged report is never fresher than its stalest part.
 *
 * `report` cannot tell whether a report is stale ‒ it says so in its own header ‒
 * and the only defence a reader has is the timestamp. Carrying the newest would
 * make a merge a way to launder an hour-old shard into a current answer.
 */
function earliest(shards: readonly Shard[]): string {
  let best = shards[0]!;
  let bestAt = parse(best);

  for (const shard of shards.slice(1)) {
    const at = parse(shard);
    if (at < bestAt) {
      best = shard;
      bestAt = at;
    }
  }
  return best.report.at;
}

function parse(shard: Shard): number {
  const at = Date.parse(shard.report.at);
  if (Number.isNaN(at)) {
    throw new OperatorError(
      `${shard.path} has \`at\`: ${JSON.stringify(shard.report.at)}, which is not a date. ` +
        'A merged report states when the oldest shard ran, and cannot state it from this.',
    );
  }
  return at;
}

/**
 * Every shard's observations, in shard order, with an overlap refused.
 *
 * Two observations of one subject means the globs overlapped, and there is no
 * safe resolution: the two ran at different times against the same baseline, so
 * keeping either one is a choice about which verdict is real. The operator wrote
 * the globs and is the only one who can say which shard should have had it.
 */
function observationsOf(shards: readonly Shard[]): CliRunReport['observations'] {
  const seen = new Map<string, string>();
  const merged: CliRunReport['observations'][number][] = [];

  for (const shard of shards) {
    for (const record of shard.report.observations) {
      const earlier = seen.get(record.subject);
      if (earlier !== undefined) {
        throw new OperatorError(
          `\`${record.subject}\` was observed by both ${earlier} and ${shard.path}. ` +
            'The --subjects globs overlap; one subject can only have one verdict, and ' +
            'this will not choose between two runs of it.',
        );
      }
      seen.set(record.subject, shard.path);
      merged.push(record);
    }
  }
  return merged;
}

/**
 * The coverage list, with shard filters resolved against what was observed.
 *
 * One shard that never said what it skipped poisons the whole thing to `absent`,
 * and that is the field's own rule rather than a decision taken here: `undefined`
 * means *the writer never said*, and no amount of other shards saying can turn
 * one silence into a claim about the suite. `exitFor` reads that as needing
 * review, which is the conservative end and the right one.
 */
function coverageOf(shards: readonly Shard[]): { notObserved?: readonly NotObserved[] } {
  if (shards.some((shard) => shard.report.notObserved === undefined)) return {};

  const observed = new Set(
    shards.flatMap((shard) => shard.report.observations.map((record) => record.subject)),
  );

  const bySubject = new Map<string, { entries: NotObserved[]; paths: string[] }>();
  for (const shard of shards) {
    for (const entry of shard.report.notObserved ?? []) {
      const found = bySubject.get(entry.subject) ?? { entries: [], paths: [] };
      found.entries.push(entry);
      found.paths.push(shard.path);
      bySubject.set(entry.subject, found);
    }
  }

  const notObserved: NotObserved[] = [];
  for (const [subject, { entries, paths }] of bySubject) {
    const decisions = entries.filter((entry) => !isShardFilter(entry));

    if (observed.has(subject)) {
      // A shard filter beside an observation is the normal case and is exactly
      // what merging is for. Anything else is a contradiction about one subject
      // in one suite, and has the same cause as a duplicate observation.
      if (decisions.length === 0) continue;
      throw new OperatorError(
        `\`${subject}\` was observed by one shard and reported as not observed by ` +
          `${paths.join(', ')}: ${decisions[0]!.because}. Two shards disagree about ` +
          'whether it was looked at, so neither answer can be printed as the suite\'s.',
      );
    }

    if (decisions.length === 0) {
      notObserved.push({
        subject,
        kind: 'failed',
        because:
          `no shard observed it: all ${entries.length} reports filtered it out with ` +
          '--subjects. The globs do not cover the suite, so this subject is unwatched ' +
          'rather than excluded.',
      });
      continue;
    }

    // A failure outranks an exclusion. A subject the operator excluded in one
    // shard and that crashed in another is a coverage hole either way, and
    // printing the exclusion would file it under decisions somebody made.
    notObserved.push(decisions.find((entry) => entry.kind === 'failed') ?? decisions[0]!);
  }

  return { notObserved };
}

function warningsOf(
  shards: readonly Shard[],
  added: readonly string[],
): { warnings?: readonly string[] } {
  // Deduplicated because every shard loads the same subject index and therefore
  // repeats the same complaint about it N times, which reads as N problems.
  const warnings = [
    ...new Set([...shards.flatMap((shard) => shard.report.warnings ?? []), ...added]),
  ];
  return warnings.length === 0 ? {} : { warnings };
}

/**
 * The one section a merge drops, and the sentence it drops it with.
 *
 * A union of the shard graphs is unsound in a way no reader could detect. Two
 * subjects sharing a rendering *are* the finding, and a pair that landed in
 * different shards is in neither report — so the union has every cross-shard
 * edge missing, with nothing marking where. An echo count that is silently a
 * lower bound is a bad answer; a `held` list that is silently short is a worse
 * one, because that list is the evidence behind calling something a flake.
 *
 * It cannot be recomputed here either. `variants` and `renderings` count
 * distinct digests, and the digests are in the snapshots rather than in the
 * artifact — which is the bargain
 * [`composition.ts`](../../../report/src/composition.ts) already states.
 *
 * So it is omitted, and the omission is a warning rather than a silence. The
 * rule this file is built on is that a merged report must not say anything a
 * single run could not; the corollary, learned here, is that it must not be
 * quietly *missing* a section either. A reader who saw the graph yesterday and
 * not today would otherwise conclude the suite stopped sharing components.
 */
function unmergeable(shards: readonly Shard[]): readonly string[] {
  const composed = shards.filter((shard) => shard.report.composition !== undefined).length;
  if (composed === 0) return [];

  return [
    `composition dropped: ${composed} of ${shards.length} shard(s) compared their subjects to ` +
      'each other, and that comparison does not survive a split — two subjects sharing a ' +
      'rendering are the finding, and a pair that landed in different shards is in neither ' +
      'report. Each subject\'s structure rows go with it. Run the suite unsharded to ask ' +
      'for the component graph or one subject\'s composition; the lexicon is per subject ' +
      'and is carried.',
  ];
}
