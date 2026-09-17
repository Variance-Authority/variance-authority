import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Where the shipped skill is, said to whoever just hit a refusal.
 *
 * Most readers of this CLI are agents, and an agent that has just been told
 * `--subject` is missing knows one thing: the flag it typed was wrong. What it
 * does not know is that the same package ships a document naming which question
 * to ask first, what each one needs before it can answer, and which of them are
 * about a run that has already finished. That document is already on the disk it
 * is standing on — installed with the command it just ran — and nothing says so.
 *
 * So every refusal ends with the path to it. One line, and a path rather than a
 * name: an agent can read a path, and the alternative is a name it would have to
 * go looking for in a directory nobody told it about.
 *
 * Not printed after a defect. A stack trace is a bug report, and routing
 * somebody to usage material for it would be answering the wrong question.
 */

/** The skill's own name, as an agent host registers it. */
export const SKILL_NAME = 'variance-authority';

/**
 * The shipped `SKILL.md`, or nothing.
 *
 * Beside this module's directory in both arrangements that exist: `dist/` in an
 * installed package, `src/` in this repository. Checked rather than assumed,
 * because a consumer is free to publish a subset of files and a path printed for
 * a file that is not there is worse than no line at all.
 */
export function skillPath(): string | undefined {
  const at = fileURLToPath(new URL('../skill/SKILL.md', import.meta.url));
  return existsSync(at) ? at : undefined;
}

/**
 * The line that follows a refusal, or nothing when the skill was not installed.
 *
 * Leading newline so the refusal keeps its own paragraph: what went wrong is the
 * message, and this is a second thing to do about it.
 */
export function skillLine(): string {
  const at = skillPath();
  if (at === undefined) return '';
  return (
    `\nWhich question answers what, and what each one needs before it can answer, ` +
    `is in the \`${SKILL_NAME}\` skill at ${at}\n`
  );
}
