import { EXIT_CLEAN, exitFor } from '../exit.js';
import type { CliRunReport } from './run.js';
import { docketOf } from './docket.js';
import {
  bulkBlocks,
  causeBlocks,
  coverageBlocks,
  driftBlocks,
  foldBlocks,
  leadBlocks,
  metaBlocks,
  skippedBlocks,
  warningBlocks,
  withoutCauseBlocks,
} from './comment-blocks.js';
import { picturesOf } from './comment-images.js';

/**
 * The run report as a pull-request comment — the docket, put where acting on it
 * is cheap.
 *
 * A report written to a file that nobody opens has the value of no report, so the
 * finding has to travel to the review. What travels is not the report: a comment
 * is read in eight seconds by somebody who came to merge, and every line spent on
 * something they cannot act on is a line spent making them stop reading.
 *
 * Four decisions follow from that, and each of them is a refusal.
 *
 * **The comment leads with causes and counts collateral.** A token change that
 * reaches three hundred subjects is *one* review item with the number 300 next to
 * it, never three hundred lines. This is the same argument `rankRegions` makes at
 * the region level and it is worth restating, because the failure it prevents is
 * the one that kills these tools: area measures displacement, not cause, so a
 * report ordered by how much moved leads with whatever the edit pushed around and
 * buries the edit. Scaled to a suite, ordering by *incidence* does the same thing
 * — the 300 collateral subjects outnumber the one changed component 300:1 and win
 * every list they are allowed into. So collateral is counted here and listed
 * nowhere, and the count is what makes the omission legible: "612 further regions
 * moved with these changes" is a fact a reviewer can size, while their absence
 * without a number would be indistinguishable from their non-existence.
 *
 * The first screen is the count, the leading cause, the report link and how to
 * accept, and after them only what changes how that count reads: a warning that
 * the images are of a substituted font, a token's drift, and the subjects the run
 * could not observe. Drift is there because it is the one finding no reviewer of
 * this pull request could have reached without it: a *sum* across approvals,
 * invisible to the comparison they are looking at and actionable only by the
 * person about to approve the next step. See {@link driftBlocks}. The docket
 * itself — every cause, the bulk commands, what was skipped, what painted the
 * images — sits whole under one `<details>`, because a phone is where the
 * notification is opened and the docket is what a reviewer opens on purpose.
 *
 * **The comment exists exactly when the check is red, and one function decides
 * both.** {@link exitFor} owns the question. A second rule here — say, "comment
 * when something changed" — would drift from it on the cases that matter most:
 * a run where every subject failed to render changes nothing and must still be
 * reviewed, and a report that never stated what it skipped cannot support the
 * sentence "nothing needs review". Either drift direction is fatal in the same
 * way: a red check with no comment sends a reviewer to the log to find out why,
 * and a comment with a green check teaches them the comment is advisory.
 *
 * **The marker is in the body.** The poster finds its own previous comment by
 * searching for {@link COMMENT_MARKER} and rewrites that one, because a new
 * comment per run buries the current state under a history nobody reads. Matching
 * on the *body* rather than on the author is what makes this work under any
 * token — a GITHUB_TOKEN posts as `github-actions[bot]`, a PAT posts as a person,
 * and a rule keyed on either one silently starts duplicating when the operator
 * changes the credential. The cost is stated in `post-comment.mjs`: anyone able
 * to comment on the PR can write the marker into a comment of their own and have
 * this action adopt it.
 *
 * **Nothing is capped silently.** Every list has a limit, because a comment
 * GitHub refuses to render is a comment nobody reads, and every limit states what
 * it hid and how much of it there was. A truncated list that does not say it was
 * truncated reads as complete coverage, which is the failure this whole system
 * exists to avoid — reproduced, this time, in the one artifact a human actually
 * looks at. The limits are declared here and enforced in `comment-blocks.ts`.
 *
 * ## Pure, and deliberately so
 *
 * Report in, string out. No network, no octokit, no clock, no filesystem — and no
 * runtime import beyond `../exit.js` and the siblings this file was cut into,
 * none of which import anything either. That is not tidiness: it is what lets the
 * composite action render the body in a Node process that never loads a browser
 * driver, and what lets every claim above be a unit test over a hand-built report
 * instead of a job on a real pull request.
 *
 * ## The four files
 *
 * `docket.ts` folds the report into review items and counts what it
 * refuses to list; `comment-blocks.ts` turns that docket into markdown;
 * `comment-images.ts` spells the address of a picture the operator published;
 * `comment-text.ts` holds the two primitives both of them write through, so the
 * fold and the render can never escape a component name differently. This file
 * keeps the one decision the other two must not be allowed to make — whether a
 * comment exists at all.
 */

/**
 * The string the poster searches for, and the reason it may never change
 * casually.
 *
 * An HTML comment, so it is invisible in the rendered body and survives a round
 * trip through GitHub's markdown. Versioned, because the day this format changes
 * incompatibly the honest move is to leave the old comment where it is and start
 * a new one rather than rewrite a body whose shape the new renderer never
 * produced — but note what that costs: every open pull request then carries two
 * dockets, and the stale one has no way to say it is stale.
 */
export const COMMENT_MARKER = '<!-- variance-authority: pr-docket v1 -->';

/**
 * Where each list stops, and therefore where the comment starts saying so.
 *
 * `characters` is GitHub's own limit on an issue-comment body. Exceeding it does
 * not truncate the comment, it rejects the request — so the choice is between
 * cutting the body here with a statement of what was cut, and delivering nothing
 * at all. The other three are judgement: past roughly twenty docket entries a
 * reviewer is scrolling, and a docket nobody reaches the end of is the unreadable
 * output this format exists to replace.
 */
export interface CommentLimits {
  /** Docket entries listed before the rest are counted. */
  readonly causes: number;
  /** Subject ids named inside one entry before the rest are counted. */
  readonly subjects: number;
  /** Unobserved subjects listed before the rest are counted. */
  readonly notObserved: number;
  /** Drifted tokens listed before the rest are counted. */
  readonly drift: number;
  /** Hard ceiling on the body, including the marker and the notice. */
  readonly characters: number;
}

export const DEFAULT_LIMITS: CommentLimits = {
  causes: 20,
  subjects: 3,
  notObserved: 20,
  drift: 10,
  characters: 65_536,
};

export interface CommentOptions {
  readonly report: CliRunReport;
  /**
   * Where the full report and the images went.
   *
   * Printed when supplied, and the reason it matters is the counting: this
   * comment deliberately does not list collateral, so the reader needs somewhere
   * to go when the counted thing turns out to be the interesting one. Optional
   * because nothing here uploads anything — whether an artifact exists at all is
   * the operator's decision, made in their workflow, and inventing a link to a
   * place nobody published to would be worse than omitting it.
   */
  readonly runUrl?: string;
  /**
   * How a reviewer accepts what the comment lists, in the operator's words.
   *
   * The comment is where the reviewer is when they decide, and accepting is the
   * one step it cannot take for them. Where that step lives — a workflow to
   * dispatch, a label, a command on a checkout — is this repository's policy, so
   * the operator states it and nothing here guesses.
   */
  readonly toAccept?: string;
  /**
   * The URL the report's image paths resolve against, when the operator
   * published the images somewhere a comment can show them.
   *
   * Absent, the comment carries no picture, because a comment cannot hold an
   * image of its own and a link to a file nobody published is broken. Where
   * they go — a branch, a bucket, a CDN — is the operator's, like the report link.
   */
  readonly imageRoot?: string;
  readonly limits?: Partial<CommentLimits>;
}

/**
 * The comment body, or the empty string when there is nothing to review.
 *
 * Empty rather than a cheerful "no visual changes". A bot that comments on every
 * green pull request trains the team to filter it out, and the filter does not
 * distinguish the green ones from the red ones.
 */
export function renderComment(options: CommentOptions): string {
  const { report } = options;

  // The single decision point. See the note above: the comment's existence and
  // the check's colour are the same question, asked once.
  if (exitFor(report) === EXIT_CLEAN) return '';

  const limits: CommentLimits = { ...DEFAULT_LIMITS, ...options.limits };
  const docket = docketOf(report);
  const pictures = picturesOf(report, options.imageRoot);

  const blocks = [
    COMMENT_MARKER,
    ...leadBlocks(docket, options, pictures),
    ...warningBlocks(report, docket),
    ...driftBlocks(report, limits),
    ...coverageBlocks(report, docket, limits),
    ...foldBlocks([
      ...causeBlocks(docket, limits, pictures),
      ...bulkBlocks(report, limits),
      ...withoutCauseBlocks(docket, limits),
      ...skippedBlocks(docket),
      ...metaBlocks(report),
    ]),
  ];

  return clamp(blocks.join('\n\n'), limits.characters);
}

/**
 * Cut the body to fit, and say by how much.
 *
 * GitHub does not truncate an over-long comment, it rejects the request — so the
 * real choice is between a body that states what it dropped and no comment at
 * all. The marker is the first line, so head-truncation always leaves the poster
 * able to find and update this comment on the next run; a tail-truncating
 * implementation would strand it and start duplicating.
 *
 * The room reserved for the notice is computed against the largest number it
 * could ever state, so the notice can only get shorter than the space kept for
 * it. Slightly wasteful and provably safe, which is the correct trade for a
 * length check whose failure mode is a rejected API call nobody sees.
 */
function clamp(body: string, characters: number): string {
  if (body.length <= characters) return body;

  const notice = (dropped: number): string =>
    `\n\n> ${dropped} character(s) of this docket are not shown: the body exceeded the ` +
    `${characters}-character comment limit. Nothing was dropped from the run report itself.`;

  const room = Math.max(0, characters - notice(body.length).length);
  const cut = body.slice(0, room);
  const lastBreak = cut.lastIndexOf('\n');
  const head = lastBreak > 0 ? cut.slice(0, lastBreak) : cut;

  return head + notice(body.length - head.length);
}
