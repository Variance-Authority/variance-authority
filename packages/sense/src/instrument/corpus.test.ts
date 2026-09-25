import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSync } from 'oxc-parser';
import { describe, expect, it } from 'vitest';
import { instrument } from './index.js';

/**
 * The walk over every module this checkout has installed.
 *
 * The other tests here hold the shapes somebody thought to write. Installed
 * packages hold the shapes nobody did: minified switches that end a case at
 * the `}`, a re-export with no semicolon as the whole module, a parameter list
 * that is only a destructured rest. Each of those reached a real suite first —
 * the last one as a panic that aborted the worker loading it.
 *
 * So every module under `node_modules` is instrumented in both modes, and the
 * walk must not throw, and must hand back a program for every source that is
 * one. A symlink is not followed: the workspace's own packages are linked in,
 * and they are not what this reads.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const installed = join(repository, 'node_modules');

const MODULE = /\.[cm]?[jt]sx?$/;
const DECLARATION = /\.d\.[cm]?ts$/;

function modules(directory: string, out: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) modules(path, out);
    else if (entry.isFile() && MODULE.test(entry.name) && !DECLARATION.test(entry.name)) out.push(path);
  }
  return out;
}

describe('the walk over installed packages', () => {
  it('instruments every module without a panic, and hands back a program for every program', { timeout: 300_000 }, () => {
    const files = modules(installed);
    expect(files.length).toBeGreaterThan(1000);

    const failures: string[] = [];
    for (const file of files) {
      const name = relative(repository, file);
      const source = readFileSync(file, 'utf8');
      for (const mode of ['presence', 'entries'] as const) {
        let code: string | undefined;
        try {
          code = instrument(source, name, name, { mode })?.code;
        } catch (error) {
          failures.push(`${name} (${mode}): ${(error as Error).message}`);
          continue;
        }
        if (code === undefined) continue;
        const errors = parseSync(name, code).errors;
        if (errors.length > 0 && parseSync(name, source).errors.length === 0) {
          failures.push(`${name} (${mode}): ${errors[0]!.message}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });
});
