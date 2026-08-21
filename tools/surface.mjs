#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { countNames, readSurface } from '@variance-authority/package';

/**
 * What this repository offers an adopter, recorded as a baseline.
 *
 * The reading itself is [`@variance-authority/package`](../packages/package) and
 * this is a runner around it — deliberately, because the two things left here are
 * the two things a published package must not know. Where the baseline lives is
 * this repository's business, and so is which checkout to read. A package that
 * hardcoded `tools/surface.baseline.json` would be describing us to somebody
 * else's repository.
 *
 * `yarn surface` prints the value; `--write` records it. `tools/surface.check.ts`
 * is what compares the two, and the rule it enforces is deliberately small:
 * **the surface is what the baseline says it is.** Adding an export is normal and
 * cheap to record; the failure exists so that removing one, renaming one, or
 * closing a subpath is a line in a review rather than something an adopter's
 * build discovers.
 *
 * Reading is from manifests and source, never from `dist` — but this runner
 * reaches the reader through its own `exports`, so `yarn build` has to have run
 * before `yarn surface` does. That is a precondition of the runner, not of the
 * reading: the twenty-five packages it reports on are read whether or not any of
 * them has ever been compiled.
 */

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BASELINE = join(ROOT, 'tools/surface.baseline.json');

export function surface() {
  return readSurface(ROOT);
}

export const countOf = countNames;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const value = surface();
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (process.argv.includes('--write')) {
    writeFileSync(BASELINE, text, 'utf8');
    process.stdout.write(
      `surface: ${countOf(value)} names over ${Object.keys(value).length} packages, recorded\n`,
    );
  } else {
    process.stdout.write(text);
  }
}
