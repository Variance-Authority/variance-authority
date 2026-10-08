import { byReason } from '@variance-authority/report';

/**
 * One line per subject, except where subjects share a reason: then the reason
 * once, with a count, and the subjects named under it.
 *
 * A reason many subjects share is almost never about any one of them. An
 * upgrade that moves the identity key makes every subject `incomparable` for
 * one reason, and a first run makes every subject `new` for one; printed per
 * subject, a 4,705-subject run said one sentence 4,697 times, and its remedy
 * was in each copy and in none of the first lines. Every subject is still named
 * — a count alone leaves an agent unable to act on any one of them — but the
 * sentence is read once. The fold is `byReason`, shared with the
 * pull-request docket; the lines are this answer's.
 */
export function oncePerReason(
  lines: readonly { readonly label: string; readonly subject: string; readonly because: string }[],
): readonly string[] {
  return byReason(lines).flatMap(({ label, because, subjects }) =>
    subjects.length === 1
      ? [`[${label}] ${subjects[0]}: ${because}`]
      : [
          `[${label}] ${subjects.length} subjects: ${because}`,
          ...subjects.map((subject) => `    ${subject}`),
        ],
  );
}
