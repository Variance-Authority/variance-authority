import type { Help } from '@variance-authority/package/help';

/** How many answers one reading keeps per generation: a question's own, and those of the names it follows. */
const KEPT = 64;

/**
 * `read`, answered once per generation for the same arguments. An answer and
 * the look at the files it rests on ask the same things of the same generation,
 * in either order, and `help` is what names that generation: one read again is
 * another value, so nothing kept here outlives it.
 */
export function askedOnce<Args extends readonly (string | undefined)[], Answer>(read: (help: Help, ...args: Args) => Answer): (help: Help, ...args: Args) => Answer {
  const generations = new WeakMap<Help, Map<string, Answer>>();
  return (help, ...args) => {
    const kept = generations.get(help) ?? new Map<string, Answer>();
    generations.set(help, kept);
    const key = JSON.stringify(args);
    if (kept.has(key)) return kept.get(key)!;
    const answer = read(help, ...args);
    if (kept.size >= KEPT) kept.clear();
    kept.set(key, answer);
    return answer;
  };
}
