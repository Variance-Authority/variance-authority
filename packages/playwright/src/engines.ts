import { existsSync } from 'node:fs';
import { type BrowserType, chromium, firefox, webkit } from 'playwright';

/**
 * **Which engines paint, declared rather than discovered.**
 *
 * This file used to be a `filter(existsSync)` spread across four call sites, and
 * that arrangement had one property a visual-regression tool cannot have: the
 * result depended on the machine. A laptop missing WebKit measured two engines
 * and passed; CI missing all three measured nothing and passed. Nobody was told.
 * The suite reported green for a claim it had not checked.
 *
 * So the direction is inverted. {@link DECLARED_ENGINES} is the list, it is in
 * the repository where a diff can see it, and an engine on it whose binary is
 * absent is a **failure that names the engine** — not a skip. A run either
 * measures what was declared or says which install is missing.
 *
 * `VARIANCE_ENGINES` overrides the list for a single run (`chromium,webkit`).
 * It narrows or widens what is asked for; it does not weaken the rule, because
 * whatever it names still has to exist.
 */
export type BrowserEngine = 'chromium' | 'firefox' | 'webkit';

/** Every engine this package can drive, in the order results are reported. */
export const ALL_ENGINES: readonly BrowserEngine[] = ['chromium', 'firefox', 'webkit'];

/**
 * The name-to-driver map, exported because a caller that declares an engine by
 * name has to be able to launch it without re-importing `playwright` and
 * rebuilding the same three-entry record — which is how the two copies of it
 * drifted before this file existed.
 */
export const ENGINE_TYPES: Readonly<Record<BrowserEngine, BrowserType>> = { chromium, firefox, webkit };

/**
 * The engines this repository's cross-engine measurements are asked to run.
 *
 * **Firefox is off the list deliberately**, and the reason is not ours: its
 * Playwright build does not launch on macOS 26/27 — the parent spins at startup
 * and never completes the juggler handshake, identically across four revisions,
 * three install locations and a forced re-download. There is no upstream issue
 * and no local fix. It is suppressed here rather than papered over by discovery,
 * so that the absence is a decision somebody made in a commit instead of a
 * property of whichever machine happened to run the suite.
 *
 * Put `'firefox'` back when a Playwright release launches it; the failure if it
 * still does not is the point.
 */
export const DECLARED_ENGINES: readonly BrowserEngine[] = ['chromium', 'webkit'];

function parse(value: string): readonly BrowserEngine[] {
  const names = value
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (names.length === 0) throw new Error('VARIANCE_ENGINES is set but names no engine.');
  const unknown = names.filter((name) => !ALL_ENGINES.includes(name as BrowserEngine));
  if (unknown.length > 0) {
    throw new Error(`VARIANCE_ENGINES names ${unknown.join(', ')}; known engines are ${ALL_ENGINES.join(', ')}.`);
  }
  return [...new Set(names as BrowserEngine[])];
}

/** What was asked for, before anything checks whether it is installed. */
export function declaredEngines(env: Record<string, string | undefined> = process.env): readonly BrowserEngine[] {
  const override = env.VARIANCE_ENGINES;
  return override === undefined ? DECLARED_ENGINES : parse(override);
}

/**
 * Which of the declared engines this machine has, by asking Playwright where the
 * binary is rather than launching it — milliseconds, not a launch timeout.
 */
export function engineStatus(engines: readonly BrowserEngine[] = declaredEngines()): {
  readonly present: readonly BrowserEngine[];
  readonly missing: readonly BrowserEngine[];
} {
  const present: BrowserEngine[] = [];
  const missing: BrowserEngine[] = [];

  for (const name of engines) {
    let found: boolean;
    try {
      found = existsSync(ENGINE_TYPES[name].executablePath());
    } catch {
      found = false;
    }
    (found ? present : missing).push(name);
  }
  return { present, missing };
}

export function installCommand(engines: readonly BrowserEngine[]): string {
  return `npx playwright install ${engines.join(' ')}`;
}

/**
 * The declared engines, or a throw naming the ones that are not installed.
 *
 * **A machine with none of them is not an error** — that is CI, which installs
 * no browser on purpose (`.github/workflows/check.yml`) and whose callers skip
 * and announce. A machine with *some* of them is the dangerous state and the
 * reason this function exists: under the discovery it replaced, a laptop with
 * two of three engines measured two and reported green, and nothing anywhere
 * said which claim had gone unchecked.
 *
 * So the rule is all or nothing: every declared engine, or a named failure.
 */
export function requireEngines(
  engines: readonly BrowserEngine[] = declaredEngines(),
): readonly BrowserEngine[] {
  const { present, missing } = engineStatus(engines);
  if (missing.length === 0) return engines;
  if (present.length === 0) return [];

  throw new Error(
    `declared engine${missing.length > 1 ? 's' : ''} not installed: ${missing.join(', ')}` +
      ` (this machine has ${present.join(', ')})` +
      `\n  ${installCommand(missing)}` +
      '\n  (the list is DECLARED_ENGINES in packages/playwright/src/engines.ts; VARIANCE_ENGINES overrides it)',
  );
}
