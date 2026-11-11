import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readOfferings } from '@variance-authority/package';
import { readModule } from '@variance-authority/sense/read';
import { describe, expect, it } from 'vitest';
import { FIXTURE, tracked } from './modules.mjs';
import { MODULE, ROOT } from './workspaces.js';

/**
 * A name is exported only by the module that declares it, or by a package's entry point.
 *
 * A re-export makes a name reachable from a module that does not declare it,
 * and every reader of the import graph — a person, an agent, `variance ask
 * uses` (#708) — then sees a short or a wrong list of who uses that name. The
 * file a `package.json` `exports` entry names is the package's published API
 * and is the one place a re-export is a decision; anywhere else it is a detour.
 *
 * Read by `readModule`, sense's one module reader, because it already folds
 * `import { a } from './x.js'; export { a }` into the same republish as
 * `export { a } from './x.js'`. Fixtures are input data for the readers that
 * handle re-exports, so they are not ours to hold to it.
 */

/** The source each published subpath opens, as `@variance-authority/package` maps a manifest back to it. */
function entryFiles(): ReadonlySet<string> {
  return new Set(readOfferings(ROOT).flatMap((offering) => offering.entrypoints.map((entry) => relative(ROOT, entry.source))));
}

/** Each export in the file that hands on a name another module declares, as `line: name`. */
function republishes(file: string): readonly string[] {
  const read = readModule(file, readFileSync(join(ROOT, file), 'utf8'));
  if (read.unknown?.includes('parse error')) throw new Error(`${file} could not be parsed: ${read.unknown}`);
  const imported = new Set(
    read.requests.filter((request) => request.republishes !== true).flatMap((request) => request.bindings.map((binding) => binding.local)),
  );
  return (read.exports ?? [])
    .filter((entry) => entry.from !== undefined || (entry.local !== undefined && imported.has(entry.local)))
    .map((entry) => `${entry.line}: ${entry.exported ?? '*'}${entry.from === undefined ? '' : ` from '${entry.from}'`}`);
}

describe('only a package entry point re-exports', () => {
  const entries = entryFiles();
  const modules = tracked('packages', 'tools').filter(
    (file) => MODULE.test(file) && !/\.d\.[mc]?ts$/.test(file) && !FIXTURE.test(file),
  );

  it('finds the entry points, so the rule below has something to allow', () => {
    expect(entries).toContain('packages/core/src/index.ts');
    expect(entries).toContain('packages/sense/src/read.ts');
  });

  it('sees a re-export in an entry point, so an empty answer below is not a blind reader', () => {
    expect(republishes('packages/core/src/index.ts').length).toBeGreaterThan(0);
  });

  it('leaves every other module to declare what it exports', () => {
    const found = modules
      .filter((file) => !entries.has(file))
      .flatMap((file) => republishes(file).map((site) => `${file}:${site}`));
    expect(found).toEqual([]);
  });
});
