// compass: variance-authority.report.proposal-comment

import { OperatorError } from './exit.js';

/**
 * The config's `project` as one path segment: every UTF-8 byte outside
 * `[A-Za-z0-9_-]` written as `%XX`.
 *
 * One spelling, because three places name a project by it — the comment's
 * marker, the ref its pictures are pushed to, and the report page's artifact —
 * and two spellings of one project would be two names for it. It is safe in
 * each: no slash, so a ref is one segment and cleanup finds it; no dot, so no
 * segment is `..` or starts with one; no space, colon or `>`, so git takes the
 * ref, an artifact name has nothing it refuses, and no project closes the HTML
 * comment early. Distinct projects get distinct segments, because the bytes of
 * distinct well-formed strings differ — which is why a lone surrogate is refused
 * rather than encoded: UTF-8 has no byte for it, and it would be spelled as the
 * replacement character is.
 */
export function projectSegment(project: string): string {
  let encoded: string;
  try {
    encoded = encodeURIComponent(project);
  } catch (error) {
    throw new OperatorError(`project ${JSON.stringify(project)} holds a lone surrogate, which no byte spells apart from another project`, {
      cause: error,
    });
  }
  return encoded.replace(/[.!~*'()]/gu, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}
