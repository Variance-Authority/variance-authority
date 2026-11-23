import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, normalize } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACTION, BADGE, FOLDER, ROOT, type Step, action, git, origin, pushed, ran, stepNamed } from './variance-action-review-steps.js';

/**
 * A project with only unit tests has no surface for `variance run` to observe,
 * so `Variance-Authority/action/review` runs the review instead. It shares the
 * poster with the docket, and nothing else: its marker, and what its failure
 * means, stay its own.
 *
 * Each step's script is run as the action runs it, under a fake CLI.
 */

describe('the review a project with only unit tests puts on the pull request', () => {
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
    expect(stepNamed('post the review').if).toBe(
      "steps.taken.outcome == 'success' || (inputs.from == '' && inputs.comment != 'false')",
    );
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
    expect(failing.if).toBe("inputs.from == '' && steps.review.outputs.exit-code == '1'");
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
    expect(Object.keys(action().inputs).sort()).toEqual(['against', 'badge', 'command', 'comment', 'coverage-page', 'fail-on-lost', 'fail-on-uncovered', 'from', 'github-token', 'suite', 'test']);
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
      'count the regions run',
      'draw the coverage page',
      'upload the coverage page',
      'link the coverage page',
      'hand the review on',
      'take the review',
      'say the review job handed nothing on',
      'post the review',
      'publish the badge and the page',
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
      for (const name of order.slice(1, 5).concat(order.slice(15, 18), order.slice(20))) expect(stepNamed(name).if).toContain("inputs.test != ''");
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
      expect(failing.if).toBe("${{ !cancelled() && inputs.from == '' && inputs.test != '' && steps.test.outcome == 'success' && steps.test.outputs.exit-code != '0' }}");
      expect(failing.env).toMatchObject({ CODE: '${{ steps.test.outputs.exit-code }}' });
      expect((await ran('fail on the tests', { CODE: '3' })).status).toBe(3);
    });

    it("compares with the record the take set aside, unless the workflow named one", () => {
      expect(stepNamed('review the change').env).toMatchObject({ AGAINST: "${{ inputs.against || steps.take.outputs[format('against-{0}', inputs.suite)] }}" });
    });

    it('saves after a red test or a failed post, as carry saves any run on a mainline', async () => {
      expect((await ran('what the host keeps')).said).toEqual(['carry save --format github']);
      expect(stepNamed('what the host keeps').if).toBe("${{ !cancelled() && inputs.from == '' && inputs.test != '' }}");
      const suite = stepNamed("keep the suite's record for the next pull request");
      expect(suite.uses).toBe('actions/cache/save@v6');
      expect(suite.if).toBe(`\${{ !cancelled() && inputs.from == '' && inputs.test != '' && steps.save.outputs[${SUITE.replace('{1}', 'key')})] != '' }}`);
      expect(suite.with).toEqual({ path: `\${{ steps.save.outputs[${SUITE.replace('{1}', 'path')})] }}`, key: `\${{ steps.save.outputs[${SUITE.replace('{1}', 'key')})] }}` });
      expect((await ran('keep what this push ran')).said).toEqual(['carry keep']);
      expect(stepNamed('keep what this push ran').if).toBe("${{ !cancelled() && inputs.from == '' && inputs.test != '' && steps.save.outputs.pushed-key != '' }}");
      const pushed = stepNamed('save what this push ran');
      expect(pushed.if).toBe("${{ !cancelled() && inputs.from == '' && steps.keep.outcome == 'success' }}");
      expect(pushed.with).toEqual({ path: '${{ steps.save.outputs.pushed-path }}', key: '${{ steps.save.outputs.pushed-key }}' });
    });
  });

  describe('the badge', () => {
    /** Counts the figure, as the job that ran the tests does, then publishes it from the same review directory. */
    async function badge(env: Readonly<Record<string, string>>, exit = 0) {
      const review = await mkdtemp(join(tmpdir(), 'variance-action-badge-review-'));
      try {
        const counted = await ran('count the regions run', { REVIEW: review }, exit);
        return { ...(await ran('publish the badge and the page', { ...env, REVIEW: review })), said: counted.said, counted: counted.printed };
      } finally {
        await rm(review, { recursive: true, force: true });
      }
    }

    it('leaves the badge to the newer commit\'s run when the branch has moved past this one', async () => {
      const remote = await origin();
      try {
        await badge(remote.env);
        const held = git(remote.dir, 'rev-parse', 'refs/badge/main');
        pushed(remote.dir, 'newer');

        const { status, printed } = await badge(remote.env);

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
        const first = await badge(remote.env);
        const second = await badge(remote.env);

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
        await badge(remote.env);
        const held = git(remote.dir, 'rev-parse', 'refs/badge/main');

        const { status, printed } = await badge(remote.env, 2);

        expect(status).toBe(0);
        expect(printed).toContain('::warning');
        expect(git(remote.dir, 'rev-parse', 'refs/badge/main')).toBe(held);
      } finally {
        await remote.done();
      }
    });

    it('pushes nothing and says nothing under `from` when the job that ran the tests counted no figure', async () => {
      const remote = await origin();
      try {
        const { status, printed } = await ran('publish the badge and the page', { ...remote.env, FROM: 'variance-review' });

        expect(status).toBe(0);
        expect(printed).not.toContain('::warning');
        expect(() => git(remote.dir, 'rev-parse', '--verify', '--quiet', 'refs/badge/main')).toThrow();
      } finally {
        await remote.done();
      }
    });

    it('warns and fails nothing when the push is refused', async () => {
      const remote = await origin();
      try {
        const { status, printed } = await badge({ ...remote.env, GITHUB_REPOSITORY: 'elsewhere' });

        expect(status).toBe(0);
        expect(printed).toContain('::warning');
      } finally {
        await remote.done();
      }
    });

    it('is published only when asked, on a push to the default branch, before a failure the review counted can skip it', () => {
      expect(action().inputs['badge']).toMatchObject({ default: 'false' });
      expect(stepNamed('count the regions run').if).toBe(
        "inputs.from == '' && inputs.badge == 'true' && github.event_name == 'push' && github.ref == format('refs/heads/{0}', github.event.repository.default_branch)",
      );
      expect(stepNamed('publish the badge and the page').if).toBe(
        "(steps.taken.outcome == 'success' || (inputs.from == '' && inputs.comment != 'false' && inputs.badge == 'true')) && github.event_name == 'push' && github.ref == format('refs/heads/{0}', github.event.repository.default_branch)",
      );
      const names = action().runs.steps.map((step) => step.name);
      expect(names.indexOf('publish the badge and the page')).toBeLessThan(names.indexOf('fail on what the review counted'));
    });
  });

  // A test, or a package it installs, can read every token its job holds: the
  // runner reaps what a step left running only when the job ends, and a later
  // step's environment is readable from `/proc`.
  describe("the job that runs the tests and the job that holds the token", () => {
    const steps = () => action().runs.steps;
    const text = (step: Step): string => JSON.stringify(step);

    it("reads the token only in a step `comment: 'false'` skips, and hands on the review that step would post", () => {
      const reading = steps().filter((step) => text(step).includes('inputs.github-token'));

      expect(reading.map((step) => step.name)).toEqual(['post the review', 'publish the badge and the page']);
      for (const step of reading) expect(step.if).toContain("inputs.comment != 'false'");
      const handed = stepNamed('hand the review on');
      expect(handed.if).toBe("inputs.from == '' && inputs.comment == 'false'");
      expect(handed.with).toMatchObject({
        name: 'variance-review',
        path: '${{ steps.carry.outputs.review }}',
        'include-hidden-files': true,
      });
    });

    it('runs nothing of the pull request with `from`: it takes the review, posts it and pushes the badge', () => {
      // A step whose every branch needs no `from` cannot run beside it.
      const running = steps().filter((step) => !/^(\$\{\{ )?(!cancelled\(\) && )?inputs\.from == ''/u.test(step.if ?? ''));

      expect(running.map((step) => step.name)).toEqual([
        'take the review',
        'say the review job handed nothing on',
        'post the review',
        'publish the badge and the page',
      ]);
      for (const step of running) expect(text(step)).not.toMatch(/inputs\.(test|command)\b|actions\/checkout/u);
      expect(stepNamed('take the review').with).toMatchObject({ name: '${{ inputs.from }}' });
    });

    // A review job that failed uploads nothing: its red says why, and the
    // download's own error would be a second red pointing elsewhere.
    it('warns once and posts nothing when the review job handed nothing on', () => {
      const taken = stepNamed('take the review');

      expect(taken).toMatchObject({ id: 'taken', 'continue-on-error': true });
      expect(stepNamed('say the review job handed nothing on').if).toBe(
        "inputs.from != '' && steps.taken.outcome != 'success'",
      );
      for (const name of ['post the review', 'publish the badge and the page'])
        expect(stepNamed(name).if).toContain("steps.taken.outcome == 'success'");
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
