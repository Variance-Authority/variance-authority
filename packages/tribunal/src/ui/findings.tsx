import {
  AGE_WHY,
  AGE_WORDS,
  ageOf,
  arrivalLine,
  byArrival,
  byBand,
  carriedLine,
  methodLine,
  mixedAges,
} from '@variance-authority/report';
import type { FindingRecord } from '@variance-authority/report';
import type { ReactElement } from 'react';
import type { SubjectView } from '../review.js';
import { element, headline, number, sentence } from './text.js';

/**
 * Findings, and the three things a reader has to be told before the list is one.
 *
 * **Whether anything looked.** `[]` means this render was inspected and no defect
 * was found. `undefined` means nothing inspected it. Printing the second as the
 * first tells a reviewer the component is fine on the authority of something that
 * never looked.
 *
 * **What kind of defect these are.** The rows used to arrive under a bare
 * *Findings* as rule ids and clauses, and a reader who did not already know what
 * the inspector checks had to infer the subject of the report from the names of
 * its rules. The band is on the record, so the list is grouped by it and each
 * group is headed with the word — `Accessibility` over the nine rules that are,
 * and not over the two that are not.
 *
 * **Whether it is theirs, and therefore what comes first.** A finding is read
 * from one render with no baseline consulted, so the same list prints on the run
 * that introduced a defect and on every run after it. The panel was silent about
 * which, then it said both in one breath — *42 defects read from this render ·
 * 20 arrived with this change · 22 already in the baseline* — which is a sentence
 * that opens on a number nobody can act on and gives a reviewer twenty-two
 * afternoons of somebody else's work to scroll past on the way to their own. Now
 * the defects this change brought lead the panel at full size, and everything the
 * record does not put on this change is folded behind its count. *Not dated* is
 * its own answer and is never drawn as *arrived with this change*: the reading is
 * [`byArrival`](../../../report/src/findings.ts), shared with the HTML report so
 * the two surfaces say it in the same words and in the same order.
 *
 * Drawn in three registers rather than one line. The report writes a rule id and
 * a clause — and the clause is written to *follow a noun the report never
 * prints*, which is how `label-mismatch reads "SNKR. shop" and is named …` used
 * to reach this page. So the headline is the defect in a person's words, the
 * element the clause was written for comes from `where`, and the id goes last,
 * beside the file, where it belongs: it is the least of the three to a reviewer
 * and the whole of it to an ignore list.
 */
export function Findings({ subject }: { readonly subject: SubjectView }): ReactElement {
  if (subject.findings === undefined) {
    return <p className="va-note">This render was not inspected, so no defect list applies.</p>;
  }
  if (subject.findings.length === 0) {
    return <p className="va-note">Inspected, and nothing to report.</p>;
  }

  const { arrived, rest, dated } = byArrival(subject.findings);
  const carried = carriedLine(subject.findings);

  return (
    <>
      <p className={arrived.length > 0 ? 'va-findings-lead va-findings-mine' : 'va-findings-lead'}>
        {arrivalLine(subject.findings)}
      </p>

      {arrived.length === 0 ? null : <Bands findings={arrived} />}
      {dated ? null : <Bands findings={rest} />}

      {carried === undefined ? null : (
        <details className="va-findings-rest">
          <summary>{carried}</summary>
          <p className="va-note">
            {AGE_WHY[rest.some((each) => ageOf(each) === 'standing') ? 'standing' : 'undated']}
          </p>
          <Bands findings={rest} />
        </details>
      )}

      <p className="va-note va-findings-why">{methodLine(subject.findings)}</p>
    </>
  );
}

/** One list, banded. The same markup whichever side of the fold it is drawn on. */
function Bands({ findings }: { readonly findings: readonly FindingRecord[] }): ReactElement {
  const dated = mixedAges(findings);

  return (
    <>
      {byBand(findings).map((group) => (
        <section key={group.title} className="va-findings-band">
          <h3 className="va-band-head">{group.title}</h3>
          <ul className="va-findings">
            {occurrences(group.findings).map(({ key, finding, times }) => (
              <Row key={key} finding={finding} times={times} dated={dated} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

/**
 * One defect, ruled by its date, and worded only when its neighbours differ.
 *
 * The colour is unconditional: a reviewer scanning a panel of fourteen reads the
 * edge before they read anything, and what they are scanning for is the one that
 * arrived with their change — so *arrived* is the only state that gets the loud
 * edge, and the two that are not a claim about this change share the quiet one.
 *
 * The phrase is not. The list a row sits in is now split by date, so the heading
 * above it already said *arrived with this change* once, and repeating it down
 * fourteen rows is a word a reader stops seeing. `dated` is the one case where
 * the row is carrying the finding instead of echoing the heading: a fold holding
 * both a defect the baseline had and one nothing dated.
 */
function Row({
  finding,
  times,
  dated,
}: {
  readonly finding: FindingRecord;
  readonly times: number;
  /** Whether this list mixes dates, and so whether the row has to name its own. */
  readonly dated: boolean;
}): ReactElement {
  const age = ageOf(finding);

  return (
    <li className={`va-finding va-finding-${age}`}>
      <p className="va-finding-title">
        <span className="va-finding-said">{headline(finding.rule)}</span>
        <span className="va-finding-marks">
          {times > 1 ? <span className="va-times">{number(times)} places</span> : null}
          {dated ? (
            <span className={`va-age va-age-${age}`} title={AGE_WHY[age]}>
              {AGE_WORDS[age]}
            </span>
          ) : null}
        </span>
      </p>
      <p className="va-finding-where">{element(finding.where) ?? finding.path}</p>
      <p className="va-finding-what">{sentence(finding.what)}</p>
      <p className="va-finding-owner">
        {finding.component === undefined ? null : (
          <span className="va-tag">{finding.component}</span>
        )}
        {finding.file === undefined ? null : <code className="va-tag">{finding.file}</code>}
        <span className="va-tag va-rule">{finding.rule}</span>
      </p>
    </li>
  );
}

/** One defect, and the number of times a single render repeats it. */
interface Occurrence {
  readonly key: string;
  readonly finding: FindingRecord;
  times: number;
}

/**
 * One defect, however many times the render draws the component carrying it.
 *
 * A listing page draws the same card twenty times, so a rule that fires on that
 * card fires twenty times, and this panel printed twenty identical blocks: same
 * rule, same element, same line of the same file, differing only in a DOM path
 * no reviewer reads. That is not twenty decisions. It is one defect in `Button`,
 * and the number worth printing is how far it reached.
 *
 * Grouped on everything the entry actually shows, which is all of a finding
 * except its path. Two rows a reader cannot tell apart are one finding; `where`
 * stays in the key, so two genuinely different elements stay two rows, and so
 * does `standing` — a rule that fired on an element the baseline had and on one
 * it did not is the case this panel exists to separate, and folding the two would
 * report the new element under the old one's date. Insertion order is kept,
 * because the report's order is the order of the render.
 */
function occurrences(findings: readonly FindingRecord[]): readonly Occurrence[] {
  const seen = new Map<string, Occurrence>();
  for (const finding of findings) {
    const key = [
      finding.rule,
      finding.component ?? '',
      finding.file ?? '',
      finding.where ?? '',
      finding.what,
      ageOf(finding),
    ].join(' · ');
    const already = seen.get(key);
    if (already === undefined) seen.set(key, { key, finding, times: 1 });
    else already.times += 1;
  }
  return [...seen.values()];
}
