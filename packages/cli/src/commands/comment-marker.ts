import { projectSegment } from '../project-segment.js';
import { docketTitle } from './comment-lead.js';

/**
 * The string the poster searches for to find this project's comment, and the
 * reason it may never change casually.
 *
 * An HTML comment, so it is invisible in the rendered body and survives a round
 * trip through GitHub's markdown. Keyed by the config's `project`, because a
 * repository running two gates runs two posters on one pull request, and each
 * has to find its own comment and leave the other's alone. The project is
 * spelled by `projectSegment`, as carry spells it for the ref the pictures go
 * to, so no project can close the HTML comment early, and the space before
 * `-->` ends it, so no project's marker is a prefix of another's: `storybook`
 * does not find `storybook-case`.
 *
 * Versioned, because the day this format changes incompatibly the honest move
 * is to start a new comment rather than rewrite a body whose shape the new
 * renderer never produced. `v1` carried no project. The poster takes a `v1`
 * comment over when told to, and the action tells it to unless the job says it
 * never wrote one, so an open pull request keeps one comment through the
 * upgrade.
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
