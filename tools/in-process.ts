import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, afterEach } from 'vitest';

/**
 * A unit test runs in its own process. It may start a program that answers a
 * question and exits, and nothing else: a test that starts Node — the CLI, a
 * test runner, a monorepo tool — or a browser is an integration or a chromium
 * test, and belongs in the slice whose worker count can carry it
 * (`vitest.config.mts`).
 *
 * The file name is the only thing that puts a test in a slice, and a name with
 * no consequence drifts. This is the consequence: every start goes through the
 * guard, and a test that started something else fails, naming what it started
 * and the name the file should have. The process still starts, so the test is
 * judged on what it did and not on a refusal it never asked for.
 */

const ALLOWED = new Set([
  // How a fixture repository is made, and what the product reads it with.
  'git',
  // The search `packages/help/src/tools/grep.ts` shells out to.
  'rg',
  // When a process started, which `packages/sense/src/test-selection/prune.ts` asks.
  'ps',
  // Asked by the Sentry SDK for the context it attaches to an event.
  'sw_vers',
  // The service esbuild's JavaScript API runs its transforms in.
  'esbuild',
]);
const STARTS = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'] as const;
const GUARDED = Symbol.for('variance-authority.in-process');

type Start = (typeof STARTS)[number];
const module = childProcess as typeof childProcess & { [GUARDED]?: string[] };

/** The program a start names: a file, or the first word of a shell command. */
function program(start: Start, command: unknown): string {
  if (start === 'fork') return 'node';
  const text = String(command);
  const first = start === 'exec' || start === 'execSync' ? (text.trim().split(/\s+/)[0] ?? '') : text;
  return basename(first).replace(/\.(exe|cmd)$/i, '');
}

// Once per process: a worker runs many files, and each loads this file again.
if (module[GUARDED] === undefined) {
  const seen: string[] = [];
  module[GUARDED] = seen;
  const writable = module as unknown as Record<Start, (...args: unknown[]) => unknown>;
  const note = (start: Start, command: unknown) => {
    const name = program(start, command);
    if (!ALLOWED.has(name)) seen.push(name);
  };
  for (const start of STARTS) {
    const original = writable[start];
    const guarded = function guarded(this: unknown, ...args: unknown[]) {
      note(start, args[0]);
      return original.apply(this, args);
    };
    // `exec` and `execFile` carry the version `util.promisify` hands out, which
    // resolves to `{ stdout, stderr }` and calls the original directly, so it
    // is guarded too rather than lost.
    const promised = (original as { [promisify.custom]?: (...args: unknown[]) => unknown })[promisify.custom];
    if (promised !== undefined) {
      Object.defineProperty(guarded, promisify.custom, {
        value: function guardedPromise(this: unknown, ...args: unknown[]) {
          note(start, args[0]);
          return promised.apply(this, args);
        },
      });
    }
    writable[start] = guarded;
  }
  // The named exports an `import { spawn } from 'node:child_process'` holds
  // are copies until this puts the guarded functions into them.
  syncBuiltinESMExports();
}

const started = module[GUARDED] ?? [];

function refuse(): void {
  if (started.length === 0) return;
  const names = [...new Set(started.splice(0))].join(', ');
  throw new Error(
    `this unit test started ${names}. A unit test starts only ${[...ALLOWED].join(', ')}; ` +
      'rename the file to *.integration.test.* (a process) or *.chromium.test.* (a browser).',
  );
}

afterEach(refuse);
afterAll(refuse);
