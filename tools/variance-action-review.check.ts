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

  it('marks the diff after the comment, and a mark that could not be written fails nothing', () => {
    const { run } = stepNamed('post the review');

    expect(run.indexOf('"$here/../diff-marks.mjs" "$REVIEW/review.json" ||')).toBeGreaterThan(run.indexOf('post-comment.mjs'));
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
