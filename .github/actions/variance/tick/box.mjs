// The box `tick-to-accept` puts in the docket, written and read in one place:
// `tick.mjs` reads it, and so does anything that ticks it, such as this
// repository's outer loop. No side effects, so it can be imported.

/** The box line, ticked or not, bound to the run on `head` and the job that wrote it. */
export const BOX = /^- \[( |x|X)\] .*<!-- variance-tick head=([0-9a-f]{40}) job=(\d+) -->[ \t\r]*$/m;

/** The unticked box for the job `job` on `head`. */
export const box = (head, job) => `- [ ] Accept this change <!-- variance-tick head=${head} job=${job} -->`;

/** The box in `body`, or nothing: whether it is ticked, and what it is bound to. */
export function boxIn(body) {
  const found = BOX.exec(body ?? '');
  return found ? { ticked: found[1] !== ' ', head: found[2], job: found[3] } : undefined;
}

/** `body` with its box ticked: the edit a reviewer makes. */
export const ticked = (body) => body.replace(BOX, (line) => line.replace('- [ ]', '- [x]'));
