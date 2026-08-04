import { readFileSync } from 'node:fs';
import type { Expectation, Handed, Told } from './scenarios.js';

/**
 * The incumbent's report, read rather than reproduced.
 *
 * The whole adapter between `playwright test --reporter=json` and this case's
 * vocabulary, and the only place that touches their output. It lives beside the
 * head-to-head rather than inside it because it is not a test, and because the
 * distinction it draws is the one the case rests on: their arm ran in its own
 * process, under its own runner, with its own comparator and thresholds
 * (`scripts/incumbent.mjs`), and what is read here is the report that run wrote.
 * Nothing in this file models what they do — a comparison against our
 * reimplementation of a competitor measures our reimplementation.
 */

interface JsonSuite {
  readonly specs?: readonly {
    readonly title: string;
    readonly tests?: readonly {
      readonly projectName: string;
      readonly status: string;
      readonly results?: readonly { readonly error?: { readonly message?: string } }[];
    }[];
  }[];
  readonly suites?: readonly JsonSuite[];
}

export interface IncumbentResult extends Expectation {
  /** Their sentence, stripped of terminal colour. What a reviewer actually sees. */
  readonly says: string;
  /** Differing pixels, when their message carried a count. */
  readonly pixels: number | null;
  /** The two dimensions, when their message named them. */
  readonly resized: string | null;
}

/**
 * Their outcome, in our vocabulary.
 *
 * Classified from the message rather than from the exit status, because a status
 * cannot distinguish the three things a red `toHaveScreenshot` means: pixels
 * differ, the sizes differ, or there was no baseline. Only the last is not a
 * finding, and reading it as one is the failure this project refuses everywhere
 * else — `absent is not empty`.
 */
function classify(status: string, says: string): { told: Told; handed: Handed } {
  if (status === 'expected') return { told: 'silent', handed: 'nothing' };
  if (/snapshot doesn't exist/i.test(says)) return { told: 'deferred', handed: 'no baseline' };
  return { told: 'told', handed: 'a number' };
}

/**
 * Their whole run, keyed `configuration/scenario`.
 *
 * That key is the join between the two arms, and it is built from the project
 * name their runner recorded rather than from anything declared here: a row we
 * cannot find under it is a row the incumbent did not run, which the case
 * reports as a missing result instead of silently scoring it as agreement.
 */
export function readIncumbent(file: string): ReadonlyMap<string, IncumbentResult> {
  const report = JSON.parse(readFileSync(file, 'utf8')) as { readonly suites: readonly JsonSuite[] };
  const found = new Map<string, IncumbentResult>();

  const walk = (suite: JsonSuite): void => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const says = (test.results?.[0]?.error?.message ?? '')
          // eslint-disable-next-line no-control-regex -- the JSON reporter keeps ANSI
          .replace(/\[[0-9;]*m/g, '')
          .trim();

        const pixels = /(\d+) pixels \(ratio/.exec(says);
        const resized = /Expected an image (\d+px by \d+px), received (\d+px by \d+px)/.exec(says);

        found.set(`${test.projectName}/${spec.title}`, {
          ...classify(test.status, says),
          says,
          pixels: pixels === null ? null : Number(pixels[1]),
          resized: resized === null ? null : `${resized[1]} → ${resized[2]}`,
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites) walk(suite);

  return found;
}
