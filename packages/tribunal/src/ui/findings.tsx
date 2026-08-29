import type { FindingRecord } from '@variance-authority/report';
import type { ReactElement } from 'react';
import type { SubjectView } from '../review.js';
import { element, headline, number, sentence } from './text.js';

/**
 * Findings, and the difference between clean and unexamined.
 *
 * `[]` means this render was inspected and no defect was found. `undefined` means
 * nothing inspected it. Printing the second as the first tells a reviewer the
 * component is fine on the authority of something that never looked.
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

  return (
    <ul className="va-findings">
      {occurrences(subject.findings).map(({ key, finding, times }) => (
        <li key={key} className="va-finding">
          <p className="va-finding-title">
            {headline(finding.rule)}
            {times > 1 ? <span className="va-times">{number(times)} places</span> : null}
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
      ))}
    </ul>
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
 * stays in the key, so two genuinely different elements stay two rows. Insertion
 * order is kept, because the report's order is the order of the render.
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
    ].join(' · ');
    const already = seen.get(key);
    if (already === undefined) seen.set(key, { key, finding, times: 1 });
    else already.times += 1;
  }
  return [...seen.values()];
}
