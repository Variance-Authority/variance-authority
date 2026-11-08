import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * The site serves the package READMEs and docs a release shipped.
 *
 * It renders them from the checkout it is built in, so it is in step with npm
 * exactly when it is built from the commit that published. 0.27.0 reached npm
 * while the site still served the sense README from before #1105, and an agent
 * adopting from it copied a transform by hand that 0.27 no longer needs.
 */
interface Step {
  readonly uses?: string;
  readonly with?: Readonly<Record<string, unknown>>;
  readonly run?: string;
  readonly 'working-directory'?: string;
}

interface Job {
  readonly if?: string;
  readonly needs?: string | readonly string[];
  readonly steps: readonly Step[];
}

const release = parse(
  readFileSync(resolve(import.meta.dirname, '..', '.github', 'workflows', 'release.yml'), 'utf8'),
) as { readonly jobs: Readonly<Record<string, Job>> };

const deploys = (job: Job): boolean =>
  job.steps.some((step) => step['working-directory'] === 'site' && step.run?.trim() === 'yarn deploy');

describe('a release', () => {
  it('deploys the site from the commit it published, once the publish succeeded', () => {
    const [name, job] = Object.entries(release.jobs).find(([, candidate]) => deploys(candidate)) ?? [];

    expect(name, 'no job in release.yml runs `yarn deploy` in site/').toBeDefined();
    expect([job?.needs].flat()).toContain('publish');
    expect(job?.if).toBe("github.event_name == 'workflow_dispatch'");
    // A checkout given a ref could build some other commit than the one published.
    expect(job?.steps.filter((step) => step.uses?.startsWith('actions/checkout@')).map((step) => step.with?.ref)).toEqual([
      undefined,
    ]);
  });
});
