/**
 * The rail: every subject worth a decision, grouped by verdict.
 *
 * Apart from [`review.tsx`](./review.tsx) because it is the one control the page
 * is navigated by and it answers a question of its own — *which of these is worth
 * opening* — before any render is fetched. The note under each name is the
 * component the semantic tier blamed and the size of the difference, which is
 * enough to decide without a round trip.
 *
 * What it does not carry is anything green. That is [`settled.tsx`](./settled.js)'s,
 * and the split is the point: a rail that listed a subject an ignore had already
 * decided would put it in a queue, under a header counting what awaits review.
 */

import type { ReactElement } from 'react';
import type { SubjectView } from '../review-types.js';
import { causeOf } from './lead.js';
import { briefly, count } from './text.js';

/**
 * Every subject worth a decision, grouped by verdict and readable at a glance.
 *
 * The rail exists so that choosing what to look at costs a glance rather than a
 * scroll: the note under each name is the component the tier blamed and the size
 * of the difference, which is enough to decide whether this one needs opening at
 * all. Sorted largest-first inside each group, for the same reason the docket is.
 */
export function SubjectRail({
  subjects,
  causes,
  variations,
  selected,
  onSelect,
}: {
  readonly subjects: readonly SubjectView[];
  readonly causes: number;
  readonly variations: number;
  readonly selected: string | null;
  readonly onSelect: (subject: string | null) => void;
}): ReactElement {
  const groups = [...new Set(subjects.map((subject) => subject.verdict))];

  return (
    <nav className="va-rail va-scroll">
      <button
        type="button"
        className={selected === null ? 'va-rail-item va-current' : 'va-rail-item'}
        onClick={() => onSelect(null)}
      >
        <span className="va-rail-body">
          <span className="va-rail-name">The docket</span>
          <span className="va-rail-note">
            {count(causes, 'cause')} · {count(variations, 'variation')}
          </span>
        </span>
      </button>

      {groups.map((verdict) => {
        const rows = subjects
          .filter((each) => each.verdict === verdict)
          .sort((left, right) => right.changedPixels - left.changedPixels);

        return (
          <section key={verdict}>
            <h2 className="va-rail-group">
              {verdict}
              <span className="va-rail-count va-num">{rows.length}</span>
            </h2>
            <ul>
              {rows.map((subject) => (
                <li key={subject.subject}>
                  <button
                    type="button"
                    className={
                      subject.subject === selected ? 'va-rail-item va-current' : 'va-rail-item'
                    }
                    onClick={() => onSelect(subject.subject)}
                  >
                    <span className={`va-dot va-${subject.verdict}`} />
                    <span className="va-rail-body">
                      <span className="va-rail-name">{subject.subject}</span>
                      <span className="va-rail-note">
                        {causeOf(subject) ?? 'no component named'}
                        {subject.changedPixels > 0 ? ` · ${briefly(subject)}` : ''}
                      </span>
                    </span>
                    {subject.decision === null ? null : (
                      <span className={`va-mark va-${subject.decision.decision}`}>
                        {subject.decision.decision === 'approved' ? '✓' : '✗'}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </nav>
  );
}
