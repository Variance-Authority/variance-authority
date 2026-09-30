/**
 * The text primitives a pull-request comment is written out of, shared by the
 * docket's fold and render and by the review.
 *
 * Separate because several writers need them and none owns them: `labelOf` builds
 * a cause's label while folding the report, and every block that prints a subject
 * id or a count uses the same two functions. A copy in each file is how the fold
 * and the render start escaping markdown differently, which is a security
 * property here rather than a cosmetic one — see {@link code}. The docket and the
 * review both post a comment, so both are cut to GitHub's limit the same way —
 * see {@link clampComment}.
 */

/**
 * Text as inline code, with a fence long enough to contain it.
 *
 * Component names and landmark phrases carry content from the page under test —
 * `locate` builds a landmark from accessible names, which are whatever the
 * product renders. Interpolating that into markdown unescaped lets a heading, a
 * list marker, or raw HTML from the page rearrange the docket. Inline code
 * neutralises all of it, and the fence is sized to the longest backtick run in
 * the text so that nothing can close it early.
 *
 * Newlines are folded to spaces, because an inline span cannot contain one.
 * Nothing is removed.
 */
export function code(text: string): string {
  const folded = text.replace(/\r?\n/g, ' ');
  const longest = [...folded.matchAll(/`+/g)].reduce(
    (max, match) => Math.max(max, match[0].length),
    0,
  );
  const fence = '`'.repeat(longest + 1);
  const pad = folded.startsWith('`') || folded.endsWith('`') ? ' ' : '';

  return `${fence}${pad}${folded}${pad}${fence}`;
}

/** `1 subject` / `2 subject(s)`, so a count of one does not read as a template. */
export function count(value: number, noun: string): string {
  return value === 1 ? `1 ${noun}` : `${value} ${noun}(s)`;
}

/**
 * GitHub's limit on an issue-comment body. A longer body is not truncated: the
 * request is rejected, and the comment is not posted at all.
 */
export const COMMENT_CHARACTERS = 65_536;

/**
 * Cut a comment body to `characters`, and say by how much.
 *
 * GitHub does not truncate an over-long comment, it rejects the request — so the
 * real choice is between a body that states what it dropped and no comment at
 * all. The writer supplies the notice, because only the writer knows where the
 * rest of its answer is. The cut keeps the start and drops the end, at a line
 * break: the first line is a marker a workflow finds its own comment by, and a
 * cut that removed it would strand the comment and start duplicating it.
 *
 * A cut inside a code fence or a `<details>` fold would swallow the notice into
 * the fence or hide it in the fold, so both are closed before it. When the
 * closing and the notice do not fit, the cut is made again, shorter.
 */
export function clampComment(body: string, characters: number, notice: (dropped: number) => string): string {
  if (body.length <= characters) return body;
  let room = characters - notice(body.length).length;
  while (room > 0) {
    const cut = body.slice(0, room);
    const lastBreak = cut.lastIndexOf('\n');
    const head = lastBreak > 0 ? cut.slice(0, lastBreak) : cut;
    const clamped = head + closing(head) + notice(body.length - head.length);
    if (clamped.length <= characters) return clamped;
    room = head.length - (clamped.length - characters);
  }
  return notice(body.length).slice(0, characters);
}

/** What closes the code fence and the `<details>` folds a cut body leaves open. */
function closing(head: string): string {
  let fenced = false;
  let open = 0;
  for (const line of head.split('\n')) {
    if (line.trimStart().startsWith('```')) fenced = !fenced;
    else if (!fenced) open += (line.match(/<details>/g)?.length ?? 0) - (line.match(/<\/details>/g)?.length ?? 0);
  }
  return `${fenced ? '\n```' : ''}${'\n\n</details>'.repeat(Math.max(0, open))}`;
}
