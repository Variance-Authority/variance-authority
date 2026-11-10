import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * A sharded build is the matrix job and one merge step, as an adopter writes
 * it: the action, given the shards' `reports`, merges, posts and judges, and
 * the count is each report's own `k/n`, never a second number in the workflow.
 */

const ROOT = resolve(import.meta.dirname, '..');
const ACTION = join(ROOT, '.github/actions/variance/action.yml');
const SHARDS = join(ROOT, '.github/workflows/variance-shards.yml');

type Step = { readonly name?: string; readonly uses?: string; readonly run?: string; readonly with?: Record<string, string> };

/** What the run step hands the CLI and writes as its outputs, given `reports`, in a directory holding `files`. */
async function merge(reports: string, files: readonly string[], exitZeroOnChanges = 'false'): Promise<{ said: string; output: string }> {
  const { runs } = parse(await readFile(ACTION, 'utf8')) as { runs: { steps: readonly Step[] } };
  const block = runs.steps.find((step) => step.name === 'variance run')!.run!;
  const at = await mkdtemp(join(tmpdir(), 'variance-action-merge-'));
  try {
    for (const file of files) {
      await mkdir(dirname(join(at, file)), { recursive: true });
      await writeFile(join(at, file), '{}');
    }
    const fake = join(at, 'variance');
    await writeFile(fake, `#!/bin/bash\nprintf '%s\\n' "$@" >> "${at}/said"\n`, { mode: 0o755 });
    const unset = Object.fromEntries(['PROFILE', 'SUBJECTS', 'SHARD', 'INTENT', 'FLAKES'].map((name) => [`VARIANCE_${name}`, '']));
    const env = { ...unset, VARIANCE_COMMAND: fake, VARIANCE_CONFIG: 'c.json', VARIANCE_REPORTS: reports, VARIANCE_EXIT_ZERO_ON_CHANGES: exitZeroOnChanges, GITHUB_OUTPUT: join(at, 'output') };
    execFileSync('/bin/bash', ['-c', block], { cwd: at, env: { ...process.env, ...env }, stdio: 'pipe' });
    const read = (name: string) => readFile(join(at, name), 'utf8').catch(() => '');
    return { said: await read('said'), output: await read('output') };
  } finally {
    await rm(at, { recursive: true, force: true });
  }
}

describe('the merge of the shards', () => {
  it('reports over every shard the globs name, in place of a run', async () => {
    const { said, output } = await merge('shards/*/run.json', ['shards/b/run.json', 'shards/a/run.json']);
    expect(said).toBe('report\n--config\nc.json\nshards/a/run.json\nshards/b/run.json\n');
    expect(output).toContain('exit-code=0\n');
  });

  it('hands a line that names no file to the CLI as written, for `report` to refuse', async () => {
    const { said } = await merge('shards/*/run.json\nmissing/*.json', ['shards/a/run.json']);
    expect(said).toBe('report\n--config\nc.json\nshards/a/run.json\nmissing/*.json\n');
  });

  it('keeps `exit-zero-on-changes` over a merge, so a hole in the suite still fails', async () => {
    const { said } = await merge('shards/*/run.json', ['shards/a/run.json'], 'true');
    expect(said).toBe('report\n--config\nc.json\n--exit-zero-on-changes\nshards/a/run.json\n');
  });

  it('is the matrix job and one action step, with no count and no glue of its own', async () => {
    const { jobs } = parse(await readFile(SHARDS, 'utf8')) as { jobs: Record<string, { steps: readonly Step[] }> };
    const steps = jobs['merge']!.steps;
    expect(Object.keys(jobs)).toEqual(['shard', 'merge']);
    expect(steps.filter((step) => step.uses === './.github/actions/variance').map((step) => Object.keys(step.with ?? {}))).toEqual([
      expect.arrayContaining(['reports']),
    ]);
    for (const { run } of steps) expect(run ?? '').not.toMatch(/bin\.js|post-comment|\bsed\b|\bfind\b|case |exit-code/);
  });
});
