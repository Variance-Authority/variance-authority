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
  readonly on: Node & { readonly pull_request: { readonly types: readonly string[] } };
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

describe('the whole job keeps a person’s decision', () => {
  it('starts on the label, and has no group but the job’s', () => {
    expect(printedJob().on.pull_request.types).toContain('labeled');
    expect(printedJob().concurrency).toBeUndefined();
  });

  // The accept is the event, so a label's run is the only run that holds it.
  // `single`, the default, cancels the waiting run for the next one, whatever
  // `cancel-in-progress` says, and any label on the pull request is a next one.
  it('lets every run wait, so no later event displaces the label’s', () => {
    expect(printedJob().jobs.variance.concurrency).toMatchObject({ queue: 'max' });
  });

  // GitHub refuses `true` beside `queue: max`, and `true` would cancel a running accept.
  it('cancels nothing that is running', () => {
    expect(printedJob().jobs.variance.concurrency).not.toHaveProperty('cancel-in-progress');
  });

  // One pull request's runs one at a time, so two never write the comment or the store at once.
  it('keys the group on the pull request', () => {
    expect(printedJob().jobs.variance.concurrency?.['group']).toBe('variance-${{ github.ref }}');
  });

  // `queue: max` keeps every push to `main`, and GitHub does not guarantee their
  // order. A run writes the store `main` compares against, so it asks for the
  // head once it holds the group: a newer run that went first has moved it.
  it('lets a push write the store only while it is the head of main', () => {
    const steps = printedJob().jobs.variance.steps;
    const head = steps.findIndex((step) => step['id'] === 'head');
    const action = steps.findIndex((step) => String(step['uses']).startsWith('Variance-Authority/action@'));

    expect(head).toBeGreaterThanOrEqual(0);
    expect(head).toBeLessThan(action);
    expect(steps[head]).toMatchObject({ if: "github.event_name == 'push'" });
    expect(steps[head]?.['run']).toContain('$GITHUB_SHA');
    expect(steps[action]).toMatchObject({ if: "steps.head.outputs.superseded != 'true'" });
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
