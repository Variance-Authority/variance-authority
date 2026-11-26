// compass: variance-authority.reach.crossings
/**
 * `variance view`: the recording as one page to explore.
 *
 * It reads the record and writes a file; nothing runs. Opening the page is the
 * person's: the command prints where it is.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { cacheRootFor, declaredSuites, nearestRecord, rawRecord } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import type { ParsedView } from '../view-args.js';
import { viewPage } from './view-page.js';

/** The page's path on stdout. */
export function viewOutput(parsed: ParsedView, cwd: string): { readonly out: string; readonly err: string } {
  const { suite, recording } = chosen(cwd, parsed.suite);
  const record = readFileSync(recording);
  const path = resolve(cwd, `${cacheRootFor(cwd)}/variance-view.html`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, viewPage({ ...(suite === undefined ? {} : { suite }), recording, size: record.length, packed: gzipSync(rawRecord(record)), code: code() }));
  return { out: `${path}\n`, err: '' };
}

/** The suite asked for, or the first whose record is on disk; each is located, none is read. */
function chosen(root: string, suite: string | undefined): { readonly suite?: string; readonly recording: string } {
  const declared = declaredSuites(root)?.map((held) => held.name);
  if (suite !== undefined && declared !== undefined && !declared.includes(suite)) {
    throw new OperatorError(`view: no suite is declared as ${suite}; the config declares ${declared.join(', ')}`);
  }
  const located = (suite === undefined ? (declared ?? [undefined]) : [suite]).map((name) => ({
    ...(name === undefined ? {} : { suite: name }),
    recording: nearestRecord(root, name === undefined ? {} : { suite: name }).file,
  }));
  const found = located.find((held) => existsSync(held.recording));
  if (found === undefined) throw new OperatorError(`view: nothing is recorded at ${located.map((held) => held.recording).join(', ')}`);
  return found;
}

/** The page's code, bundled by the package's build. */
function code(): string {
  const at = [new URL('./view.bundle.js', import.meta.url), new URL('../../dist/commands/view.bundle.js', import.meta.url)]
    .map((url) => fileURLToPath(url))
    .find((file) => existsSync(file));
  if (at === undefined) throw new Error('view: view.bundle.js is missing from the built package');
  return readFileSync(at, 'utf8');
}
