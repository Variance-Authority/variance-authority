import type { CommentOptions } from './comment.js';
import type { Docket } from './docket.js';
import { code, count } from './comment-text.js';
import type { Pictures } from './comment-images.js';

/**
 * The comment's first screen: the heading, the first thing to look at, and where
 * to go after looking.
 *
 * Separate from `comment-blocks.ts` because this is the part read on a phone in
 * eight seconds, and every other block is either under the fold or qualifies it.
 */

/**
 * What a reviewer reads before deciding whether to open anything: the count, the
 * leading cause, and where to go.
 *
 * Kept to lines a phone shows without scrolling, because that is where a
 * pull-request notification is opened. Everything that qualifies the count —
 * every cause, the collateral, what was skipped, what painted the images — is in
 * the fold under it, and stays there rather than being dropped: a reviewer who
 * wants the whole docket opens one element.
 */
export function leadBlocks(
  docket: Docket,
  options: CommentOptions,
  pictures: Pictures,
): readonly string[] {
  const needing = docket.reviewable + docket.failed.length;
  // NEW is said apart from review, because it is a different reason to open the
  // comment: nothing moved, and nobody has yet said what the subject should look like.
  const fresh = docket.fresh === 0 ? '' : `${docket.fresh} subject(s) NEW`;
  // Unstable is said apart from review too: nothing this change did moved it, and
  // nothing a reviewer decides about it settles it.
  const unstable =
    docket.unstable.length === 0 ? '' : `${docket.unstable.length} subject(s) unstable`;
  const besides = [unstable, fresh].filter((part) => part !== '');

  const heading =
    needing > 0
      ? `## Visual variance — ${[`${needing} subject(s) need review`, ...besides].join(', ')}`
      : besides.length > 0
        ? `## Visual variance — ${besides.join(', ')}${unstable === '' ? ', nothing to review' : ''}`
        : // Reachable, and the only way to reach it is the case worth naming: a run
          // whose observations are all `unchanged` and whose report never stated
          // what it skipped. `exitFor` calls that review, and a heading claiming
          // zero findings over it would be the tool inventing the reassurance.
          '## Visual variance — this run cannot claim a clean result';

  const [first] = docket.causes;
  const picture =
    first !== undefined && first.namedIn > 0 && first.subjects[0] !== undefined
      ? pictures(first.subjects[0])
      : undefined;

  return [
    heading,
    ...leadLine(docket),
    ...(picture === undefined ? [] : [picture]),
    ...footerBlocks(options, docket.promotable > 0),
  ];
}

/**
 * The first cause, in the voice the docket gives it, or the first reason nothing
 * could be compared.
 *
 * An entry the semantic tier did not name is left out rather than printed here:
 * "the largest region" is a size, and a size on the first line reads as a cause.
 */
function leadLine(docket: Docket): readonly string[] {
  const [first] = docket.causes;
  if (first !== undefined && first.namedIn > 0) {
    const label = first.named ? code(first.label) : first.label;
    const at = first.files[0] === undefined ? '' : ` at ${code(first.files[0])}`;
    const more =
      docket.causes.length > 1 ? `, and ${count(docket.causes.length - 1, 'more cause')}` : '';
    return [`Cause: **${label}**${at}${more}`];
  }
  const [group] = docket.withoutCause;
  if (group !== undefined) {
    return [`**${group.verdict}** — ${count(group.subjects.length, 'subject')}: ${group.because}`];
  }
  return [];
}

/**
 * Where to look, and what to do after looking.
 *
 * The command line is the fallback for a comment with no report to link: it
 * reads a report on disk, which a reviewer on a pull request does not have.
 * How to accept is left out when `accept` would promote nothing: a step that
 * would be refused is not one to offer.
 */
function footerBlocks(options: CommentOptions, promotes: boolean): readonly string[] {
  return [
    [
      options.runUrl === undefined
        ? 'Per subject: `variance report --subject <id>`'
        : `[Full report and images](${options.runUrl})`,
      ...(options.toAccept === undefined || !promotes ? [] : [`To accept: ${options.toAccept}`]),
    ].join('  \n'),
  ];
}
