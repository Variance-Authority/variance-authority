import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NEEDS_REVIEW } from '../.github/scripts/outer-loop/flows.mjs';
import { ACTION, conditionOf, runBlock } from './variance-action-steps.ts';

/**
 * The check a run leaves: what the verdict step exits with and prints, and
 * what `--exit-zero-on-changes` changes about it, in the action and over the
 * shards. Each step's script is run by `/bin/bash`, as the runner runs it.
 */

const DOCKET_URL = 'https://github.test/o/r/pull/7#issuecomment-1';

/**
 * What the verdict step exits with, and what it prints, for a run's exit code
 * and whether `variance run` was handed `--exit-zero-on-changes`.
 */
async function verdict(
  code: string,
  exitZeroOnChanges: string,
  {
    kept = 'false',
    docketUrl = DOCKET_URL,
    reportUrl = '',
  }: {
    readonly kept?: string;
    readonly docketUrl?: string;
    readonly reportUrl?: string;
  } = {},
): Promise<{ readonly status: number; readonly out: string }> {
  try {
    const out = execFileSync('/bin/bash', ['-c', await runBlock('verdict')], {
      env: {
        ...process.env,
        CODE: code,
        KEPT: kept,
        DOCKET_URL: docketUrl,
        REPORT_URL: reportUrl,
        EXIT_ZERO_ON_CHANGES: exitZeroOnChanges,
      },
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { status: 0, out };
  } catch (error) {
    const failed = error as { status: number; stdout: string };
    return { status: failed.status, out: failed.stdout };
  }
}

/** The arguments the run step hands `variance run`, one per line. */
async function runArguments(exitZeroOnChanges: string): Promise<readonly string[]> {
  const at = await mkdtemp(join(tmpdir(), 'variance-action-run-'));
  try {
    const out = execFileSync('/bin/bash', ['-c', await runBlock('variance run')], {
      env: {
        ...process.env,
        VARIANCE_COMMAND: 'printf %s\\n',
        VARIANCE_CONFIG: 'variance.config.json',
        VARIANCE_PROFILE: '',
        VARIANCE_SUBJECTS: '',
        VARIANCE_SHARD: '',
        VARIANCE_INTENT: '',
        VARIANCE_EXIT_ZERO_ON_CHANGES: exitZeroOnChanges,
        VARIANCE_FLAKES: 'false',
        GITHUB_OUTPUT: join(at, 'output'),
      },
      encoding: 'utf8',
    });
    return out.split('\n').filter((line) => line !== '' && !line.startsWith('variance exited'));
  } finally {
    await rm(at, { recursive: true, force: true });
  }
}

describe('the verdict', () => {
  it('fails the check on changes that need review', async () => {
    const { status, out } = await verdict('1', 'false');

    expect(status).toBe(1);
    expect(out).toContain('::error::variance found changes that need review');
  });

  it('leads the reader to the comment, in the words the outer loop reads', async () => {
    const { out } = await verdict('1', 'false');

    expect(out).toContain(`::error::${NEEDS_REVIEW}; the docket is in the pull request comment at ${DOCKET_URL}\n`);
  });

  it('points at the report when no comment was written, rather than at a comment nobody can find', async () => {
    const uploaded = await verdict('1', 'false', { docketUrl: '', reportUrl: 'https://github.test/artifacts/1' });
    const neither = await verdict('1', 'false', { docketUrl: '' });

    expect(uploaded.out).toContain(`::error::${NEEDS_REVIEW}; the report is at https://github.test/artifacts/1\n`);
    expect(neither.out).toContain(`::error::${NEEDS_REVIEW}; the report is in the variance run step above\n`);
  });

  it('reads the address from the step that posted the comment', async () => {
    const action = await readFile(ACTION, 'utf8');

    expect(action).toMatch(/- id: post\n\s+name: post the docket/);
    expect(action).toContain('DOCKET_URL: ${{ steps.post.outputs.comment-url }}');
  });

  it('hands `--exit-zero-on-changes` to the run, which maps a change to 0 itself', async () => {
    expect(await runArguments('true')).toEqual(['run', '--config', 'variance.config.json', '--exit-zero-on-changes']);
    expect(await runArguments('false')).toEqual(['run', '--config', 'variance.config.json']);
  });

  it('reads no report of its own to tell a change from a hole', async () => {
    expect(await runBlock('verdict')).not.toContain('node -e');
  });

  it('hands the flag on only when no accept ran, so an accept the comparison did not hold still fails', async () => {
    const action = await readFile(ACTION, 'utf8');

    expect(action).toContain(
      "VARIANCE_EXIT_ZERO_ON_CHANGES: ${{ inputs.exit-zero-on-changes == 'true' && steps.promote.outcome != 'success' }}",
    );
    expect(action.match(/inputs\.exit-zero-on-changes ==/g)).toHaveLength(1);
  });

  it('reads what the run was handed, rather than deciding it again', async () => {
    const action = await readFile(ACTION, 'utf8');

    expect(action).toContain("EXIT_ZERO_ON_CHANGES: ${{ steps.run.outputs.exit-zero-on-changes == 'true' }}");
    expect(await conditionOf('publish the images the comment shows')).toContain(
      "steps.run.outputs.exit-zero-on-changes == 'true'",
    );
  });

  it('passes the check over changes the run named, and says where the docket is', async () => {
    const { status, out } = await verdict('0', 'true');

    expect(status).toBe(0);
    expect(out).toBe(`nothing blocks this check; the docket is in the pull request comment at ${DOCKET_URL}\n`);
  });

  it('still fails an accept the comparison after it did not hold when the job reports rather than blocks', async () => {
    const { status, out } = await verdict('1', 'true', { kept: 'true' });

    expect(status).toBe(1);
    expect(out).toContain('::error::variance kept what this run accepted');
    expect(out).toContain(`; the docket is in the pull request comment at ${DOCKET_URL}\n`);
  });

  it('still fails a run that could not observe every subject when the job reports rather than blocks', async () => {
    const { status, out } = await verdict('1', 'true');

    expect(status).toBe(1);
    expect(out).toContain('::error::variance could not observe every subject');
    expect(out).toContain(`; the docket is in the pull request comment at ${DOCKET_URL}\n`);
  });

  it('still fails a run that did not happen when the job reports rather than blocks', async () => {
    expect((await verdict('2', 'true')).status).toBe(2);
    expect((await verdict('', 'true')).status).toBe(2);
  });
});
