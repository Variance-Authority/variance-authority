import { changelogOf, isRecorded, renderCommitMessage } from '@variance-authority/report';
import type { RunReport } from '@variance-authority/report';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readChangelog, wasRead, type ChangelogAnswer } from './changelog.js';
import { runCommand, type CommandResult, type CommandRunner } from './lfs.js';

/**
 * Reading a baseline's explanation back, and refusing to invent one.
 *
 * The failure this guards is not a parse bug. It is the shape of the answer:
 * three separate conditions — git absent, not a repository, a clone fetched at
 * depth 1 — each produce *no commits*, and each means something different from
 * "no baseline has ever been explained". A reader that returned an empty list for
 * all four is the reason this module has a union.
 */

const REPORT: RunReport = {
  runVersion: 1,
  at: '2026-08-20T00:00:00.000Z',
  identity: { engine: 'chromium', engineVersion: '1', platform: 'linux', digest: 'd' },
  retention: 'durable',
  run: { id: '4242', commit: 'abc123' },
  observations: [
    {
      subject: 'story:card',
      verdict: 'changed',
      because: 'moved',
      changedPixels: 100,
      regions: [
        {
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          pixels: 100,
          cause: true,
          fingerprint: 'v1:aaaa',
          component: 'Card',
        },
      ],
    },
  ],
};

function message(): string {
  const record = changelogOf({
    report: REPORT,
    accepted: ['story:card'],
    selection: 'all',
    at: '2026-08-21T00:00:00.000Z',
  });
  if (!isRecorded(record)) throw new Error(record.because);
  return renderCommitMessage({ message: 'chore(variance): regenerate baselines', record });
}

function log(commits: readonly (readonly [string, string, string])[]): string {
  return commits.map(([sha, at, body]) => `${sha}${at}${body}`).join('\n');
}

/** A git that answers whatever the test wants, per subcommand. */
function fakeGit(answers: Readonly<Record<string, Partial<CommandResult>>>): CommandRunner {
  return (_command, args) => {
    const key = args[0] ?? '';
    const answer = answers[key];
    if (answer === undefined) throw new Error(`the test did not expect \`git ${key}\``);
    return Promise.resolve({ code: 0, stdout: '', stderr: '', ...answer });
  };
}

async function read(git: CommandRunner): Promise<ChangelogAnswer> {
  return readChangelog({ root: '.variance/baselines', cwd: '/repo', git });
}

describe('what a repository can say about its own baselines', () => {
  it('reads the record out of the commit that carried it', async () => {
    const answer = await read(
      fakeGit({
        'rev-parse': { stdout: 'false\n' },
        log: { stdout: log([['1111111111111111', '2026-08-21T00:00:00+10:00', message()]]) },
      }),
    );

    if (!wasRead(answer)) throw new Error(answer.because);
    expect(answer.commits).toHaveLength(1);
    expect(answer.commits[0]?.sha).toBe('1111111111111111');
    expect(answer.commits[0]?.record.run).toBe('4242');
    expect(answer.commits[0]?.record.entries[0]?.component).toBe('Card');
    expect(answer.bounded).toEqual([]);
  });

  it('passes over the repository’s ordinary commits without counting them as anything', async () => {
    const answer = await read(
      fakeGit({
        'rev-parse': { stdout: 'false\n' },
        log: { stdout: log([['2222222222222222', '2026-08-21T00:00:00Z', 'fix the button\n']]) },
      }),
    );

    if (!wasRead(answer)) throw new Error(answer.because);
    expect(answer.commits).toEqual([]);
    expect(answer.bounded).toEqual([]);
  });

  it('says a shallow clone bounded the reading rather than presenting it as whole', async () => {
    const answer = await read(
      fakeGit({
        'rev-parse': { stdout: 'true\n' },
        log: { stdout: log([['3333333333333333', '2026-08-21T00:00:00Z', message()]]) },
      }),
    );

    if (!wasRead(answer)) throw new Error(answer.because);
    expect(answer.commits).toHaveLength(1);
    expect(answer.bounded[0]).toContain('shallow clone');
  });

  it('names a commit it could not decode, and keeps the ones it could', async () => {
    const answer = await read(
      fakeGit({
        'rev-parse': { stdout: 'false\n' },
        log: {
          stdout: log([
            ['4444444444444444', '2026-08-21T00:00:00Z', 'chore\n\nVariance-Run: v9 e30\n'],
            ['5555555555555555', '2026-08-20T00:00:00Z', message()],
          ]),
        },
      }),
    );

    if (!wasRead(answer)) throw new Error(answer.because);
    expect(answer.commits).toHaveLength(1);
    expect(answer.bounded[0]).toContain('444444444444');
  });

  it('refuses when git is not on the machine, rather than reporting no updates', async () => {
    const answer = await read(() => Promise.reject(new Error('spawn git ENOENT')));

    expect(wasRead(answer)).toBe(false);
    if (wasRead(answer)) return;
    expect(answer.because).toContain('git could not be run');
    expect(answer.because).toContain('not the answer that none exists');
  });

  it('refuses when git says this is not a repository', async () => {
    const answer = await read(
      fakeGit({ 'rev-parse': { code: 128, stderr: 'fatal: not a git repository\n' } }),
    );

    expect(wasRead(answer)).toBe(false);
    if (wasRead(answer)) return;
    expect(answer.because).toContain('not a git repository');
  });

  it('refuses a revision that does not resolve, naming what it asked', async () => {
    const answer = await readChangelog({
      root: '.variance/baselines',
      cwd: '/repo',
      since: 'v9.9.9',
      git: fakeGit({
        'rev-parse': { stdout: 'false\n' },
        log: { code: 128, stderr: "fatal: ambiguous argument 'v9.9.9..HEAD'\n" },
      }),
    });

    expect(wasRead(answer)).toBe(false);
    if (wasRead(answer)) return;
    expect(answer.because).toContain('v9.9.9..HEAD');
  });

  it('asks about the root the caller named, not one relative to where git ran', async () => {
    // The path git is told to filter on is read against the directory git runs in,
    // and that directory defaults to the root — so a relative root spelled the way
    // this package's own README spells it asked about `<root>/<root>`. Nothing is
    // committed there, so the reading came back empty, which is the one sentence
    // this module may not say by accident: no baseline has ever been explained.
    //
    // This git answers the way git does — the pathspec it was handed, resolved
    // against the directory it was run in, has to be the root that holds the
    // baselines — rather than answering whatever it is asked.
    const asGitWould =
      (root: string): CommandRunner =>
      (_command, args, options) => {
        const key = args[0] ?? '';
        if (key === 'rev-parse') return Promise.resolve({ code: 0, stdout: 'false\n', stderr: '' });
        const pathspec = args[args.length - 1] ?? '';
        const asked = resolve(options?.cwd ?? process.cwd(), pathspec);
        return Promise.resolve({
          code: 0,
          stdout:
            asked === resolve(root)
              ? log([['8888888888888888', '2026-08-21T00:00:00Z', message()]])
              : '',
          stderr: '',
        });
      };

    const relative = await readChangelog({
      root: '.variance/baselines',
      git: asGitWould(resolve('.variance/baselines')),
    });
    if (!wasRead(relative)) throw new Error(relative.because);
    expect(relative.commits).toHaveLength(1);

    const elsewhere = await readChangelog({
      root: '.variance/baselines',
      cwd: '/repo',
      git: asGitWould('/repo/.variance/baselines'),
    });
    if (!wasRead(elsewhere)) throw new Error(elsewhere.because);
    expect(elsewhere.commits).toHaveLength(1);
  });

  it('says when the limit, not the history, ended the reading', async () => {
    const answer = await readChangelog({
      root: '.variance/baselines',
      cwd: '/repo',
      limit: 2,
      git: fakeGit({
        'rev-parse': { stdout: 'false\n' },
        log: {
          stdout: log([
            ['6666666666666666', '2026-08-21T00:00:00Z', message()],
            ['7777777777777777', '2026-08-20T00:00:00Z', message()],
          ]),
        },
      }),
    });

    if (!wasRead(answer)) throw new Error(answer.because);
    expect(answer.commits).toHaveLength(2);
    expect(answer.bounded[0]).toContain('stopped at 2 commit(s)');
  });
});

describe('the runner both halves of this package share', () => {
  it('resolves for a process that ran and rejects for one that could not', async () => {
    // The distinction `readChangelog` builds its whole refusal on, asserted on the
    // real `runCommand` rather than on a double of it: a reader that received an
    // exit code where it expected a rejection would report a missing binary as an
    // empty history. Not `git`, so this holds on a machine without one.
    await expect(
      runCommand(process.execPath, ['-e', 'process.stdout.write("ran")'], { cwd: process.cwd() }),
    ).resolves.toEqual({ code: 0, stdout: 'ran', stderr: '' });

    const failed = await runCommand(process.execPath, ['-e', 'process.exit(3)'], {
      cwd: process.cwd(),
    });
    expect(failed.code).toBe(3);

    await expect(
      runCommand('variance-no-such-binary', [], { cwd: process.cwd() }),
    ).rejects.toThrow();
  });
});
