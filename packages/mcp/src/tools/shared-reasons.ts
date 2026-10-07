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
 * sentence is read once. Groups keep the place of their first subject.
 */
export function oncePerReason(
  lines: readonly { readonly label: string; readonly subject: string; readonly because: string }[],
): readonly string[] {
  const groups = new Map<string, { label: string; because: string; subjects: string[] }>();
  for (const line of lines) {
    const key = `${line.label}\u0000${line.because}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { label: line.label, because: line.because, subjects: [line.subject] });
    } else {
      group.subjects.push(line.subject);
    }
  }

  return [...groups.values()].flatMap(({ label, because, subjects }) =>
    subjects.length === 1
      ? [`[${label}] ${subjects[0]}: ${because}`]
      : [
          `[${label}] ${subjects.length} subject(s): ${because}`,
          ...subjects.map((subject) => `    ${subject}`),
        ],
  );
}
