import { projectSegment } from '../project-segment.js';
import { docketTitle } from './comment-lead.js';

/**
 * The HTML comment the poster finds this project's comment by: invisible once
 * rendered, and keyed by `project`, so two gates on one pull request each find
 * their own. `projectSegment` spells the project, as carry does, so none closes
 * the comment early, and the space before `-->` keeps one marker from prefixing
 * another. Versioned: an incompatible format starts a new comment. `v1` carried
 * no project, and the poster takes a `v1` comment over when told to.
 */
export function commentMarker(project: string): string {
  return `<!-- variance-authority: pr-docket v2 project=${projectSegment(project)} -->`;
}

/**
 * What replaces a docket once a later run finds nothing to review.
 *
 * Replaced rather than deleted: one comment per marker stays, and deleting it
 * would leave the check's history with a gap nobody can account for. Printed
 * apart from the render, which stays empty on a clean run, because that empty
 * body is how a poster knows to write nothing on a pull request it never touched.
 */
export function clearedComment(project: string): string {
  return [
    commentMarker(project),
    '',
    `${docketTitle(project)} — nothing to review`,
    '',
    'A later run found nothing to review.',
  ].join('\n');
}
