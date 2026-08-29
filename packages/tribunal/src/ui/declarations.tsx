/**
 * What the config declared, and what each declaration did — on the review page.
 *
 * The audit surface, and the one part of a run that a reviewer cannot recover by
 * looking harder at the pictures. An ignore says *part of this page is not my
 * subject*; a sensitivity says *assert on this much of it*. Both make a run less
 * observant on purpose, and both are only safe because something counts what they
 * absorbed: a mask that outlived its cause grows quietly over a real regression,
 * and the only thing that ever catches it is a line saying the rule took nothing
 * again. A run prints that line once, into a terminal nobody keeps. This is where
 * it survives long enough to be *again*.
 *
 * ## The same words the report uses
 *
 * Every state and every sentence here comes from `@variance-authority/report` —
 * {@link ignoreState}, {@link ignoreSays}, {@link ignoreTotals} and their
 * sensitivity twins. Nothing on this page decides what *dead* means. That is the
 * house rule about renderers, and it is load-bearing rather than tidy: an
 * operator reading `dead` in their terminal, `dead` in the HTML report and
 * something else here would have three tools and no answer, and the first
 * version of the HTML table earned exactly that by re-deriving the state from
 * `pixels === 0` — which calls every rule in a fresh checkout dead.
 *
 * ## Absence, which is a third thing
 *
 * `null` is *this build carried no ledger*, and the panel says so in words rather
 * than by rendering nothing. Silence in an audit reads as *audited, and clean*,
 * which is the one sentence a surface like this must never accidentally make.
 */

import type { ReactElement } from 'react';
import {
  absorbedBands,
  ignoreSays,
  ignoreState,
  ignoreTotals,
  isActionable,
  sensitivitySays,
  sensitivityState,
  sensitivityTotals,
  type IgnoreLedger,
  type IgnoreUsage,
  type SensitivityLedger,
  type SensitivityUsage,
} from '@variance-authority/report';
import type { Declarations } from '../review-types.js';
import { number } from './text.js';

/** The card, or the sentence that stands in for it when nothing was carried. */
export function DeclarationsPanel({
  declarations,
}: {
  readonly declarations: Declarations;
}): ReactElement {
  const { ignores, sensitivities } = declarations;
  const hasIgnores = ignores !== null && ignores.rules.length > 0;
  const hasSensitivities = sensitivities !== null && sensitivities.rules.length > 0;

  if (!hasIgnores && !hasSensitivities) {
    return (
      <p className="va-note">
        This build carried no declaration ledger. Either its config named no ignores and no
        sensitivities, or it was recorded before this service kept them — one absence on the wire,
        and neither of them is an audit that came back clean.
      </p>
    );
  }

  return (
    <>
      {hasIgnores ? <Ignores ledger={ignores} /> : null}
      {hasSensitivities ? <Sensitivities ledger={sensitivities} /> : null}
    </>
  );
}

/**
 * Every ignore rule, including — especially — the ones that absorbed nothing.
 *
 * Filtering the quiet rows out would delete the finding. Both counts a rule has
 * are printed because one of them is a denominator: *absorbed nothing in nine
 * compared subjects* is a rule to delete, and *absorbed nothing in nine subjects,
 * none of which was compared* is a rule this run knows nothing about.
 */
function Ignores({ ledger }: { readonly ledger: IgnoreLedger }): ReactElement {
  return (
    <>
      <h3 className="va-ledger-head">
        Ignores <span className="va-note">what each rule absorbed, and what it did not</span>
      </h3>
      <table className="va-region-table va-ledger">
        <tbody>
          {ledger.rules.map((entry) => {
            const state = ignoreState(entry);
            return (
              <tr key={entry.rule} className={isActionable(state) ? 'va-spent' : ''}>
                <td>
                  <code>{entry.rule}</code>
                </td>
                <td>
                  <State state={state} says={ignoreSays(entry, ledger)} />
                </td>
                <td className="va-num-col">
                  {entry.pixels === 0 ? (
                    <span className="va-none">none</span>
                  ) : (
                    `${number(entry.pixels)} px`
                  )}
                </td>
                <td className="va-num-col">
                  <Scope entry={entry} />
                </td>
                <td className="va-ledger-why">{entry.reason}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="va-note">{ignoreTotals(ledger)}</p>
    </>
  );
}

/** The two counts, written so neither can be read as the other. */
function Scope({ entry }: { readonly entry: IgnoreUsage }): ReactElement {
  if (entry.subjects === 0) return <span className="va-none">nowhere</span>;
  return (
    <>
      {number(entry.subjects)} <em>subj</em>
      {entry.comparedIn === entry.subjects ? null : (
        <span className="va-none"> {number(entry.comparedIn)} compared</span>
      )}
    </>
  );
}

/**
 * Every sensitivity, stated in the positive form the operator wrote.
 *
 * *Asserts on layout* is a claim about intent and *decided 38 subjects* is what
 * happened. A table with only the second is a list of things that were hidden;
 * one with only the first is a list of things somebody believes.
 */
function Sensitivities({ ledger }: { readonly ledger: SensitivityLedger }): ReactElement {
  return (
    <>
      <h3 className="va-ledger-head">
        Sensitivities <span className="va-note">what each rule relaxed, and what it did not</span>
      </h3>
      <table className="va-region-table va-ledger">
        <tbody>
          {ledger.rules.map((entry) => {
            const state = sensitivityState(entry);
            return (
              <tr key={entry.rule} className={isActionable(state) ? 'va-spent' : ''}>
                <td>
                  <code>{entry.rule}</code>
                </td>
                <td>
                  <State state={state} says={sensitivitySays(entry)} />
                </td>
                <td>
                  <span className="va-tag">asserts on {entry.level}</span>
                </td>
                <td className="va-num-col">
                  {entry.scoped === 0 ? (
                    <span className="va-none">nowhere</span>
                  ) : (
                    <>
                      {number(entry.absorbed.length)} <em>of</em> {number(entry.scoped)}
                    </>
                  )}
                </td>
                <td className="va-ledger-why">
                  <Bands entry={entry} />
                  {entry.reason}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="va-note">{sensitivityTotals(ledger)}</p>
    </>
  );
}

/**
 * The bands, or the fact that this record does not have them.
 *
 * A rule that decided verdicts with no band kept is not a rule that absorbed
 * nothing — it is a report written before the bands were kept, or a store that
 * dropped them on the way here. Drawing nothing would say the first.
 */
function Bands({ entry }: { readonly entry: SensitivityUsage }): ReactElement | null {
  const found = absorbedBands(entry);
  if (found === undefined) {
    return (
      <span className="va-tag" title="This report did not record which bands were absorbed.">
        bands not recorded
      </span>
    );
  }
  if (found.length === 0) return null;
  return (
    <>
      {found.map((band) => (
        <span key={band} className="va-tag">
          {band}
        </span>
      ))}
    </>
  );
}

/**
 * A rule's state as one word, marked when it is a word somebody has to act on.
 *
 * `untested` deliberately reads quiet. It is the absence of evidence, and a panel
 * that flagged it would ask an operator to act on a run that measured nothing —
 * which is how an audit stops being read.
 */
function State({
  state,
  says,
}: {
  readonly state: Parameters<typeof isActionable>[0];
  readonly says: string;
}): ReactElement {
  return (
    <span className={isActionable(state) ? 'va-tag va-warn' : 'va-tag'} title={says}>
      {state}
    </span>
  );
}
