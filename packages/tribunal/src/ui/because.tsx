/**
 * The run's own answer to *why did this move*, printed where the decision is made.
 *
 * Every other sentence on the change page is the page reasoning about records.
 * This one is not: the run wrote it, from four things this surface never
 * receives — the diff, the source index that maps a component to the file
 * declaring it, the props digest each rendering was grouped under, and the
 * subjects where the same component with the same props held still. It reached a
 * conclusion and put it in one sentence per movement, and until the store carried
 * those, the page answered the question by climbing the census on its own and
 * arriving somewhere weaker.
 *
 * ## The sentence is the report's, not a second one
 *
 * `because` is written once, in the attribution ladder, and shipped to the
 * terminal and to here. What differs is the rendering: the ladder marks the names
 * it is claiming things about with backticks, and this turns those into `code`
 * rather than reprinting the punctuation. A second sentence written for the web
 * is a second thing that can disagree with the first, and the disagreement would
 * be between a reviewer's screen and their CI log.
 *
 * ## What the link is for
 *
 * On the `upstream` rung the sentence names a component the commit edited, and
 * that component is usually a change on this same docket. *This moved on what
 * `ProductCard` gave it* is only half an instruction; the other half is that
 * `ProductCard` is where the decision belongs, and it is one click away.
 */

import type { ReactElement } from 'react';
import type { MovementView } from '../review-types.js';
import type { Origin } from './grouping.js';
import type { Route } from './route.js';
import { Go } from './shell.js';
import { count, number } from './text.js';

export function Because({
  origin,
  build,
  changes,
  go,
}: {
  readonly origin: Origin;
  readonly build: string;
  /** Components with a change page of their own, so a link goes somewhere. */
  readonly changes: ReadonlySet<string>;
  readonly go: (route: Route) => void;
}): ReactElement | null {
  const recorded = origin.appearances.flatMap(({ movement }) => movement ?? []);
  if (recorded.length === 0) return null;

  return (
    <>
      {reasons(recorded).map(({ movement, renders }) => (
        <p key={movement.because} className={`va-attributed va-attributed-${movement.cause}`}>
          <Sentence movement={movement} build={build} changes={changes} go={go} />
          {renders === origin.appearances.length ? null : (
            <span className="va-note">
              {' '}
              — in {count(renders, 'render')} of {number(origin.appearances.length)}.
            </span>
          )}
        </p>
      ))}
    </>
  );
}

/**
 * The distinct answers, widest first.
 *
 * Usually one. When it is not, the reason is worth the second paragraph: the same
 * `Button` is `edited` on the page whose file the diff names and `upstream` on the
 * page where a changed parent hands it a different label, and a page that printed
 * only the first would be telling a reviewer they edited a render they did not.
 */
function reasons(
  movements: readonly MovementView[],
): readonly { movement: MovementView; renders: number }[] {
  const found = new Map<string, { movement: MovementView; renders: number }>();
  for (const movement of movements) {
    const seen = found.get(movement.because);
    if (seen === undefined) found.set(movement.because, { movement, renders: 1 });
    else seen.renders += 1;
  }
  return [...found.values()].sort((left, right) => right.renders - left.renders);
}

function Sentence({
  movement,
  build,
  changes,
  go,
}: {
  readonly movement: MovementView;
  readonly build: string;
  readonly changes: ReadonlySet<string>;
  readonly go: (route: Route) => void;
}): ReactElement {
  const upstream = movement.upstream;
  const linked = upstream !== undefined && changes.has(upstream);

  return (
    <>
      <Marked say={movement.because} />
      {movement.standing === undefined ? null : (
        <span className={movement.standing === 'flake' ? ' va-mark va-alarm' : ' va-mark va-note'}>
          {movement.standing === 'flake'
            ? 'this render already failed to read the same way twice'
            : 'nobody has read this render twice yet'}
        </span>
      )}
      {linked ? (
        <>
          {' '}
          <Go
            to={{ page: 'change', build, change: upstream }}
            go={go}
            className="va-attributed-go"
            title={`The decision belongs to ${upstream}, which is a change on this build`}
          >
            Decide it under {upstream}
          </Go>
        </>
      ) : null}
    </>
  );
}

/**
 * One sentence, with the names it claims things about drawn as code.
 *
 * The ladder writes them between backticks because it is also written for a
 * terminal. Splitting on the pair rather than parsing anything: the sentences are
 * this repository's own, an unbalanced backtick in one is a defect in the
 * sentence, and the failure mode here — a stray backtick surviving into the
 * output — is visible in the place it would be introduced.
 */
export function Marked({ say }: { readonly say: string }): ReactElement {
  // Keyed by position, which is the identity: the list is one sentence cut into
  // its own pieces, and it is rebuilt whole or not at all.
  return (
    <>
      {say
        .split('`')
        .map((part, index) =>
          index % 2 === 0 ? <span key={index}>{part}</span> : <code key={index}>{part}</code>,
        )}
    </>
  );
}
