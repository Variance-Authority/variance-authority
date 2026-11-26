/**
 * The runner's clock for a file, put on the rows that reached the record
 * without it.
 *
 * A file the page reported on is timed where its crossings are folded. One that
 * only a head reported on never passes through that fold, so its row would be
 * written with no duration and no start, and everything that reads the record
 * for time — the timeline, the slowest list — would see a file nobody timed.
 */

import type { ObservedSubject } from '@variance-authority/sense/journal';

export function timedSubjects(
  subjects: readonly ObservedSubject[],
  spent: ReadonlyMap<string, number>,
  began: ReadonlyMap<string, number>,
  laned: ReadonlyMap<string, number>,
): readonly ObservedSubject[] {
  return subjects.map((subject) => {
    const duration = spent.get(subject.owner);
    const start = began.get(subject.owner);
    const lane = laned.get(subject.owner);
    if (subject.duration !== undefined || (duration === undefined && start === undefined)) return subject;
    return {
      ...subject,
      ...(duration === undefined ? {} : { duration }),
      ...(start === undefined || subject.start !== undefined ? {} : { start }),
      ...(lane === undefined || subject.start !== undefined ? {} : { lane }),
    };
  });
}
