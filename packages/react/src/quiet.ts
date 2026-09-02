import type { CommitTap } from './commits.js';

export interface QuietResult {
  /** True when the page went `quietFor` milliseconds without a commit. */
  readonly settled: boolean;
  /** How long the page was quiet for when this returned. */
  readonly quietFor: number;
  /** Commits observed while waiting. */
  readonly commits: number;
  /** Components that rendered while waiting, most commits first. */
  readonly restless: readonly { readonly name: string; readonly commits: number }[];
}

export interface QuietOptions {
  /** Milliseconds of silence that count as settled. */
  readonly quietFor?: number;
  /** Give up after this long and report what was still moving. */
  readonly timeout?: number;
  /** Poll interval. The tap is event-driven; this only decides how soon we look. */
  readonly interval?: number;
}

/** Wait until React stops committing, and say what was moving if it does not. */
export async function awaitQuiet(tap: CommitTap, options: QuietOptions = {}): Promise<QuietResult> {
  const quietFor = options.quietFor ?? 100;
  const timeout = options.timeout ?? 2_000;
  const interval = options.interval ?? 16;
  const before = tap.commits().length;
  const deadline = now() + timeout;

  if (!tap.attached) {
    return { settled: false, quietFor: 0, commits: 0, restless: [] };
  }

  for (;;) {
    const quiet = tap.quietFor();
    if (quiet >= quietFor) {
      return { settled: true, quietFor: quiet, ...seenSince(tap, before) };
    }
    if (now() >= deadline) {
      return { settled: false, quietFor: quiet, ...seenSince(tap, before) };
    }
    await sleep(Math.min(interval, Math.max(1, quietFor - quiet)));
  }
}

function seenSince(
  tap: CommitTap,
  before: number,
): { commits: number; restless: readonly { name: string; commits: number }[] } {
  const since = tap.commits().slice(before);
  const counts = new Map<string, number>();
  for (const commit of since) {
    for (const name of commit.components) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const restless = [...counts]
    .map(([name, commits]) => ({ name, commits }))
    .sort(
      (left, right) =>
        right.commits - left.commits ||
        (left.name < right.name ? -1 : left.name > right.name ? 1 : 0),
    );
  return { commits: since.length, restless };
}

function now(): number {
  const clock = globalThis.performance;
  return clock && typeof clock.now === 'function' ? clock.now() : Date.now();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
