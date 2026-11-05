import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, resolve } from 'node:path';
import { vi } from 'vitest';

/**
 * Runs `run` with a `git` on `PATH` whose `cat-file --batch` answers a submodule
 * `<name> missing`, as a git older than the `<object> submodule` line does: 2.43
 * in Ubuntu 24.04, which CI's `suite` job installs. Every other answer is git's.
 *
 * `root` is where the real git is asked for its own path, and the read that
 * starts the process has to happen inside `run`.
 */
export function gitAnsweringSubmodulesMissing(root: string, run: () => void): void {
  const real = resolve(execFileSync('git', ['--exec-path'], { cwd: root, encoding: 'utf8' }).trim(), 'git');
  const bin = mkdtempSync(resolve(tmpdir(), 'variance-older-git-'));
  const script = resolve(bin, 'git');
  writeFileSync(
    script,
    `#!/bin/sh
case " $* " in
  *" cat-file --batch "*) '${real}' "$@" | perl -pe 'BEGIN { $| = 1 } s/^[0-9a-f]+ submodule$/older missing/' ;;
  *) exec '${real}' "$@" ;;
esac
`,
  );
  chmodSync(script, 0o755);
  vi.stubEnv('PATH', `${bin}${delimiter}${process.env.PATH}`);
  try {
    run();
  } finally {
    vi.unstubAllEnvs();
    rmSync(bin, { recursive: true, force: true });
  }
}
