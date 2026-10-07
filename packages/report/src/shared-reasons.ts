/**
 * Subjects folded by the label they carry and the reason they share.
 *
 * A reason many subjects share is almost never about any one of them. A first
 * run makes every subject `new` for one sentence, and an upgrade that moves the
 * identity key makes every subject `incomparable` for one; a 4,705-subject run
 * said one sentence 4,697 times. Every reader that lists subjects without a
 * region — the pull-request docket, `variance_summary` — prints it once with
 * the subjects under it, and both fold here so they agree on what "the same
 * reason" is: the same label and the same words. One sentence under two labels
 * stays two groups, since the labels ask for different actions.
 *
 * Groups keep the place of their first subject, and subjects keep their order.
 */
export function byReason<Label extends string>(
  items: Iterable<{ readonly label: Label; readonly because: string; readonly subject: string }>,
): readonly { readonly label: Label; readonly because: string; readonly subjects: readonly string[] }[] {
  const groups = new Map<string, { label: Label; because: string; subjects: string[] }>();
  for (const { label, because, subject } of items) {
    const key = `${label}\u0000${because}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { label, because, subjects: [subject] });
    else group.subjects.push(subject);
  }
  return [...groups.values()];
}
