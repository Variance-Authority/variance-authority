import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { digestString } from '@variance-authority/core/format';
import { INSTRUMENTATION_ID } from '@variance-authority/sense/instrument';
import { testCoverageFile, type TestCoverage } from '@variance-authority/sense/test-selection';
import { selectOutput } from './select-command.js';
import { indexOutput } from './index-command.js';

/** A repository whose tests last ran at different commits, as the standing cases of `variance select` build it. */

export const NAMES = ['far', 'near'];

/**
 * Each module at `value`, and a test file for each, as the tree holds them. The
 * module writes `value` where its importer can see it, so a change to it is
 * charged to the test that loads the module, from either side of a commit.
 */
export function sources(value: number, names: readonly string[] = [...NAMES, 'gone']): Record<string, string> {
  return Object.fromEntries(
    names.flatMap((name) => [
      [`src/${name}.ts`, `export const ${name} = ${value};\nglobalThis.${name} = ${value};\n`],
      [`test/${name}.test.ts`, `import '../src/${name}.js';\n`],
    ]),
  );
}

/** A repository with its journal, committing whatever is written into it. */
export function checkout(root = mkdtempSync(join(tmpdir(), 'va-select-standing-'))) {
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '--quiet', '--initial-branch', 'main');
  git('config', 'user.email', 'fixture@example.test');
  git('config', 'user.name', 'Fixture');
  return {
    root,
    git,
    /** Read on use: the path follows the root config, which a commit may write after the checkout, and is read once per process. */
    get file() {
      return testCoverageFile(root);
    },
    commit(files: Readonly<Record<string, string>>, message: string): string {
      for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), text);
      }
      git('add', '-A');
      git('commit', '--quiet', '-m', message);
      return git('rev-parse', 'HEAD');
    },
    async select() {
      process.chdir(root);
      await indexOutput({ cwd: root });
      return await selectOutput({ cwd: root, format: 'plain' });
    },
  };
}

/**
 * What a run records: the tests it ran, and the module each loaded, with the
 * digest of the text on disk. Recorded under the recipe the seam records with,
 * so the landing re-cuts a carried module whose text moved and demotes the
 * test on the edited region, as it does after a real partial run.
 */
export function run(root: string, commit: string, names: readonly string[]): TestCoverage {
  return {
    version: 3,
    instrumentation: INSTRUMENTATION_ID,
    commit,
    tests: names.map((name) => ({ file: `test/${name}.test.ts`, complete: true, preconditions: [] })),
    modules: names.map((name) => ({
      file: `src/${name}.ts`,
      sourceDigest: digestString(readFileSync(join(root, `src/${name}.ts`), 'utf8')),
      instrumented: true,
      blocks: [
        {
          ordinal: 0,
          kind: 'module' as const,
          digest: `block:${name}`,
          name: '',
          path: 'module',
          startLine: 1,
          endLine: 1,
          source: true,
          testFiles: [`test/${name}.test.ts`],
        },
      ],
    })),
  };
}
