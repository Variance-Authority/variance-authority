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
  readonly id?: string;
  readonly if?: string;
  readonly run: string;
  readonly uses?: string;
  readonly with?: Readonly<Record<string, string>>;
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
  const BADGE = '{"schemaVersion":1,"label":"regions run","message":"75.0%","color":"blue"}';
  /** Two levels under the checkout, as a runner's workspace sits two levels under the folder that holds the actions. */
  const WORKSPACE = join(ROOT, 'work', 'repository');

  /** What the step named `step` asked the CLI, wrote and exited with, under a CLI that exits `exit` on `review`. */
  async function ran(step: string, env: Readonly<Record<string, string>> = {}, exit = 0) {
    const at = await mkdtemp(join(tmpdir(), 'variance-action-review-'));
    try {
      const fake = join(at, 'variance');
      await writeFile(
        fake,
        `#!/bin/bash\necho "$*" >> "${at}/said"\nif [ "$1" = review ]; then\n  [ ${exit} = 0 ] || exit ${exit}\n  mkdir -p "$REVIEW"\n  printf '${MARKER}\\nthe review\\n' > "$REVIEW/review.md"\n  echo the summary\nfi\nif [ "$1" = coverage ]; then\n  [ ${exit} = 0 ] || exit ${exit}\n  echo '${BADGE}'\nfi\n`,
        { mode: 0o755 },
      );
      await writeFile(join(at, 'output'), '');
      await writeFile(join(at, 'summary'), '');
      // The expressions GitHub fills in, filled the way a job on the host has them.
      const run = stepNamed(step).run
        .replaceAll('${{ github.action_path }}', join(ROOT, dirname(ACTION)))
        .replaceAll('${{ github.workspace }}', WORKSPACE);
      let status = 0;
      let printed = '';
      try {
        // The shell GitHub runs a `shell: bash` step under, errexit and all.
        printed = execFileSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', run], {
          env: {
            ...process.env,
            VARIANCE_COMMAND: fake,
            REVIEW: join(at, 'review'),
            GITHUB_OUTPUT: join(at, 'output'),
            GITHUB_STEP_SUMMARY: join(at, 'summary'),
            GITHUB_WORKSPACE: WORKSPACE,
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
    expect(stepNamed('review the change').env).toMatchObject({ SUITE: '${{ inputs.suite }}' });
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

  it('marks the diff after the comment, and a mark that could not be written fails nothing', () => {
    const { run } = stepNamed('post the review');

    expect(run.indexOf('"$here/../diff-marks.mjs" "$REVIEW/review.json" ||')).toBeGreaterThan(run.indexOf('post-comment.mjs'));
  });

  it('takes only what a review reads, and states no verdict for a run that never happened', () => {
    expect(Object.keys(action().inputs).sort()).toEqual(['against', 'badge', 'command', 'fail-on-lost', 'fail-on-uncovered', 'github-token', 'suite', 'test']);
    expect(action().outputs).toBeUndefined();
  });

  describe('the tests the action runs, between the carry that gives them a base and the carry that keeps what they ran', () => {
    const SUITE = "format('suite-{0}-{1}', inputs.suite";
    const order = [
      'what the host carries',
      "restore the suite's mainline record",
      "restore what the pull request's last push ran",
      "set the mainline's record aside",
      'run the tests',
      'review the change',
      'post the review',
      'publish the badge',
      'what the host keeps',
      "keep the suite's record for the next pull request",
      'keep what this push ran',
      'save what this push ran',
      'fail on what the review counted',
      'fail on the tests',
    ];

    it('takes the command as `test`, which only a named suite can carry for', () => {
      expect(action().inputs['test']).toMatchObject({ default: '' });
    });

    it('restores the suite and the last push before the take, runs the tests after it, and saves and keeps after the review', () => {
      expect(action().runs.steps.map((step) => step.name)).toEqual(order);
    });

    it('runs nothing of the carry around the tests when no `test` is named, so the review reads the record as before', () => {
      for (const name of order.slice(1, 5).concat(order.slice(8, 11), order.slice(13))) expect(stepNamed(name).if).toContain("inputs.test != ''");
    });

    it('restores the record the carry names for the suite, and the last push only on a pull request, which alone has one', () => {
      const suite = stepNamed("restore the suite's mainline record");
      expect(suite.uses).toBe('actions/cache/restore@v6');
      expect(suite.with).toEqual({
        path: `\${{ steps.carry.outputs[${SUITE.replace('{1}', 'path')})] }}`,
        key: `\${{ steps.carry.outputs[${SUITE.replace('{1}', 'key')})] }}`,
        'restore-keys': `\${{ steps.carry.outputs[${SUITE.replace('{1}', 'restore-keys')})] }}`,
      });
      const pushed = stepNamed("restore what the pull request's last push ran");
      expect(pushed.uses).toBe('actions/cache/restore@v6');
      expect(pushed.if).toContain("steps.carry.outputs.pushed-key != ''");
    });

    it('sets the mainline aside before the tests write over it, and refuses a `test` with no suite to carry', async () => {
      expect((await ran("set the mainline's record aside", { SUITE: 'unit' })).said).toEqual(['carry take --format github']);
      const refused = await ran("set the mainline's record aside", { SUITE: '' });
      expect(refused.status).toBe(1);
      expect(refused.said).toEqual(['']);
    });

    it("runs the adopter's command as a `run:` step would, and holds a red exit for the end, so the review and the saves still run", async () => {
      expect(await ran('run the tests', { VARIANCE_TEST: 'echo ran\nexit 3' })).toMatchObject({ status: 0, printed: 'ran\n', output: 'exit-code=3\n' });
      expect((await ran('run the tests', { VARIANCE_TEST: 'false\necho not reached' })).output).toBe('exit-code=1\n');
      expect(stepNamed('run the tests').env).toMatchObject({ VARIANCE_TEST: '${{ inputs.test }}' });
      const failing = stepNamed('fail on the tests');
      expect(failing.if).toBe("${{ !cancelled() && inputs.test != '' && steps.test.outcome == 'success' && steps.test.outputs.exit-code != '0' }}");
      expect(failing.env).toMatchObject({ CODE: '${{ steps.test.outputs.exit-code }}' });
      expect((await ran('fail on the tests', { CODE: '3' })).status).toBe(3);
    });

    it("compares with the record the take set aside, unless the workflow named one", () => {
      expect(stepNamed('review the change').env).toMatchObject({ AGAINST: "${{ inputs.against || steps.take.outputs[format('against-{0}', inputs.suite)] }}" });
    });

    it('saves after a red test or a failed post, as carry saves any run on a mainline', async () => {
      expect((await ran('what the host keeps')).said).toEqual(['carry save --format github']);
      expect(stepNamed('what the host keeps').if).toBe("${{ !cancelled() && inputs.test != '' }}");
      const suite = stepNamed("keep the suite's record for the next pull request");
      expect(suite.uses).toBe('actions/cache/save@v6');
      expect(suite.if).toBe(`\${{ !cancelled() && inputs.test != '' && steps.save.outputs[${SUITE.replace('{1}', 'key')})] != '' }}`);
      expect(suite.with).toEqual({ path: `\${{ steps.save.outputs[${SUITE.replace('{1}', 'path')})] }}`, key: `\${{ steps.save.outputs[${SUITE.replace('{1}', 'key')})] }}` });
      expect((await ran('keep what this push ran')).said).toEqual(['carry keep']);
      expect(stepNamed('keep what this push ran').if).toBe("${{ !cancelled() && inputs.test != '' && steps.save.outputs.pushed-key != '' }}");
      const pushed = stepNamed('save what this push ran');
      expect(pushed.if).toBe("${{ !cancelled() && steps.keep.outcome == 'success' }}");
      expect(pushed.with).toEqual({ path: '${{ steps.save.outputs.pushed-path }}', key: '${{ steps.save.outputs.pushed-key }}' });
    });
  });

  describe('the badge', () => {
    const git = (dir: string, ...args: string[]) => execFileSync('git', ['--git-dir', dir, ...args], { encoding: 'utf8' }).trim();

    /** Moves `main` of the bare repository to a new commit, as a push to it does, and answers the commit. */
    const pushed = (dir: string, message: string) => {
      const tree = execFileSync('git', ['--git-dir', dir, 'mktree'], { input: '', encoding: 'utf8' }).trim();
      const commit = execFileSync('git', ['--git-dir', dir, '-c', 'user.name=a', '-c', 'user.email=a@a', 'commit-tree', tree, '-m', message], { encoding: 'utf8' }).trim();
      git(dir, 'update-ref', 'refs/heads/main', commit);
      return commit;
    };

    /** A bare repository the step pushes to, as it would push to this run's repository, its `main` at the run's commit. */
    async function origin(): Promise<{ readonly env: Record<string, string>; readonly dir: string; readonly done: () => Promise<void> }> {
      const at = await mkdtemp(join(tmpdir(), 'variance-action-badge-'));
      const dir = join(at, 'origin.git');
      execFileSync('git', ['init', '--quiet', '--bare', dir]);
      return {
        dir,
        env: { GITHUB_SERVER_URL: `file://${at}`, GITHUB_REPOSITORY: 'origin', GITHUB_TOKEN: 'token', GITHUB_SHA: pushed(dir, 'ran'), BRANCH: 'main' },
        done: () => rm(at, { recursive: true, force: true }),
      };
    }

    it('leaves the badge to the newer commit\'s run when the branch has moved past this one', async () => {
      const remote = await origin();
      try {
        await ran('publish the badge', remote.env);
        const held = git(remote.dir, 'rev-parse', 'refs/badge/main');
        pushed(remote.dir, 'newer');

        const { status, printed } = await ran('publish the badge', remote.env);

        expect(status).toBe(0);
        expect(printed).toContain('::warning');
        expect(git(remote.dir, 'rev-parse', 'refs/badge/main')).toBe(held);
      } finally {
        await remote.done();
      }
    });

    it('pushes the figure as the one file of a commit with no parent at `refs/badge/<branch>`, replaced on each push', async () => {
      const remote = await origin();
      try {
        const first = await ran('publish the badge', remote.env);
        const second = await ran('publish the badge', remote.env);

        expect(first.said).toEqual(['coverage --format badge']);
        expect(second.status).toBe(0);
        expect(git(remote.dir, 'ls-tree', '--name-only', 'refs/badge/main')).toBe('regions-run.json');
        expect(git(remote.dir, 'show', 'refs/badge/main:regions-run.json')).toBe(BADGE);
        expect(git(remote.dir, 'rev-list', '--count', 'refs/badge/main')).toBe('1');
      } finally {
        await remote.done();
      }
    });

    it('leaves the last badge standing when coverage gives no figure, and says so', async () => {
      const remote = await origin();
      try {
        await ran('publish the badge', remote.env);
        const held = git(remote.dir, 'rev-parse', 'refs/badge/main');

        const { status, printed } = await ran('publish the badge', remote.env, 2);

        expect(status).toBe(0);
        expect(printed).toContain('::warning');
        expect(git(remote.dir, 'rev-parse', 'refs/badge/main')).toBe(held);
      } finally {
        await remote.done();
      }
    });

    it('warns and fails nothing when the push is refused', async () => {
      const remote = await origin();
      try {
        const { status, printed } = await ran('publish the badge', { ...remote.env, GITHUB_REPOSITORY: 'elsewhere' });

        expect(status).toBe(0);
        expect(printed).toContain('::warning');
      } finally {
        await remote.done();
      }
    });

    it('is published only when asked, on a push to the default branch, before a failure the review counted can skip it', () => {
      expect(action().inputs['badge']).toMatchObject({ default: 'false' });
      expect(stepNamed('publish the badge').if).toBe(
        "inputs.badge == 'true' && github.event_name == 'push' && github.ref == format('refs/heads/{0}', github.event.repository.default_branch)",
      );
      const names = action().runs.steps.map((step) => step.name);
      expect(names.indexOf('publish the badge')).toBeLessThan(names.indexOf('fail on what the review counted'));
    });
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

describe('the marks a review puts on the diff', () => {
  const region = (name: string, startLine: number, endLine: number, reach: string, kind = 'function') =>
    ({ kind, name, startLine, endLine, reach });

  /** What the script prints for a review of `files`, read from a `record` of that age. */
  async function marks(files: readonly unknown[], record = 'ran'): Promise<readonly string[]> {
    const at = await mkdtemp(join(tmpdir(), 'variance-diff-marks-'));
    try {
      await writeFile(join(at, 'review.json'), JSON.stringify({ record, files }));
      return execFileSync('node', [join(ROOT, FOLDER, 'diff-marks.mjs'), join(at, 'review.json')], { encoding: 'utf8' })
        .split('\n')
        .filter((line) => line !== '');
    } finally {
      await rm(at, { recursive: true, force: true });
    }
  }

  it('marks each changed function no case covered, at its lines, and nothing a case ran or may have', async () => {
    const regions = [
      region('parse', 3, 9, 'hole'),
      region('walk', 12, 20, 'unwalked'),
      region('guess', 22, 24, 'unknown'),
      region('ran', 30, 34, 'near'),
      region('far', 36, 40, 'far'),
      region('rewritten', 42, 44, 'overwritten'),
      region('ran/if', 31, 32, 'hole', 'branch'),
      region('', 1, 50, 'hole', 'module'),
    ];

    expect(await marks([{ file: 'src/a.ts', regions }, { file: 'README.md' }])).toEqual([
      '::warning file=src/a.ts,line=3,endLine=9,title=No run of this change covered this::`parse` changed, and no case that ran this change covered it.',
      '::warning file=src/a.ts,line=12,endLine=20,title=No run of this change covered this::`walk` changed, and no case that ran this change covered it.',
      '::warning file=src/a.ts,line=22,endLine=24,title=No run of this change covered this::`guess` changed, and no case that ran this change covered it.',
    ]);
  });

  it('marks a function once, not again for each function inside it', async () => {
    const regions = [region('outer/inner', 4, 6, 'hole'), region('outer', 2, 9, 'hole'), region('next', 9, 12, 'hole')];

    expect((await marks([{ file: 'a.ts', regions }])).map((mark) => /line=(\d+)/.exec(mark)?.[1])).toEqual(['2', '9']);
  });

  it('marks the lines the change wrote, which the diff shows, not the whole function', async () => {
    const written = [{ start: 1, end: 1 }, { start: 40, end: 41 }, { start: 58, end: 70 }];
    const regions = [region('long', 30, 60, 'hole')];

    expect((await marks([{ file: 'a.ts', written, regions }])).map((mark) => /line=\d+,endLine=\d+/.exec(mark)?.[0])).toEqual(['line=40,endLine=41']);
  });

  it('marks two functions that share their lines, one inside neither', async () => {
    const regions = [region('first', 3, 3, 'hole'), region('second', 3, 3, 'hole')];

    expect((await marks([{ file: 'a.ts', regions }])).map((mark) => /`(\w+)`/.exec(mark)?.[1])).toEqual(['first', 'second']);
  });

  it('calls a function with no name by what it is', async () => {
    const [mark] = await marks([{ file: 'a.ts', regions: [region('', 3, 4, 'hole')] }]);

    expect(mark).toContain('::A function changed, and no case that ran this change covered it.');
  });

  it('stops at the ten warnings GitHub shows for a step, and names how many it left out', async () => {
    const regions = Array.from({ length: 12 }, (_, at) => region(`f${at}`, at * 10 + 1, at * 10 + 5, 'hole'));
    const printed = await marks([{ file: 'a.ts', regions }]);

    expect(printed.filter((mark) => mark.startsWith('::warning '))).toHaveLength(10);
    expect(printed.at(-1)).toBe('::notice title=No run of this change covered these::2 more changed functions no case that ran this change covered: the review lists them.');
  });

  it('marks a file another suite ran as the tree holds it, under a named suite whose record is older', async () => {
    const regions = [region('parse', 3, 9, 'hole')];
    expect((await marks([{ file: 'a.ts', ran: true, regions }, { file: 'b.ts', regions }], 'before')).map((mark) => /file=([\w.]+)/.exec(mark)?.[1])).toEqual(['a.ts']);
  });

  it('marks nothing from a record older than the change, which has not run what the change wrote', async () => {
    expect(await marks([{ file: 'a.ts', regions: [region('parse', 3, 9, 'hole')] }], 'before')).toEqual([]);
  });

  it('escapes what a workflow command reads as its own syntax', async () => {
    const [mark] = await marks([{ file: 'src/a,b:c%.ts', regions: [region('100%', 1, 2, 'hole')] }]);

    expect(mark).toBe('::warning file=src/a%2Cb%3Ac%25.ts,line=1,endLine=2,title=No run of this change covered this::`100%25` changed, and no case that ran this change covered it.');
  });
});
