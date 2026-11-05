import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NEEDS_REVIEW } from '../.github/scripts/outer-loop/flows.mjs';

/**
 * An accept is kept because a person made it, not because a comparison agreed.
 *
 * On `main` every push accepts what `main` renders, and the run then compares
 * again. A subject that renders differently twice fails that comparison, and
 * that is worth a red check. It is not a reason to throw away the 182 other
 * subjects the push accepted, which is what keeping the store only after a
 * green comparison did: `main` held no baseline, and every pull request
 * compared against nothing.
 *
 * Read from the action itself, since a composite action has no runner here.
 */

const ROOT = resolve(import.meta.dirname, '..');
const ACTION = join(ROOT, '.github/actions/variance/action.yml');
const WORKFLOW = join(ROOT, '.github/workflows/variance.yml');
const SHARDS = join(ROOT, '.github/workflows/variance-shards.yml');

/** The `if:` of the step whose `name:` or `id:` is `step`. */
async function conditionOf(step: string): Promise<string> {
  const lines = (await readFile(ACTION, 'utf8')).split('\n');
  const at = lines.findIndex((line) => /^\s*-\s|^\s+(id|name):/.test(line) && line.trim().endsWith(step));
  if (at < 0) throw new Error(`the action has no step ${step}`);
  let start = at;
  while (start > 0 && !/^\s*-\s/.test(lines[start] ?? '')) start -= 1;
  for (let line = start; line < lines.length; line += 1) {
    const text = lines[line] ?? '';
    if (line > start && /^\s*-\s/.test(text)) break;
    const found = /^\s*-?\s*if:\s*(.*)$/.exec(text);
    if (found?.[1] !== undefined) return found[1];
  }
  throw new Error(`step ${step} has no condition`);
}

describe('the variance action', () => {
  it('keeps the store an accepting run promoted, whatever the comparison after it found', async () => {
    const keep = await conditionOf('what the host keeps');

    expect(keep).toContain("inputs.accept == 'true'");
    expect(keep).toContain("steps.promote.outcome == 'success'");
    expect(keep).not.toContain('exit-code');
  });

  it('promotes as the step the keep step reads', async () => {
    expect(await conditionOf('id: promote')).toBe("${{ inputs.accept == 'true' }}");
  });

  it('keeps the accept even when a step after the gate failed', async () => {
    expect(await conditionOf('what the host keeps')).toMatch(/^\$\{\{ !cancelled\(\) && /);
    expect(await conditionOf('id: saved')).toMatch(/^\$\{\{ !cancelled\(\) && /);
  });

  it('lets the gate finish, so the keep step runs after a red comparison', async () => {
    const action = await readFile(ACTION, 'utf8');

    expect(action).toContain('if $VARIANCE_COMMAND "${args[@]}"; then code=0; else code=$?; fi');
  });

  it('names a red check after a kept accept as the subject, not as a change to review', async () => {
    const action = await readFile(ACTION, 'utf8');

    expect(action).toContain("KEPT: ${{ steps.saved.outcome == 'success' }}");
    expect(action).toMatch(/if \[ "\$KEPT" = true \]; then\s*(#.*\s*)*echo "::error::variance kept what this run accepted/);
  });
});

/** The `run:` block of the step whose `name:` is `step`, unindented. */
async function runBlock(step: string, file = ACTION): Promise<string> {
  const lines = (await readFile(file, 'utf8')).split('\n');
  const named = lines.findIndex((line) => line.trim().replace(/^- /u, '') === `name: ${step}`);
  if (named < 0) throw new Error(`the action has no step ${step}`);
  const run = lines.findIndex((line, at) => at > named && line.trim() === 'run: |');
  const indent = lines[run]!.length - lines[run]!.trimStart().length;
  const body: string[] = [];
  for (const line of lines.slice(run + 1)) {
    if (line.trim() !== '' && line.length - line.trimStart().length <= indent) break;
    body.push(line);
  }
  const inner = Math.min(...body.filter((line) => line.trim() !== '').map((line) => line.length - line.trimStart().length));
  return body.map((line) => line.slice(inner)).join('\n');
}

const DOCKET_URL = 'https://github.test/o/r/pull/7#issuecomment-1';

/** A report in which every subject was observed, and one changed. */
const CHANGED = { observations: [{ verdict: 'changed' }], notObserved: [] };

/**
 * What the verdict step exits with, and the annotation it prints, for a run's
 * exit code and report; `null` writes none, and `path` names another.
 */
async function verdict(
  code: string,
  exitZeroOnChanges: string,
  {
    kept = 'false',
    report = CHANGED as unknown,
    path,
    docketUrl = DOCKET_URL,
    reportUrl = '',
  }: {
    readonly kept?: string;
    readonly report?: unknown;
    readonly path?: string;
    readonly docketUrl?: string;
    readonly reportUrl?: string;
  } = {},
): Promise<{ readonly status: number; readonly out: string }> {
  const at = await mkdtemp(join(tmpdir(), 'variance-action-verdict-'));
  try {
    const written = join(at, 'report.json');
    if (report !== null) await writeFile(written, JSON.stringify(report));
    const out = execFileSync('/bin/bash', ['-c', await runBlock('verdict')], {
      env: {
        ...process.env,
        CODE: code,
        KEPT: kept,
        REPORT: path ?? written,
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

  it('names the same comment on a check that reports rather than blocks', async () => {
    expect((await verdict('1', 'true')).out).toContain(`::warning::${NEEDS_REVIEW}; the docket is in the pull request comment at ${DOCKET_URL}\n`);
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

  it('reports changes and passes the check when the job reports rather than blocks', async () => {
    const { status, out } = await verdict('1', 'true');

    expect(status).toBe(0);
    expect(out).toContain('::warning::variance found changes that need review');
  });

  it('still fails an accept the comparison after it did not hold when the job reports rather than blocks', async () => {
    const { status, out } = await verdict('1', 'true', { kept: 'true' });

    expect(status).toBe(1);
    expect(out).toContain('::error::variance kept what this run accepted');
    expect(out).toContain(`; the docket is in the pull request comment at ${DOCKET_URL}\n`);
  });

  it('still fails a run that could not observe every subject when the job reports rather than blocks', async () => {
    const holes = [
      { observations: [{ verdict: 'unchanged' }], notObserved: [{ kind: 'failed' }] },
      { observations: [{ verdict: 'unchanged', diagnostics: [{ severity: 'error' }] }], notObserved: [] },
      { observations: [{ verdict: 'changed' }] },
      { notObserved: [] },
      null,
    ];

    for (const report of holes) {
      const { status, out } = await verdict('1', 'true', { report });

      expect(status).toBe(1);
      expect(out).toContain('::error::variance could not observe every subject');
      expect(out).toContain(`; the docket is in the pull request comment at ${DOCKET_URL}\n`);
    }
  });

  it('still fails when the run named no report, when the job reports rather than blocks', async () => {
    const { status, out } = await verdict('1', 'true', { report: CHANGED, path: '' });

    expect(status).toBe(1);
    expect(out).toContain('::error::variance could not observe every subject');
  });

  it('still fails a run that did not happen when the job reports rather than blocks', async () => {
    expect((await verdict('2', 'true')).status).toBe(2);
    expect((await verdict('', 'true')).status).toBe(2);
  });
});

/** The rows `plan` lists, before a label narrows them. */
async function projectRows(): Promise<ReadonlyArray<Record<string, string>>> {
  const workflow = await readFile(WORKFLOW, 'utf8');
  const listed = /projects='(\[[^']*\])'/.exec(workflow);
  if (listed?.[1] === undefined) throw new Error('the workflow lists no projects');
  return JSON.parse(listed[1]) as ReadonlyArray<Record<string, string>>;
}

describe('the verdict over the shards', () => {
  const merged = async (docketUrl: string): Promise<string> => {
    try {
      execFileSync('/bin/bash', ['-c', await runBlock('verdict', SHARDS)], {
        env: { ...process.env, CODE: '1', DOCKET_URL: docketUrl },
        encoding: 'utf8',
        stdio: 'pipe',
      });
      throw new Error('a run that needs review passed');
    } catch (error) {
      return (error as { stdout: string }).stdout;
    }
  };

  it('leads the reader to the comment', async () => {
    expect(await merged(DOCKET_URL)).toContain(`::error::${NEEDS_REVIEW}; the docket is in the pull request comment at ${DOCKET_URL}\n`);
    expect(await readFile(SHARDS, 'utf8')).toContain('DOCKET_URL: ${{ steps.post.outputs.comment-url }}');
  });

  it('names no comment when none was written', async () => {
    expect(await merged('')).toContain(`::error::${NEEDS_REVIEW}; the report is in the variance report step above\n`);
  });
});

describe('the cleared comment', () => {
  it.each([['the action', ACTION], ['the shards', SHARDS]])('reaches the poster from the renderer in %s', async (_, file) => {
    const text = await readFile(file, 'utf8');

    expect(text).toMatch(/--cleared > "\$RUNNER_TEMP\/variance-cleared\.md"/);
    expect(text).toContain('--cleared-file "$RUNNER_TEMP/variance-cleared.md"');
  });

  it('leaves the render standing on a CLI older than the action, which v1 moves ahead of', async () => {
    const text = await readFile(ACTION, 'utf8');
    const block = text.slice(text.indexOf('# What that previous docket becomes'), text.indexOf('# The body, written'));
    const temp = await mkdtemp(join(tmpdir(), 'variance-action-cleared-'));
    try {
      const out = execFileSync('/bin/bash', ['-c', `set -euo pipefail\n${block}\necho rendered`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { ...process.env, RUNNER_TEMP: temp, VARIANCE_COMMAND: 'false', VARIANCE_CONFIG: 'variance.config.json' },
      });

      expect(out).toContain('::warning::');
      expect(out).toContain('rendered\n');
      await expect(readFile(join(temp, 'variance-cleared.md'), 'utf8')).rejects.toThrow('ENOENT');
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
});

describe('the projects the workflow observes', () => {
  it('says the label is the review, because a project may share its name with a review service', async () => {
    const accept = (await readFile(WORKFLOW, 'utf8')).split('\n').find((line) => line.includes('matrix.label') && line.includes('to-accept:'));

    expect(accept).toContain('The label is the whole review: no review service holds this run.');
  });

  it('reports the site rather than block on it, and blocks on the review surface', async () => {
    const rows = await projectRows();

    expect(rows.find((row) => row['project'] === 'site')?.['exit-zero-on-changes']).toBe('true');
    expect(rows.find((row) => row['project'] === 'tribunal')?.['exit-zero-on-changes']).toBeUndefined();
  });

  it('hands each row\'s choice to the action', async () => {
    expect(await readFile(WORKFLOW, 'utf8')).toContain("exit-zero-on-changes: ${{ matrix['exit-zero-on-changes'] || 'false' }}");
  });
});

/**
 * The commit-back's staging block, as the action runs it: from the pathspecs
 * `carry` printed to what `git add` put in the index. Run by `/bin/bash`,
 * which on macOS is 3.2, so the block stays portable to a self-hosted runner.
 */
async function stagingBlock(): Promise<string> {
  const lines = (await readFile(ACTION, 'utf8')).split('\n');
  const start = lines.findIndex((line) => line.trim() === 'if [ -z "$VARIANCE_PATHSPECS" ]; then');
  if (start < 0) throw new Error('the action has no commit-back staging block');
  const indent = lines[start]!.length - lines[start]!.trimStart().length;
  const end = lines.findIndex((line, at) => at > start && line === `${' '.repeat(indent)}fi`);
  return lines.slice(start, end + 1).map((line) => line.slice(indent)).join('\n');
}

async function staged(files: readonly string[], pathspecs: string): Promise<readonly string[]> {
  const repo = await mkdtemp(join(tmpdir(), 'variance-action-stage-'));
  try {
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
    git('init', '--quiet');
    for (const file of files) {
      await mkdir(dirname(join(repo, file)), { recursive: true });
      await writeFile(join(repo, file), file);
    }
    execFileSync('/bin/bash', ['-c', `set -euo pipefail\n${await stagingBlock()}`], {
      cwd: repo,
      env: { ...process.env, VARIANCE_PATHSPECS: pathspecs, VARIANCE_BASELINES: repo },
      stdio: 'pipe',
    });
    return git('diff', '--cached', '--name-only').split('\n').filter((line) => line !== '');
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}

describe('the commit-back', () => {
  it('stages what the pathspecs name, by its literal name, and nothing else', async () => {
    const files = ['ui/__baselines__/Button/Primary[1]-chromium.png', 'ui/__baselines__/Button/Primary1-chromium.png', 'notes.txt'];

    expect(await staged(files, ':(glob)**/__baselines__/*/Primary[[]1]-*.png')).toEqual([
      'ui/__baselines__/Button/Primary[1]-chromium.png',
    ]);
  });

  it('stages nothing when the pathspecs match nothing, rather than the whole tree', async () => {
    expect(await staged(['notes.txt', 'src/app.ts'], ':(glob)**/__baselines__/*/*-*.png\n:(glob)**/__baselines__/*/*-*.json')).toEqual([]);
  });
});
