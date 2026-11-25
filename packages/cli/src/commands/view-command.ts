// compass: variance-authority.reach.crossings
/**
 * `variance view`: the recording as one page to explore.
 *
 * It reads the record and writes a file; nothing runs. Opening the page is the
 * person's: the command prints where it is.
 */

// compass: variance-authority.reach

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { cacheRootFor } from '@variance-authority/sense/test-selection';
import type { ParsedView } from '../view-args.js';
import { coverage, type Coverage } from './coverage.js';
import { textOver } from './coverage-over-text.js';
import { viewData } from './view-data.js';
import { viewPage } from './view-page.js';

/** The page's path on stdout, and what could not be counted on stderr. */
export async function viewOutput(parsed: ParsedView, cwd: string): Promise<{ readonly out: string; readonly err: string }> {
  const data = viewData(cwd, parsed.suite);
  let counted: Coverage | { readonly missed: string };
  let err = '';
  try {
    counted = await coverage({ command: 'coverage', root: cwd, format: 'html', ...(parsed.suite === undefined ? {} : { suite: parsed.suite }) }, textOver);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    counted = { missed: reason };
    err = `view: coverage was not counted: ${reason}\n`;
  }
  const path = resolve(cwd, parsed.out ?? `${cacheRootFor(cwd)}/variance-view.html`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, viewPage(data, counted));
  return { out: `${path}\n`, err };
}
