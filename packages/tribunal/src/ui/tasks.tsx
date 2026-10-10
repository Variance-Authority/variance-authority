/**
 * The tasks at the top of the rail: what a build still asks of its reviewers.
 *
 * The header already said how many renders awaited a decision and how many
 * concerns stood, and neither number led anywhere: finding the three renders
 * with an open concern meant reading every row of the rail. A task names one kind of work,
 * counts the renders it covers, and narrows the subjects rail to them.
 *
 * A task counts renders, not concerns, because a render is what a reviewer
 * opens: two concerns on one render are one thing to look at. And a concern task
 * reaches past the queue — a render this build left unchanged can still carry a
 * concern an earlier build raised, and it is exactly the one a reviewer would
 * otherwise never open.
 */

import type { ReactElement } from 'react';
import type { Concern } from '../concern-types.js';
import type { SubjectView } from '../review-types.js';
import { TASKS, type Task } from './route.js';
import { number } from './text.js';

/** The verdicts a decision settles, as `pending` in `review-summary.ts` counts them. */
const PENDS: ReadonlySet<SubjectView['verdict']> = new Set(['changed', 'new', 'incomparable']);

const NAMES: Readonly<Record<Task, string>> = {
  unreviewed: 'Unreviewed',
  open: 'Open',
  investigating: 'Investigating',
  resolved: 'Resolved',
};

const SAYS: Readonly<Record<Task, string>> = {
  unreviewed: 'Renders awaiting a decision that nobody has made',
  open: 'Renders with a concern that is open',
  investigating: 'Renders with a concern somebody is looking into',
  resolved: 'Renders with a concern that was resolved',
};

/**
 * The renders each task covers, or why a concern task could not be read.
 *
 * `queue` is the rail's own list; `all` is every render the build showed, since
 * a concern can stand on a settled one. *Unreviewed* counts what the header's
 * *awaiting review* counts — an undecided render whose verdict a decision settles
 * — so the two never disagree; an unstable or failed render sits in the rail
 * but waits on a rerun, not a reviewer.
 */
export function tasksOf(
  queue: readonly SubjectView[],
  all: readonly SubjectView[],
  concerns: readonly Concern[] | string | undefined,
): Readonly<Record<Task, readonly SubjectView[] | string | undefined>> {
  const unreviewed = queue.filter((each) => each.decision === null && PENDS.has(each.verdict));
  if (typeof concerns !== 'object') return { unreviewed, open: concerns, investigating: concerns, resolved: concerns };
  const carrying = (state: Concern['state']): readonly SubjectView[] => {
    const on = new Set(concerns.filter((each) => each.state === state).map((each) => each.subject));
    return all.filter((each) => on.has(each.subject));
  };
  return { unreviewed, open: carrying('open'), investigating: carrying('investigating'), resolved: carrying('resolved') };
}

/** The four tasks as buttons with their counts; the chosen one pressed. */
export function Tasks({
  tasks,
  chosen,
  onChoose,
}: {
  readonly tasks: Readonly<Record<Task, readonly SubjectView[] | string | undefined>>;
  readonly chosen: Task | undefined;
  /** Undefined puts the whole queue back. */
  readonly onChoose: (task: Task | undefined) => void;
}): ReactElement {
  return (
    <section className="va-tasks" aria-label="Tasks">
      <h2 className="va-rail-group">Tasks</h2>
      {TASKS.map((task) => {
        const members = tasks[task];
        const known = typeof members === 'object';
        return (
          <button
            key={task}
            type="button"
            className={task === chosen ? 'va-task va-on' : 'va-task'}
            aria-pressed={task === chosen}
            // A task with nothing in it opens nothing; one that could not be read
            // says why rather than offering a count of none. The chosen one can
            // always be put down.
            disabled={task !== chosen && (!known || members.length === 0)}
            title={typeof members === 'string' ? `Concerns could not be read: ${members}` : SAYS[task]}
            onClick={() => onChoose(task === chosen ? undefined : task)}
          >
            {NAMES[task]}
            <span className="va-rail-count va-num">{known ? number(members.length) : members === undefined ? '…' : '?'}</span>
          </button>
        );
      })}
    </section>
  );
}
