import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { invocation, leaks, places, reached, sealed } from './codex-review.mjs';

const checkout = dirname(dirname(fileURLToPath(import.meta.url)));
const left: string[] = [];

/** The command itself, against a `codex` that runs `body` and a `gh` that answers for a pull request of one file. */
const review = (body: string, codexHome?: string) => {
  const root = mkdtempSync(join(tmpdir(), 'codex-review-check-'));
  left.push(root);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const login = join(root, codexHome ?? '.codex');
  mkdirSync(login);
  writeFileSync(join(login, 'auth.json'), '{}');
  writeFileSync(join(login, 'memories_1.sqlite'), '');
  const stub = (name: string, script: string) => {
    writeFileSync(join(bin, name), `#!/bin/sh\n${script}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  stub('gh', `echo '{"url":"https://github.com/o/r/pull/1","files":[{"path":"src/a.ts"}]}'`);
  stub('codex', `while [ $# -gt 1 ]; do [ "$1" = -o ] && out=$2; shift; done\n${body}`);
  const run = spawnSync(process.execPath, [join(checkout, 'tools/codex-review.mjs'), '1'], {
    cwd: checkout,
    encoding: 'utf8',
    env: {
      ...process.env,
      CODEX_HOME: codexHome && login,
      GH_TOKEN: 'of-the-caller',
      HOME: root,
      PATH: `${bin}:${process.env.PATH}`,
    },
  });
  const kept = /\/tmp\/review-[^/]+/.exec(run.stderr)?.[0];
  if (kept) left.push(kept);
  return run;
};

afterEach(() => {
  for (const path of left.splice(0)) rmSync(path, { recursive: true, force: true });
});

/**
 * A Codex review counts only when it knew nothing but the pull request. What
 * it could learn from its environment, and what its log shows it did learn,
 * are the two sides of that.
 */
describe('the Codex run', () => {
  it('is asked for the review and nothing else', () => {
    expect(invocation('https://github.com/o/r/pull/1', '/tmp/r/out.md').at(-1)).toBe('review https://github.com/o/r/pull/1');
  });

  it('ignores the configuration, rules, plugins and apps of whoever started it', () => {
    const args = invocation('u', 'o');
    expect(args).toEqual(expect.arrayContaining(['--ignore-user-config', '--ignore-rules', '--ephemeral']));
    expect(args.filter((_, i) => args[i - 1] === '--disable')).toEqual(['plugins', 'apps']);
  });

  it('holds no GitHub or git credential, temporary directory or agent variable', () => {
    const env = sealed('/tmp/r/home', '/tmp/r/codex', '/Applications/Codex/codex');
    expect(Object.keys(env).sort()).toEqual(['CODEX_HOME', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_TERMINAL_PROMPT', 'HOME', 'PATH']);
    expect(env.HOME).toBe('/tmp/r/home');
  });

  it('finds what ships beside its own binary first', () => {
    expect(sealed('h', 'c', '/Applications/Codex/codex').PATH.split(':')[0]).toBe('/Applications/Codex');
  });
});

describe('the command', () => {
  it('prints the review of a run that read the pull request', () => {
    const run = review(`echo 'read src/a.ts'; echo 'one finding' > "$out"`);
    expect(run.stdout).toContain('one finding');
    expect(run.status).toBe(0);
  });

  it('gives the run the login and nothing else of the home it came from', () => {
    const run = review(`echo 'read src/a.ts'; ls -A "$CODEX_HOME" > "$out"`);
    expect(run.stdout.trim()).toBe('auth.json');
  });

  it('finds the login where the caller keeps it', () => {
    const run = review(`echo 'read src/a.ts'; cat "$CODEX_HOME/auth.json" > "$out"`, 'elsewhere');
    expect(run.stdout.trim()).toBe('{}');
  });

  it('starts the run in an empty directory, with nothing of the caller\'s environment', () => {
    const run = review(`echo 'read src/a.ts'; { pwd; ls -A; env; } > "$out"`);
    expect(run.stdout).toMatch(/\/tmp\/review-[^/]+\/work\n(?!review)/);
    expect(run.stdout).not.toContain('GH_TOKEN');
  });

  it('refuses a run whose log names a checkout, and prints no review', () => {
    const run = review(`echo 'read src/a.ts in ${checkout}'; echo 'one finding' > "$out"`);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(checkout);
    expect(run.stdout).toBe('');
  });

  it('refuses a run that exited clean without reaching the pull request', () => {
    const run = review(`echo 'Could not resolve host: github.com'; echo 'no problems found' > "$out"`);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('no review made');
    expect(run.stdout).toBe('');
  });

  it('refuses a run that failed', () => {
    const run = review(`echo 'read src/a.ts'; echo 'one finding' > "$out"; exit 3`);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('codex exited with 3');
    expect(run.stdout).toBe('');
  });

  it.each([
    ['wrote no file', `echo 'read src/a.ts'`],
    ['wrote an empty file', `echo 'read src/a.ts'; : > "$out"`],
  ])('refuses a run that %s, which would read as no findings', (_, body) => {
    const run = review(body);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('codex wrote no review');
    expect(run.stdout).toBe('');
  });

  it('is the script the outer loop names', () => {
    const read = (path: string) => readFileSync(join(checkout, path), 'utf8');
    expect(JSON.parse(read('package.json')).scripts['review:codex']).toBe('node tools/codex-review.mjs');
    for (const page of ['AGENTS.md', '.agents/references/outer-loop.md']) expect(read(page)).toContain('yarn review:codex <n>');
  });
});

describe('reaching the pull request', () => {
  it('is a log that names one of its files', () => {
    expect(reached('{"text":"diff --git a/src/a.ts"}', [{ path: 'src/b.ts' }, { path: 'src/a.ts' }])).toBe(true);
  });

  it('is not a log that names none', () => {
    expect(reached('Could not resolve host: github.com', [{ path: 'src/a.ts' }])).toBe(false);
  });
});

describe('the leak check', () => {
  it('names each place of ours the log mentions', () => {
    const log = '{"command":"cat /Users/me/dev/repo/AGENTS.md"}';
    expect(leaks(log, ['/Users/me/dev/repo', '/tmp/scratch'])).toEqual(['/Users/me/dev/repo']);
  });

  it('counts a directory whose name spells a checkout, which a run can decode back to it', () => {
    const log = '{"command":"ls /private/tmp/agent/-Users-me-dev-repo/scratch"}';
    expect(leaks(log, places(['/Users/me/dev/repo']))).toEqual(['-Users-me-dev-repo']);
  });

  it('passes the system temporary directory, which tools a run starts name on their own', () => {
    const log = "git: error: couldn't create cache file '/var/folders/p_/T/xcrun_db-x'";
    expect(leaks(log, places(['/Users/me/dev/repo']))).toEqual([]);
  });

  it('passes a log that read the repository from the pull request', () => {
    expect(leaks('{"command":"cat /tmp/review-x/work/repo/AGENTS.md"}', ['/Users/me/dev/repo'])).toEqual([]);
  });
});
