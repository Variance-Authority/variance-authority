import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, normalize, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * A project with only unit tests has no surface for `variance run` to observe,
 * so `Variance-Authority/action/review` runs the review instead. It shares the
 * poster with the docket, and nothing else: its marker, and what its failure
 * means, stay its own.
 *
 * Each step's script is run as the action runs it, under a fake CLI.
 */

const ROOT = resolve(import.meta.dirname, '..');
const FOLDER = '.github/actions/variance';
const ACTION = `${FOLDER}/review/action.yml`;

interface Step {
  readonly name: string;
  readonly if?: string;
  readonly run: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly 'continue-on-error'?: boolean;
}

const action = (): { inputs: Record<string, unknown>; outputs?: unknown; runs: { steps: readonly Step[] } } =>
  parse(readFileSync(join(ROOT, ACTION), 'utf8'));

function stepNamed(name: string): Step {
  const step = action().runs.steps.find((one) => one.name === name);
  if (step === undefined) throw new Error(`the review action has no step ${name}`);
  return step;
}

describe('the review a project with only unit tests puts on the pull request', () => {
  const MARKER = '<!-- variance-authority: review -->';

  /** What the step named `step` asked the CLI, wrote and exited with, under a CLI that exits `exit` on `review`. */
  async function ran(step: string, env: Readonly<Record<string, string>> = {}, exit = 0) {
    const at = await mkdtemp(join(tmpdir(), 'variance-action-review-'));
    try {
      const fake = join(at, 'variance');
      await writeFile(
        fake,
        `#!/bin/bash\necho "$*" >> "${at}/said"\nif [ "$1" = review ]; then\n  [ ${exit} = 0 ] || exit ${exit}\n  mkdir -p "$REVIEW"\n  printf '${MARKER}\\nthe review\\n' > "$REVIEW/review.md"\n  echo the summary\nfi\n`,
        { mode: 0o755 },
      );
      await writeFile(join(at, 'output'), '');
      await writeFile(join(at, 'summary'), '');
      const { run } = stepNamed(step);
      let status = 0;
      let printed = '';
      try {
        printed = execFileSync('/bin/bash', ['-c', run], {
          env: {
            ...process.env,
            VARIANCE_COMMAND: fake,
            REVIEW: join(at, 'review'),
            GITHUB_OUTPUT: join(at, 'output'),
            GITHUB_STEP_SUMMARY: join(at, 'summary'),
            ...env,
          },
          stdio: 'pipe',
          encoding: 'utf8',
        });
      } catch (error) {
        ({ status, stdout: printed } = error as { status: number; stdout: string });
      }
      const read = (name: string): Promise<string> => readFile(join(at, name), 'utf8').catch(() => '');
      return {
        status,
        printed,
        said: (await read('said')).trim().split('\n').map((line) => line.replaceAll(at, '<at>')),
        output: await read('output'),
        summary: await read('summary'),
      };
    } finally {
      await rm(at, { recursive: true, force: true });
    }
  }

  it('publishes the source index, then reviews with coverage from where the change starts', async () => {
    const { said } = await ran('review the change', { SINCE: 'abc123' });

    expect(said).toEqual(['index', 'review --since abc123 --coverage --out <at>/review --format markdown']);
  });

  it('leaves the start to the review when nobody named one', async () => {
    const { said } = await ran('review the change');

    expect(said[1]).toBe('review --coverage --out <at>/review --format markdown');
  });

  it('compares the named suite with the record the `against` input names, which coverage reads for a named suite alone', async () => {
    const { said } = await ran('review the change', { SINCE: 'abc123', SUITE: 'unit', AGAINST: '/the/mainline/coverage.bin' });

    expect(said[1]).toBe('review --since abc123 --suite unit --coverage --against /the/mainline/coverage.bin --out <at>/review --format markdown');
    expect(stepNamed('review the change').env).toMatchObject({ SUITE: '${{ inputs.suite }}', AGAINST: '${{ inputs.against }}' });
  });

  it('puts the review in the step summary', async () => {
    expect((await ran('review the change', { SINCE: 'abc123' })).summary).toBe('the summary\n');
  });

  it('fails on a review that did not happen, so the post never runs and the last comment stands', async () => {
    expect((await ran('review the change', { SINCE: 'abc123' }, 2)).status).toBe(2);
    expect(stepNamed('post the review').if).toBeUndefined();
    expect(stepNamed('review the change')['continue-on-error']).toBeUndefined();
  });

  it('asks for the exit only when the project opted in', async () => {
    expect((await ran('review the change')).said[1]).not.toContain('--fail-on-uncovered');
    expect((await ran('review the change', { FAIL_ON_UNCOVERED: 'false' })).said[1]).not.toContain('--fail-on-uncovered');
    expect((await ran('review the change', { FAIL_ON_UNCOVERED: 'true' })).said[1]).toBe('review --coverage --fail-on-uncovered --out <at>/review --format markdown');
    expect(stepNamed('review the change').env).toMatchObject({ FAIL_ON_UNCOVERED: '${{ inputs.fail-on-uncovered }}' });
    expect(action().inputs['fail-on-uncovered']).toMatchObject({ default: 'false' });
    expect((await ran('review the change', { FAIL_ON_LOST: 'true' })).said[1]).toBe('review --coverage --fail-on-lost --out <at>/review --format markdown');
    expect((await ran('review the change', { FAIL_ON_UNCOVERED: 'true', FAIL_ON_LOST: 'true' })).said[1]).toBe('review --coverage --fail-on-uncovered --fail-on-lost --out <at>/review --format markdown');
    expect(stepNamed('review the change').env).toMatchObject({ FAIL_ON_LOST: '${{ inputs.fail-on-lost }}' });
    expect(action().inputs['fail-on-lost']).toMatchObject({ default: 'false' });
  });

  it('posts a review that found uncovered code, then fails the step, so the comment says why the check is red', async () => {
    const { status, output } = await ran('review the change', { FAIL_ON_UNCOVERED: 'true' }, 1);

    expect(status).toBe(0);
    expect(output).toBe('exit-code=1\n');
    const names = action().runs.steps.map((step) => step.name);
    expect(names.indexOf('fail on what the review counted')).toBeGreaterThan(names.indexOf('post the review'));
    const failing = stepNamed('fail on what the review counted');
    expect(failing.if).toBe("steps.review.outputs.exit-code == '1'");
    expect(() => execFileSync('/bin/bash', ['-c', failing.run], { stdio: 'pipe' })).toThrow();
  });

  it('fails at once on exit 1 from a project that did not opt in, for no review means that by it', async () => {
    expect((await ran('review the change', {}, 1)).status).toBe(1);
  });

  it('leaves the step clean when nothing was uncovered', async () => {
    const { status, output } = await ran('review the change', { FAIL_ON_UNCOVERED: 'true' });

    expect(status).toBe(0);
    expect(output).toBe('exit-code=0\n');
  });

  it('asks carry without a config, because a project of suites alone holds no surface the parser accepts', async () => {
    expect((await ran('what the host carries')).said).toEqual(['carry restore --format github']);
  });

  it('posts the file the review wrote through the one poster, under the marker on its first line, adopting nothing', () => {
    const { run } = stepNamed('post the review');

    expect(run).toContain('"$here/../post-comment.mjs"');
    expect(run).toContain('--body-file "$REVIEW/review.md"');
    expect(run).toContain('--marker "$(head -n 1 "$REVIEW/review.md")"');
    expect(run).toContain('--adopt-unkeyed false');
  });

  it('takes only what a review reads, and states no verdict for a run that never happened', () => {
    expect(Object.keys(action().inputs).sort()).toEqual(['against', 'command', 'fail-on-lost', 'fail-on-uncovered', 'github-token', 'suite']);
    expect(action().outputs).toBeUndefined();
  });

  it('ships with the release, the poster beside it where the step looks', () => {
    const release = readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8');
    const shipped = /git archive HEAD (\S+) \| tar -x --strip-components=(\d)/.exec(release);

    expect(shipped?.[1]).toBe(FOLDER);
    expect(shipped?.[2]).toBe(String(FOLDER.split('/').length));
    const poster = normalize(join(dirname(ACTION), '../post-comment.mjs'));
    expect(poster.startsWith(`${FOLDER}/`)).toBe(true);
    expect(existsSync(join(ROOT, poster))).toBe(true);
  });
});
