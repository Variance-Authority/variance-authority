import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCommitMessage } from '@variance-authority/report';
import type { ChangelogCommit } from '@variance-authority/store/changelog';
import { OperatorError } from '../exit.js';
import type { Config } from '../config.js';
import { changelogRootFor, formatChangelog } from './changelog.js';
import { writeAcceptMessage } from './accept-message.js';
import type { CliRunReport } from './run.js';

/**
 * The two ends of the git-LFS half: writing an explanation somebody can commit,
 * and reading one back without pretending an unanswerable question was answered.
 *
 * The refusals are the substance. A project whose baselines live behind an
 * endpoint, or that keeps none at all, has a real changelog somewhere else or has
 * none to have — and printing an empty history for either is how an operator
 * concludes the writer is broken.
 */

function config(overrides: Partial<Config> = {}): Config {
  return {
    project: 'design-system',
    retention: 'durable',
    baselines: { kind: 'lfs', root: '.variance/baselines' },
    ...overrides,
  } as Config;
}

function report(): CliRunReport {
  return {
    runVersion: 1,
    at: '2026-08-20T00:00:00.000Z',
    identity: { engine: 'chromium', engineVersion: '1', platform: 'linux', digest: 'd' },
    retention: 'durable',
    run: { id: '4242', commit: 'abc123' },
    intent: 'tighten the card',
    observations: [
      {
        subject: 'story:card',
        verdict: 'changed',
        because: '120 pixel(s) differ',
        changedPixels: 120,
        regions: [
          {
            x: 0, y: 0, width: 10, height: 12, pixels: 120, cause: true,
            fingerprint: 'v1:aaaaaaaaaaaaaaaa', component: 'Card', file: 'src/Card.tsx',
          },
        ],
      },
    ],
  } as CliRunReport;
}

describe('which stores can be asked', () => {
  it('refuses a project that keeps no baselines, rather than reporting none were updated', () => {
    expect(() => changelogRootFor(config({ retention: 'ephemeral' }))).toThrow(OperatorError);
    expect(() => changelogRootFor(config({ retention: 'ephemeral' }))).toThrow(
      /keeps no baselines/,
    );
  });

  it('refuses a remote store by name, because its record is not in this checkout', () => {
    expect(() =>
      changelogRootFor(
        config({ baselines: { kind: 'remote', endpoint: 'https://tribunal.example' } } as Partial<Config>),
      ),
    ).toThrow(/https:\/\/tribunal.example/);
  });

  it('reads a directory store, which is a git store whenever the directory is committed', () => {
    expect(changelogRootFor(config({ baselines: { kind: 'directory', root: 'shots' } } as Partial<Config>))).toBe(
      'shots',
    );
  });
});

describe('the message `accept` leaves for the workflow to commit', () => {
  it('writes one a parser and a reviewer can both read', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'variance-changelog-'));
    const path = join(dir, 'message.txt');

    const said = await writeAcceptMessage({
      report: report(),
      result: { accepted: [{ subject: 'story:card', from: 'a.png' }], refused: [], alreadyBaseline: 0 },
      selection: 'all',
      path,
      message: 'chore(variance): regenerate baselines',
      project: 'design-system',
      at: '2026-08-21T00:00:00.000Z',
    });

    expect(said).toContain('1 change(s)');
    const text = await readFile(path, 'utf8');
    expect(text.split('\n')[0]).toBe('chore(variance): regenerate baselines');
    expect(text).toContain('Card src/Card.tsx');
    expect(parseCommitMessage(text)?.run).toBe('4242');
  });

  it('writes nothing when nothing was accepted, and says so', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'variance-changelog-'));
    const path = join(dir, 'message.txt');

    const said = await writeAcceptMessage({
      report: report(),
      result: { accepted: [], refused: [], alreadyBaseline: 3 },
      selection: 'all',
      path,
      message: 'chore(variance): regenerate baselines',
      at: '2026-08-21T00:00:00.000Z',
    });

    expect(said).toContain('no commit message was written');
    await expect(readFile(path, 'utf8')).rejects.toThrow();
  });
});

describe('the history, as the operator reads it', () => {
  const commit: ChangelogCommit = {
    sha: '1111111111111111111111111111111111111111',
    at: '2026-08-21T00:00:00+10:00',
    record: {
      changelogVersion: 1,
      run: '4242',
      commit: 'abc123def456',
      at: '2026-08-21T00:00:00.000Z',
      selection: 'all',
      ungrouped: 0,
      intent: 'tighten the card',
      entries: [
        {
          fingerprint: 'v1:aaaaaaaaaaaaaaaa',
          component: 'Card',
          file: 'src/Card.tsx',
          subjects: ['story:card'],
          reached: 3,
          cause: true,
        },
      ],
    },
  };

  it('says how the subjects were selected, because that is how much review it had', () => {
    const text = formatChangelog({ commits: [commit], bounded: [] });

    // The header is the same four facts the commit message carried, in the same
    // order, so a reader moving between `git log` and this command is reading one
    // format rather than two renderings of one record.
    expect(text).toContain('111111111111  2026-08-21T00:00:00+10:00  run 4242 @ abc123def456 --all');
    expect(text).toContain('\n  v1:aaaaaaaaaaaaaaaa Card src/Card.tsx 1/3');
    // Unlabelled, because the operator wrote it and a prefix would read as this
    // command having summarised it.
    expect(text).toContain('\n  tighten the card\n');
    // Spelled out here and nowhere in the record: a reader at a terminal has room
    // for the sentence that a commit message, written on every update, does not.
    expect(text).toContain('1 of 3 subject(s) this shape reached were promoted here');
  });

  it('prints what bounded the reading even when it found something', () => {
    const text = formatChangelog({ commits: [commit], bounded: ['this is a shallow clone'] });

    expect(text).toContain('note: this is a shallow clone');
  });

  it('tells an empty history apart from a filter that matched nothing', () => {
    expect(formatChangelog({ commits: [], bounded: [] })).toContain(
      'no commit under the baseline root carries a record',
    );
    expect(formatChangelog({ commits: [commit], bounded: [] }, { component: 'Button' })).toContain(
      'no recorded baseline update matches that filter',
    );
  });
});
