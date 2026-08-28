import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PACKAGES } from './workspaces.js';

/**
 * A published bin is reached through a link, and that is the only way it is run.
 *
 * `npm install` writes `node_modules/.bin/variance` as a symlink into the
 * package, so `process.argv[1]` is the link while `import.meta.url` is its
 * target. An ESM executable that decides "am I the program?" by comparing those
 * two as written answers **no** on every installed machine and **yes** in the
 * repository, where the file is run by its own path. The result is not a crash:
 * the module finishes evaluating, nothing is dispatched, and the process exits
 * `0` having done nothing — `npx variance run` reports success without opening a
 * browser, which is the one result a gate must never invent.
 *
 * Nothing already here could catch it. The unit tests import `parseArgs` and
 * `main` directly, which is the code path the guard exists to protect *from*
 * argv, and `tools/boundaries.check.ts` asserts the bin file exists, which it
 * does. So this runs each declared bin twice — once by its real path, once
 * through a link — and requires the two to be indistinguishable. Written as a
 * comparison rather than as "prints something" because it stays true for a bin
 * whose correct answer is silence, and because it needs no second copy of what
 * each executable is supposed to say.
 */

/**
 * Arguments that make each executable terminate and say so.
 *
 * A bin with no entry here is a bin this check would hang on — a server waiting
 * on a port or on stdin — so an unlisted one fails rather than being skipped.
 */
const TERMINATES: Readonly<Record<string, readonly string[]>> = {
  // No arguments is the help request; `--help` would test one branch further in.
  variance: [],
  'variance-authority-help': ['--help'],
  // Refuses with a usage line; bare it would otherwise serve a report over stdio.
  'variance-authority-mcp': [],
  // Refuses without a token, below — a bare run with one set would listen.
  'variance-authority-server': [],
  // Refuses without a project, below — a bare run with one set would listen.
  'variance-authority-tribunal': [],
};

/**
 * The environment, minus the variables that would start a server.
 *
 * `variance-authority-server` refuses without a token and
 * `variance-authority-tribunal` refuses without a project, and those refusals are
 * what make them terminable here. On a machine where the operator happens to have
 * either exported, the same command listens and this check never returns.
 */
const {
  VARIANCE_HISTORY_TOKEN: _token,
  VARIANCE_TRIBUNAL_PROJECT: _project,
  ...ENVIRONMENT
} = process.env;

const links: string[] = [];

afterAll(() => {
  for (const directory of links.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('an installed bin', () => {
  const bins = PACKAGES.flatMap((workspace) =>
    Object.entries(workspace.manifest.bin ?? {}).map(([name, path]) => ({
      name,
      at: join(workspace.dir, path),
    })),
  );

  it.each(bins)('$name runs the same through a link as by its own path', ({ name, at }) => {
    const argv = TERMINATES[name];
    // A bin nobody described here cannot be run safely, and reporting it as
    // passing would leave the next executable added to the repository unchecked.
    expect(argv, `add \`${name}\` to TERMINATES with arguments that make it exit`).toBeDefined();

    const directory = mkdtempSync(join(tmpdir(), 'variance-bin-'));
    links.push(directory);
    const link = join(directory, name);
    symlinkSync(at, link);

    const direct = run(at, argv!);
    const linked = run(link, argv!);

    expect(linked).toEqual(direct);
    // Both sides agreeing on nothing at all is the defect wearing the assertion
    // above as a disguise: a guard that never fires is consistent everywhere.
    expect(`${direct.stdout}${direct.stderr}`.trim().length).toBeGreaterThan(0);
  });
});

function run(entry: string, argv: readonly string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [entry, ...argv], {
    encoding: 'utf8',
    env: ENVIRONMENT,
    timeout: 30_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
