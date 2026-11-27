// compass: variance-authority.reach
/**
 * The line's answer that it gave no record, kept beside `fetched.json` so the
 * next reader within `MISS_STANDS_MS` in `mainline-base.ts` does not ask again.
 */

import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MainlineMiss } from './mainline-entry.js';

/** Where a checkout notes that the line was asked and gave no record, beside `fetched.json`. */
export const MISSED = 'missed.json';

/** The line's answer that it gave no record: which mainline, when, and why. */
export interface MissedMainline {
  /** Absent only from a handed answer, when the job that read it could name none. */
  readonly mainline?: string;
  /** When the line was asked, as an ISO time. */
  readonly at: string;
  readonly miss: MainlineMiss;
  readonly holds?: readonly string[];
  /** Laid by `carry receive`: the run's answer, which stands past `MISS_STANDS_MS` in `mainline-base.ts` as a handed record stands past the merge base. */
  readonly handed?: true;
}

/** What a kept answer says to a reader. */
export function missedAs(noted: MissedMainline): Pick<MissedMainline, 'mainline' | 'miss' | 'holds'> {
  return { ...(noted.mainline === undefined ? {} : { mainline: noted.mainline }), miss: noted.miss, ...(noted.holds === undefined ? {} : { holds: noted.holds }) };
}

/**
 * The line's answer that it gave no record, as `readRoot` keeps it, or
 * `undefined` when it keeps none that reads.
 */
export function readMissedMainline(readRoot: string): MissedMainline | undefined {
  let value: Partial<MissedMainline>;
  try {
    value = JSON.parse(readFileSync(join(readRoot, MISSED), 'utf8')) as Partial<MissedMainline>;
  } catch {
    return undefined;
  }
  const miss = value.miss as { kind?: unknown; detail?: unknown } | undefined;
  const reads = typeof miss?.kind === 'string' && (miss.detail === undefined || typeof miss.detail === 'string');
  if ((value.mainline !== undefined && typeof value.mainline !== 'string') || typeof value.at !== 'string' || Number.isNaN(Date.parse(value.at)) || !reads) return undefined;
  const holds = Array.isArray(value.holds) && value.holds.every((name) => typeof name === 'string') ? value.holds : undefined;
  return {
    ...(value.mainline === undefined ? {} : { mainline: value.mainline }),
    at: value.at,
    miss: value.miss as MainlineMiss,
    ...(holds === undefined ? {} : { holds }),
    ...(value.handed === true ? { handed: true } : {}),
  };
}

/** Keep the line's answer that it gave no record under `readRoot`, where {@link readMissedMainline} reads it. */
export async function writeMissedMainline(readRoot: string, missed: MissedMainline): Promise<void> {
  await mkdir(readRoot, { recursive: true });
  await writeFile(join(readRoot, MISSED), `${JSON.stringify(missed)}\n`);
}

/** Best effort: a cache that cannot hold the note costs the next reader one more ask, and nothing else. */
export async function noteMissed(readRoot: string, missed: MissedMainline): Promise<void> {
  try {
    await writeMissedMainline(readRoot, missed);
  } catch {
    // Nothing to do: see above.
  }
}
