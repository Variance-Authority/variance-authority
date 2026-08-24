import {
  BANDS as FREQUENCY_BANDS,
  resolveSource,
  type ComponentHash,
  type SourceIndex,
} from '@variance-authority/core';
import type { FrequencyBand, Instability, RunRecord, TokenValue } from '@variance-authority/history';
import type { SubjectHistory } from './history.js';

/**
 * What one run's readings become on the way into the record.
 *
 * Split from [`history.ts`](./history.ts) because it is the place information
 * gets lost if anyone is careless, and the losses here are not symmetric. A
 * dropped instability answers "never" about a subject that has been failing all
 * week; a token folded to the wrong value puts a step in a journey nobody can
 * reproduce; a file resolved from an ambiguous name sends an agent to edit the
 * wrong one with full confidence. Each function below exists to stop one of
 * those, and all of them are testable on hand-built values with no store behind
 * them.
 */

/**
 * Component name → the file that declares it, for the names this subject holds.
 *
 * An **unambiguous** resolution only, and the line number is dropped. A name
 * declared in two files resolves to neither, because `Observation.file` is what
 * sends an agent to an editor and a guess sends it to the wrong one with full
 * confidence. The line is left out because a row outlives the line: components
 * move down a file every time somebody adds an import, and a stored `Button.tsx:22`
 * is wrong within a week while `Button.tsx` stays true.
 */
export function filesOf(
  hashes: readonly ComponentHash[],
  source: SourceIndex | undefined,
): Readonly<Record<string, string>> {
  if (source === undefined) return {};

  const files: Record<string, string> = {};
  for (const hash of hashes) {
    const resolved = resolveSource(hash.component, source);
    const [first] = resolved?.refs ?? [];
    if (resolved !== null && !resolved.ambiguous && first !== undefined) {
      files[hash.component] = first.file;
    }
  }

  return files;
}

/**
 * The custom properties out of an inherited floor.
 *
 * The floor also carries `font-size`, `color` and everything else the cascade
 * hands down, and none of those is a *token*: they are the computed consequence
 * of one, and recording them would make a journey through `--va-space-3` compete
 * with a journey through every element's inherited line height.
 *
 * Here rather than in the loop that calls it because this is the first half of
 * `tokensOf` below — one subject's answer, before the union across the suite —
 * and the two halves disagreeing about what counts as a token is the kind of
 * split that only shows up as a journey missing a step.
 */
export function customProperties(
  inherited: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const tokens: Record<string, string> = {};
  for (const [property, value] of Object.entries(inherited)) {
    if (property.startsWith('--')) tokens[property] = value;
  }
  return tokens;
}

/**
 * The tokens this run resolved, folded to one value each.
 *
 * Three hundred subjects inherit the same `:root` declarations, so the raw
 * material is three hundred copies of one answer. What is written is the union,
 * once — a `TokenValue` carries no subject, and it cannot: the question it exists
 * to answer is what *the product's* spacing scale drifted to, not what one story
 * saw.
 *
 * **A token with two values in one run is not recorded at all.** A themed subtree
 * that overrides `--brand` is a legitimate second answer, and picking either one
 * would put a value in a journey that the reader would trace to a commit and be
 * unable to reproduce. It is dropped and *counted*, because a journey silently
 * missing its most interesting token is the failure this file exists to refuse.
 */
export function tokensOf(
  subjects: readonly SubjectHistory[],
  run: RunRecord,
  warnings: string[],
): readonly TokenValue[] {
  const seen = new Map<string, Set<string>>();

  for (const subject of subjects) {
    for (const [token, value] of Object.entries(subject.tokens ?? {})) {
      const values = seen.get(token) ?? new Set<string>();
      values.add(value);
      seen.set(token, values);
    }
  }

  const rows: TokenValue[] = [];
  const contested: string[] = [];

  for (const [token, values] of [...seen.entries()].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    const [only] = [...values];
    if (values.size > 1 || only === undefined) {
      contested.push(token);
      continue;
    }
    rows.push({ project: run.project, token, value: only, commit: run.commit, at: run.at });
  }

  if (contested.length > 0) {
    warnings.push(
      `${contested.length} token(s) resolved to more than one value in this run and were not ` +
        `recorded: ${contested.slice(0, 5).join(', ')}${contested.length > 5 ? ', …' : ''}. ` +
        'A journey through a value the product never held everywhere is a step nobody can ' +
        'reproduce, so no value was picked',
    );
  }

  return rows;
}

/**
 * One row per named `(component, band)` pair, and a single unnamed row when the
 * readings could not be resolved to either.
 *
 * The cross product is deliberate and cheap: an occurrence names one or two
 * components in one or two bands, and a flat row is what lets a query rank *which
 * component keeps flaking* without parsing a blob. A run that disagreed with
 * itself and could name nothing still writes one row, because the occurrence
 * happened and a store that dropped it would answer "never" about a subject that
 * has been failing all week.
 */
export function instabilitiesOf(subject: SubjectHistory, run: RunRecord): readonly Instability[] {
  const unstable = subject.unstable;
  if (unstable === undefined) return [];

  const base = {
    project: run.project,
    subject: subject.subject,
    profile: run.profile,
    commit: run.commit,
    run: run.run,
    at: run.at,
    ...(unstable.absorbed !== undefined ? { absorbedBy: unstable.absorbed.rule } : {}),
  };

  const components = unstable.components.map((component) => component.name);

  // The report types its bands as strings — `@variance-authority/report` has no
  // dependency on `core` and cannot name the union — so they are checked here
  // rather than cast. A value nothing recognises is dropped from the *naming*
  // and never from the occurrence: the subject did read differently, and a row
  // withheld because its label was unfamiliar would answer "never" about a
  // subject that has been failing all week.
  const bands = unstable.bands.filter((band): band is FrequencyBand =>
    FREQUENCY_BANDS.includes(band as FrequencyBand),
  );

  if (components.length === 0 && bands.length === 0) return [base];
  if (components.length === 0) return bands.map((band) => ({ ...base, band }));
  if (bands.length === 0) return components.map((component) => ({ ...base, component }));

  return components.flatMap((component) => bands.map((band) => ({ ...base, component, band })));
}
