#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readHelp, undocumented } from '@variance-authority/package/help';

/**
 * The names another package imports and which say nothing about themselves.
 *
 * A ratchet, not a rule. Every export documented is not the goal and never was:
 * a name nothing outside its own package imports is documented by its call
 * sites, and demanding a paragraph for it produces paragraphs nobody reads.
 * What earns one is an audience — and *this name is imported by fifteen packages
 * and is silent* is a fact about this repository that either shrinks or is
 * argued for in a review.
 *
 * The reading is [`@variance-authority/package`](../packages/package) and this is
 * a runner around it, for the same reason `surface.mjs` is: where the baseline
 * lives is this repository's business, and a package that hardcoded a path in it
 * would be describing us to somebody else's repository.
 *
 * `yarn documented` prints the list; `--write` records it.
 * `tools/documented.check.ts` compares the two.
 */

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BASELINE = join(ROOT, 'tools/documented.baseline.json');

/** One line per silent name: where it is, and how big the audience is. */
export function silent() {
  return undocumented(readHelp(ROOT)).map((entry) => ({
    name: entry.name,
    kind: entry.kind,
    at: entry.at,
    packages: entry.usedBy.length,
  }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const found = silent();
  const text = `${JSON.stringify(found, null, 2)}\n`;

  if (process.argv.includes('--write')) {
    writeFileSync(BASELINE, text, 'utf8');
    process.stdout.write(`documented: ${found.length} names cross a boundary in silence, recorded\n`);
  } else {
    process.stdout.write(text);
  }
}
