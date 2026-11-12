import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { NAMES_THE_ACTION, PUBLIC_MARKDOWN, ROOT, fencesIn } from './markdown.js';

/**
 * A workflow on a page is run by a stranger, and by nobody here.
 *
 * The job `docs/placement.md` prints has no standing run in this repository, so
 * an input the action does not have reaches the reader's first red before it
 * reaches anybody who could fix it. Every example that names the action is
 * parsed as the YAML it is and held to the `action.yml` it names, as declared,
 * and to the major the release publishes. The whole job is held to what keeps
 * a person's decision besides, because no run here would show it lost.
 *
 * The rules that need no parser, which forms of `uses:` install the action and
 * which permissions it needs, are in `tools/docs-installs.check.ts`.
 */

type Node = Readonly<Record<string, unknown>>;

const isNode = (value: unknown): value is Node => typeof value === 'object' && value !== null;

/** Every value under `value`, itself first. */
function walk(value: unknown): unknown[] {
  return isNode(value) ? [value, ...Object.values(value).flatMap(walk)] : [value];
}

const yamlAt = (file: string): unknown => parse(readFileSync(resolve(ROOT, file), 'utf8'));

interface Declared {
  readonly inputs: Node;
  readonly outputs: Node;
}

/** What the action `uses:` names declares, or nothing when the path holds no action. */
function declaredBy(name: string): Declared | undefined {
  const file = `.github/actions/variance/${name.slice('Variance-Authority/action'.length)}/action.yml`.replace('//', '/');
  if (!existsSync(resolve(ROOT, file))) return undefined;
  const action = yamlAt(file) as { inputs?: Node; outputs?: Node };
  return { inputs: action.inputs ?? {}, outputs: action.outputs ?? {} };
}

/**
 * The major the release moves. It is set in a shell line of the step that asks
 * the action's repository for its push, so the workflow is parsed and only that
 * line is read as shell.
 */
function publishedMajor(): string {
  const major = walk(yamlAt('.github/workflows/release.yml'))
    .filter((value) => typeof value === 'string')
    .map((run) => /ACTION_MAJOR=(v\d+)/.exec(run)?.[1])
    .find((found) => found !== undefined);
  if (major === undefined) throw new Error('release.yml sets no ACTION_MAJOR');
  return major;
}

/** The outputs an expression reads off step `id`. An expression is not YAML, so this reads a parsed scalar. */
function outputsRead(id: string, document: unknown): string[] {
  return walk(document)
    .filter((value) => typeof value === 'string')
    .flatMap((text) => [...text.matchAll(/\bsteps\.([\w-]+)\.outputs\.([\w-]+)/g)])
    .filter((read) => read[1] === id)
    .map((read) => read[2]!);
}

/** What one step that names the action asks of it and it does not have. */
function wrongStep(step: Node, declared: Declared, document: unknown, major: string): string[] {
  const [name = '', version] = String(step['uses']).split('@');
  const given = isNode(step['with']) ? Object.keys(step['with']) : [];
  const missing = Object.entries(declared.inputs)
    .filter(([input, about]) => isNode(about) && about['required'] === true && !('default' in about) && !given.includes(input))
    .map(([input]) => `${name} requires the input ${input}`);
  const inputs = given.filter((input) => !(input in declared.inputs)).map((input) => `${name} has no input ${input}`);
  const outputs = typeof step['id'] === 'string'
    ? outputsRead(step['id'], document)
        .filter((output) => !(output in declared.outputs))
        .map((output) => `${name} has no output ${output}`)
    : [];
  // A commit names itself, and `tools/docs-installs.check.ts` holds the form.
  const versions = version !== undefined && /^v\d+$/.test(version) && version !== major
    ? [`${name}@${version} is not published: the release moves ${major}`]
    : [];
  return [...missing, ...inputs, ...outputs, ...versions];
}

/** What one YAML example asks of the action and it does not have. */
export function wrongUses(code: string, major: string): string[] {
  const document: unknown = parse(code);
  return walk(document)
    .filter(isNode)
    .filter((node) => typeof node['uses'] === 'string' && NAMES_THE_ACTION.test(node['uses']))
    .flatMap((step) => {
      const name = String(step['uses']).split('@')[0]!;
      const declared = declaredBy(name);
      return declared === undefined ? [`${name} is no action`] : wrongStep(step, declared, document, major);
    });
}

const EXAMPLES = PUBLIC_MARKDOWN.flatMap(fencesIn)
  .filter((fence) => fence.lang === 'yaml' || fence.lang === 'yml')
  .filter((fence) => fence.code.includes('Variance-Authority/action'));

describe('a printed workflow asks the action for what it declares', () => {
  it('reads the examples the pages print', () => {
    expect(EXAMPLES.map((fence) => fence.file)).toEqual(
      expect.arrayContaining(['docs/placement.md', 'packages/cli/README.md', '.github/actions/variance/README.md']),
    );
  });

  it.each(EXAMPLES.map((fence) => [`${fence.file}:${fence.line}`, fence.code] as const))('%s', (_, code) => {
    expect(wrongUses(code, publishedMajor())).toEqual([]);
  });

  const step = (lines: string): string =>
    `steps:\n  - id: gate\n    uses: Variance-Authority/action@v1\n${lines}`;

  it('finds an input the action does not have', () => {
    expect(wrongUses(step('    with:\n      accept-label: x\n'), 'v1')).toEqual([
      'Variance-Authority/action has no input accept-label',
    ]);
  });

  it('finds a required input left out, and not one with a default', () => {
    const declared: Declared = {
      inputs: { token: { required: true }, config: { required: true, default: 'variance.config.json' } },
      outputs: {},
    };

    expect(wrongStep({ uses: 'Variance-Authority/action@v1' }, declared, {}, 'v1')).toEqual([
      'Variance-Authority/action requires the input token',
    ]);
  });

  it('finds an output the action does not have', () => {
    const code = `${step('')}  - run: echo "$CODE"\n    env:\n      CODE: \${{ steps.gate.outputs.verdict }}\n`;

    expect(wrongUses(code, 'v1')).toEqual(['Variance-Authority/action has no output verdict']);
  });

  it('reads an output the action has, and another step’s as that step’s', () => {
    const code = `${step('')}  - run: echo\n    env:\n      A: \${{ steps.gate.outputs.exit-code }}\n      B: \${{ steps.other.outputs.verdict }}\n`;

    expect(wrongUses(code, 'v1')).toEqual([]);
  });

  it('finds a major the release does not move', () => {
    expect(wrongUses(step(''), 'v2')).toEqual(['Variance-Authority/action@v1 is not published: the release moves v2']);
  });

  it('finds an action the path does not hold', () => {
    expect(wrongUses('steps:\n  - uses: Variance-Authority/action/untick@v1\n', 'v1')).toEqual([
      'Variance-Authority/action/untick is no action',
    ]);
  });
});

interface Job {
  readonly if?: unknown;
  readonly concurrency?: Node;
  readonly steps: readonly Node[];
}

interface Workflow {
  readonly on: Node & { readonly pull_request?: Node | null; readonly workflow_dispatch?: Node };
  readonly concurrency?: unknown;
  readonly jobs: { readonly variance: Job };
}

/** The whole job, parsed as YAML. */
function printedJob(): Workflow {
  const found = fencesIn('docs/placement.md')
    .filter((fence) => fence.lang === 'yaml')
    .map((fence): unknown => parse(fence.code))
    .find((document) => isNode(document) && isNode(document['jobs']));
  if (found === undefined) throw new Error('docs/placement.md prints no workflow');
  return found as Workflow;
}

const theAction = (): Node | undefined =>
  printedJob().jobs.variance.steps.find((step) => String(step['uses']).startsWith('Variance-Authority/action@'));

describe('the whole job accepts by the tick, a dispatch and a push', () => {
  // A label is a second accept beside the tick, and one tied to no report: it
  // accepts whatever head the pull request is at when somebody adds it.
  it('starts on no label, and has no group but the job’s', () => {
    expect(JSON.stringify(printedJob().on.pull_request ?? {})).not.toContain('labeled');
    expect(printedJob().concurrency).toBeUndefined();
  });

  it('accepts on a push, a dispatch with accept ticked, and the tick', () => {
    expect(printedJob().on.workflow_dispatch).toMatchObject({ inputs: { accept: { type: 'boolean' } } });
    expect(theAction()?.['with']).toMatchObject({
      accept: "${{ github.event_name == 'push' || inputs.accept }}",
      'tick-to-accept': 'true',
    });
  });

  // One ref's runs one at a time, so two never write the comment or the store
  // at once. A push to a pull request leaves its running check reporting a head
  // nobody will read, so that run is cancelled; a push to `main` records what
  // `main` renders, so it runs to the end.
  it('keys the group on the ref, and cancels only a pull request’s older run', () => {
    expect(printedJob().jobs.variance.concurrency).toEqual({
      group: 'variance-${{ github.ref }}',
      'cancel-in-progress': "${{ github.event_name == 'pull_request' }}",
    });
  });

  it('wraps the action in no call to GitHub’s API', () => {
    const steps = printedJob().jobs.variance.steps;

    expect(steps.map((step) => step['id'])).not.toContain('head');
    expect(steps.filter((step) => /\bgh\b/.test(String(step['run'] ?? '')))).toEqual([]);
    expect(theAction()).not.toHaveProperty('if');
  });

  it('reports to a merge queue, which waits on a check nothing else would start', () => {
    expect(printedJob().on).toHaveProperty('merge_group');
  });

  // A pull request's accept is in a cache scope a queue's run cannot read, so
  // comparing there goes red on every change a person accepted.
  it('answers the queue by skipping, which reports success', () => {
    expect(printedJob().jobs.variance.if).toBe("github.event_name != 'merge_group'");
  });
});

// The action cannot hold or drop a scope: `permissions` is the workflow's. So
// the split (#1180) is held where an adopter copies it from, every whole
// workflow a page prints with the review action.
describe('the review is posted by a job that runs nothing of the pull request', () => {
  interface PrintedJob {
    readonly needs?: string | readonly string[];
    readonly permissions?: Node;
    readonly steps?: readonly Node[];
  }

  const reviews = (step: Node): boolean => String(step['uses']).startsWith('Variance-Authority/action/review@');
  const given = (step: Node): Node => (isNode(step['with']) ? step['with'] : {});
  const testing = EXAMPLES.filter((fence) => fence.code.includes('Variance-Authority/action/review@'))
    .map((fence) => ({ at: `${fence.file}:${fence.line}`, document: parse(fence.code) as { jobs?: Readonly<Record<string, PrintedJob>> } }))
    .flatMap(({ at, document }) => {
      const jobs = Object.entries(document.jobs ?? {});
      return jobs
        .filter(([, job]) => (job.steps ?? []).some((step) => reviews(step) && 'test' in given(step)))
        .map(([name, job]) => ({ at, name, job, jobs }));
    });

  it('is printed whole on the action README and the page that walks through the setup', () => {
    expect(testing.map((one) => one.at.split(':')[0])).toEqual(expect.arrayContaining(['.github/actions/variance/README.md', 'docs/review-coverage.md']));
  });

  it('gives the job that installs and runs the tests `contents: read` alone, and hands the review on', () => {
    for (const { at, name, job } of testing) {
      expect(job.permissions, `${at} ${name}`).toEqual({ contents: 'read' });
      expect(job.steps!.filter(reviews).map((step) => given(step)['comment']), `${at} ${name}`).toEqual(['false']);
    }
  });

  it('posts from one job that needs it, with write scopes and one step: the action with `from`', () => {
    for (const { at, name, jobs } of testing) {
      const posting = jobs.filter(([, job]) => [job.needs ?? []].flat().includes(name)).map(([, job]) => job);

      expect(posting, `${at} ${name}`).toHaveLength(1);
      expect(posting[0]!.steps, at).toEqual([{ uses: expect.stringMatching(/^Variance-Authority\/action\/review@/u), with: { from: 'variance-review' } }]);
      expect(posting[0]!.permissions, at).toMatchObject({ 'pull-requests': 'write' });
    }
  });
});

// A recipe is what a printed workflow holds beyond `on:`, the adopter's own
// steps, and our action's `uses:` or one `variance` command (the position "A
// process is codified in the action or the CLI, never pasted"). A page adds
// none; each one already printed is held here until the action or the CLI
// carries it, and the todo goes green when its page prints the one step.
describe('every printed workflow is the adopter’s steps and ours, with no recipe', () => {
  it.todo(
    'sharing.md’s GitHub Actions job and its S3 variant publish the mainline’s record with no `share --publish` step behind `if: always()` — needs an action input that publishes from a single mainline run ({{GAP:a}})',
  );
  it.todo(
    'the visual shards on sharding.md and the action README hand their reports to the merge with no artifact steps — needs each shard’s report to reach the merge’s `reports` input without an artifact ({{GAP:g}})',
  );
  it.todo(
    'sharing.md’s test-selection hand-off and the skill’s selection wiring publish the suite record with no `vitest list` step and no artifact steps — needs the suite-record publish to know the collected files (#1155), and the test jobs’ records to reach it without an artifact ({{GAP:g}})',
  );
  it.todo(
    'cache.md’s In CI, the CLI README’s pushed-record jobs, and the carry keep and take that the skill, selecting.md and path-faster-ci.md tell the reader to run, select with no event branch and no cache step — needs action/review to select on a pull request (#1181)',
  );
  it.todo(
    'sharding.md’s hand and receive jobs, its plan and test jobs, and the CLI README’s sharded jobs are one `uses:` each, with no `jq` — needs the plan and shard jobs as action steps, which waits on the matrix line (#1143) and on the test job selecting with no event branch (#1268), and on the record reaching each shard without an artifact ({{GAP:g}})',
  );
  it.todo(
    'the carry merge on sharing.md, the action README, the CLI README and the skill runs with no `if:` on the event — needs one input to make the carry merge ({{GAP:f}})',
  );
  it.todo(
    'the CLI README’s `variance-carried` hand-off reaches the run’s other jobs with no artifact steps — needs the record `carry take` took to reach those jobs without an artifact ({{GAP:g}})',
  );
  it.todo(
    'the CLI README’s Bitbucket pipeline posts its comment with no script the adopter writes — needs a shipped Bitbucket poster, or the README printing none ({{GAP:h}})',
  );
  it.todo(
    'source-index.md and cache.md keep the source index across runs with no `actions/cache` key — needs action/review to restore and save the source index ({{GAP:i}})',
  );
});
