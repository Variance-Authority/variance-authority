import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ACTION, ROOT, conditionOf, runBlock } from './variance-action-steps.ts';

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

const WORKFLOW = join(ROOT, '.github/workflows/variance.yml');

describe('the variance action', () => {
  it('keeps the store an accepting run promoted, whatever the comparison after it found', async () => {
    const keep = await conditionOf('what the host keeps');

    expect(keep).toContain("(inputs.accept == 'true' || steps.tick.outputs.accept == 'true')");
    expect(keep).toContain("steps.promote.outcome == 'success'");
    expect(keep).not.toContain('exit-code');
  });

  it('promotes as the step the keep step reads', async () => {
    expect(await conditionOf('id: promote')).toBe("${{ inputs.accept == 'true' || steps.tick.outputs.accept == 'true' }}");
  });

  it('reads a tick only where it was asked to, on the pull request the tick belongs to', async () => {
    expect(await conditionOf('id: tick')).toBe("${{ inputs.tick-to-accept == 'true' && github.event_name == 'pull_request' }}");
  });

  it('reads the tick before it promotes, and names the person in what it records', async () => {
    const action = await readFile(ACTION, 'utf8');

    expect(action.indexOf('- id: tick')).toBeLessThan(action.indexOf('- id: promote'));
    expect(action.match(/VARIANCE_INTENT: \$\{\{ steps\.tick\.outputs\.intent \|\| inputs\.intent \}\}/g)).toHaveLength(2);
  });

  it('hands the name to the accept, so the approval row carries it', async () => {
    const action = await readFile(ACTION, 'utf8');

    expect(action).toContain('VARIANCE_BY: ${{ steps.tick.outputs.by }}');
    expect(action).toContain('accept --config "$VARIANCE_CONFIG" --all ${VARIANCE_BY:+--by "$VARIANCE_BY"}');
  });

  it('puts the box under the words that ask for it', async () => {
    const action = await readFile(ACTION, 'utf8');

    expect(action).toContain('VARIANCE_TICK_BOX: ${{ steps.tick.outputs.box }}');
    expect(action).toContain('--to-accept "$to_accept"');
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

describe('the sweep', () => {
  const SWEEP = join(ROOT, '.github/workflows/variance-sweep.yml');

  /** The arguments the run step hands the CLI when `flakes` is `flakes`. */
  async function runArgs(flakes: string): Promise<readonly string[]> {
    const at = await mkdtemp(join(tmpdir(), 'variance-action-run-'));
    try {
      const fake = join(at, 'variance');
      await writeFile(fake, `#!/bin/bash\nprintf '%s\\n' "$@" > "${at}/said"\n`, { mode: 0o755 });
      execFileSync('/bin/bash', ['-c', await runBlock('variance run')], {
        env: {
          ...process.env,
          VARIANCE_COMMAND: fake,
          VARIANCE_CONFIG: 'c.json',
          VARIANCE_PROFILE: '',
          VARIANCE_SUBJECTS: '',
          VARIANCE_SHARD: '',
          VARIANCE_INTENT: '',
          VARIANCE_FLAKES: flakes,
          VARIANCE_EXIT_ZERO_ON_CHANGES: 'false',
          GITHUB_OUTPUT: join(at, 'output'),
        },
        stdio: 'pipe',
      });
      return (await readFile(join(at, 'said'), 'utf8')).split('\n').filter((line) => line !== '');
    } finally {
      await rm(at, { recursive: true, force: true });
    }
  }

  it('is an input of the action, off unless a job asks for it', async () => {
    const { inputs } = parse(await readFile(ACTION, 'utf8')) as { inputs: Record<string, { default?: string }> };

    expect(inputs['flakes']?.default).toBe('false');
    expect(await readFile(ACTION, 'utf8')).toContain('VARIANCE_FLAKES: ${{ inputs.flakes }}');
  });

  it('reads every subject twice exactly when the job says true', async () => {
    expect(await runArgs('true')).toEqual(['run', '--config', 'c.json', '--flakes']);
    expect(await runArgs('false')).toEqual(['run', '--config', 'c.json']);
    expect(await runArgs('')).toEqual(['run', '--config', 'c.json']);
  });

  it('is what the nightly workflow runs, with no variance call or exit code of its own', async () => {
    const workflow = parse(await readFile(SWEEP, 'utf8')) as {
      jobs: Record<string, { steps: ReadonlyArray<{ uses?: string; run?: string; with?: Record<string, string> }> }>;
    };
    const steps = Object.values(workflow.jobs).flatMap((job) => job.steps);
    const sweep = steps.filter((step) => step.uses === './.github/actions/variance');

    expect(sweep).toHaveLength(1);
    expect(sweep[0]?.with).toMatchObject({ flakes: 'true', comment: 'false', 'report-page': 'true' });
    for (const { run } of steps) {
      if (run === undefined) continue;
      expect(run).not.toMatch(/bin\.js|(?:^|[\s;&|(])variance\s|\$\?|exit-code/m);
    }
  });
});

describe('the workflow that answers a tick', () => {
  const tick = () => readFile(join(ROOT, '.github/workflows/variance-tick.yml'), 'utf8');

  it('starts on an edited comment and may rerun a job', async () => {
    const workflow = await tick();

    expect(workflow).toMatch(/issue_comment:\s+types: \[edited\]/);
    expect(workflow).toContain('actions: write');
    expect(workflow).toContain('pull-requests: write');
  });

  it('never checks out the code of the pull request it answers', async () => {
    const workflow = await tick();

    expect(workflow).not.toMatch(/^\s+ref:/m);
    expect(workflow).toContain('sparse-checkout: .github/actions/variance');
  });

  it('runs one tick of a pull request at a time, because a rerun is refused while another goes', async () => {
    const workflow = await tick();

    expect(workflow).toContain('group: variance-tick-${{ github.event.comment.id }}');
    expect(workflow).toContain('cancel-in-progress: false');
  });
});

describe('the docket a tick needs', () => {
  /** What `--to-accept` received, when the render step has `box` to add. */
  async function toAccept(box: string): Promise<string> {
    const at = await mkdtemp(join(tmpdir(), 'variance-action-render-'));
    try {
      const fake = join(at, 'variance');
      await writeFile(
        fake,
        `#!/bin/bash\nwhile [ $# -gt 0 ]; do if [ "$1" = --to-accept ]; then printf %s "$2" > "${at}/said"; fi; shift; done\n`,
        { mode: 0o755 },
      );
      execFileSync('/bin/bash', ['-c', await runBlock('render the docket')], {
        env: {
          ...process.env,
          VARIANCE_COMMAND: fake,
          VARIANCE_CONFIG: 'c.json',
          VARIANCE_RUN_URL: '',
          VARIANCE_IMAGE_ROOT: '',
          VARIANCE_TO_ACCEPT: 'tick the box below.',
          VARIANCE_TICK_BOX: box,
          GITHUB_OUTPUT: join(at, 'output'),
          RUNNER_TEMP: at,
        },
      });
      return await readFile(join(at, 'said'), 'utf8');
    } finally {
      await rm(at, { recursive: true, force: true });
    }
  }

  it('sets the box apart from the words, as a list of its own', async () => {
    expect(await toAccept('- [ ] Accept this change')).toBe('tick the box below.\n\n- [ ] Accept this change');
  });

  it('adds nothing when the run offers no box', async () => {
    expect(await toAccept('')).toBe('tick the box below.');
  });
});

/** The rows the `project` job's matrix lists. */
async function projectRows(): Promise<ReadonlyArray<Record<string, string>>> {
  const workflow = parse(await readFile(WORKFLOW, 'utf8')) as {
    jobs: { project?: { strategy?: { matrix?: { include?: ReadonlyArray<Record<string, string>> } } } };
  };
  const rows = workflow.jobs.project?.strategy?.matrix?.include;
  if (rows === undefined) throw new Error('the workflow lists no projects');
  return rows;
}

describe('the cleared comment', () => {
  it('reaches the poster from the renderer', async () => {
    const text = await readFile(ACTION, 'utf8');

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
  it('says the tick is the review, because a project may share its name with a review service', async () => {
    const workflow = parse(await readFile(WORKFLOW, 'utf8')) as {
      jobs: { project: { steps: ReadonlyArray<{ uses?: string; with?: Record<string, string> }> } };
    };
    const accept = workflow.jobs.project.steps.find((step) => step.uses === './.github/actions/variance')?.with?.['to-accept'];

    expect(accept).toContain('That is the whole review: no review service holds this run.');
  });

  it('reports the site rather than block on it, and blocks on the review surface', async () => {
    const rows = await projectRows();

    expect(rows.find((row) => row['project'] === 'site')?.['exit-zero-on-changes']).toBe('true');
    expect(rows.find((row) => row['project'] === 'tribunal')?.['exit-zero-on-changes']).toBeUndefined();
  });

  it('records the site\'s whole job only on a dispatch of the default branch', async () => {
    const workflow = parse(await readFile(WORKFLOW, 'utf8')) as {
      jobs: { project: { steps: ReadonlyArray<{ id?: string; if?: string }> } };
    };

    expect(workflow.jobs.project.steps.find((step) => step.id === 'job')?.if).toBe(
      "matrix.project == 'site' && github.event_name == 'workflow_dispatch' && github.ref_name == github.event.repository.default_branch",
    );
  });

  it('hands each row\'s choice to the action', async () => {
    expect(await readFile(WORKFLOW, 'utf8')).toContain("exit-zero-on-changes: ${{ matrix['exit-zero-on-changes'] || 'false' }}");
  });
});

// A committed store accepts by a dispatch with `accept` on the pull request's
// branch: the action commits the images there, which the commit-back's own
// checks run for a dispatch. Nothing but that input turns it on. It runs in the
// `variance` job, on the install, build and Storybook the cached store paid for.
describe('the committed store', () => {
  type Step = Record<string, unknown>;
  const jobs = async (): Promise<Record<string, { steps: ReadonlyArray<Step> }>> =>
    (parse(await readFile(WORKFLOW, 'utf8')) as { jobs: Record<string, { steps: ReadonlyArray<Step> }> }).jobs;
  const LFS = 'cases/storybook-case/variance.lfs.config.json';
  const isAction = (step: Step) => step['uses'] === './.github/actions/variance';

  it('runs in the variance job, not a job that installs and builds again', async () => {
    const all = await jobs();

    expect(all['variance']?.steps.filter(isAction).map((step) => (step['with'] as Step)['config'])).toEqual([
      'cases/storybook-case/variance.config.json',
      LFS,
    ]);
    expect(Object.keys(all).filter((name) => all[name]!.steps.some((step) => isAction(step) && (step['with'] as Step)['config'] === LFS))).toEqual(['variance']);
  });

  it('runs whatever the cached store found, so a change there hides nothing here', async () => {
    const steps = (await jobs())['variance']!.steps;
    const from = steps.findIndex((step) => step['id'] === 'pointers');

    const first = steps.findIndex((step) => isAction(step));
    const cached = steps.slice(first, from).flatMap((step) => (typeof step['id'] === 'string' ? [step['id']] : []));

    expect(from).toBeGreaterThan(first);
    expect(cached).not.toEqual([]);
    for (const step of steps.slice(from)) {
      expect(String(step['if'])).toMatch(/!cancelled\(\)|always\(\)/);
      for (const id of cached) expect(String(step['if'])).not.toContain(`steps.${id}.`);
    }
  });

  it('commits the images on a dispatch with accept, and on no other run', async () => {
    const action = (await jobs())['variance']!.steps.find((step) => isAction(step) && (step['with'] as Step)['config'] === LFS);

    expect(action?.['with']).toMatchObject({
      'commit-baselines': '${{ inputs.accept == true && github.ref_name != github.event.repository.default_branch }}',
    });
    expect(action?.['with']).not.toHaveProperty('accept');
    expect(action?.['with']).not.toHaveProperty('tick-to-accept');
    expect(action?.['if']).toBe("${{ !cancelled() && steps.lfs-fetch.outcome == 'success' }}");
  });

  it('checks out the branch a dispatch commits to, with the token whose push starts a run only then', async () => {
    const checkout = (await jobs())['variance']!.steps.find((step) => String(step['uses']).startsWith('actions/checkout@'));

    expect(checkout?.['with']).not.toHaveProperty('ref');
    expect(checkout?.['with']).toMatchObject({ token: '${{ (inputs.accept && secrets.VARIANCE_PUSH_TOKEN) || github.token }}', lfs: false });
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
