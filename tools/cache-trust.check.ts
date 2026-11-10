import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * Who can reach the Actions cache, stated where a workflow edit fails on it.
 *
 * TanStack's release restored a store that a `pull_request_target` run had saved
 * into `main`'s scope, and 84 versions went to npm from it. An entry is not
 * signed, so what stands between a pull request and a release is which runs may
 * read and which may write.
 */
const WORKFLOWS = resolve(import.meta.dirname, '..', '.github', 'workflows');

interface Workflow {
  readonly 'cache-mode'?: string;
  readonly jobs: Readonly<Record<string, { readonly 'cache-mode'?: string }>>;
}

const workflow = (name: string): Workflow => parse(readFileSync(resolve(WORKFLOWS, name), 'utf8')) as Workflow;

const jobModes = ({ jobs }: Workflow): readonly string[] => Object.values(jobs).flatMap((job) => job['cache-mode'] ?? []);

describe('the Actions cache', () => {
  it('reaches nothing in the release, in any job', () => {
    const release = workflow('release.yml');

    expect(release['cache-mode']).toBe('none');
    expect(jobModes(release)).toEqual([]);
  });

  // A trusted run writes without asking, so no run needs a declared write mode,
  // and on a low-trust run it replaces the read-only default.
  it('is never declared writable', () => {
    const names = readdirSync(WORKFLOWS).filter((name) => /\.ya?ml$/.test(name));
    const writable = names.filter((name) => {
      const parsed = workflow(name);
      return [parsed['cache-mode'] ?? [], jobModes(parsed)].flat().some((mode) => mode.startsWith('write'));
    });

    expect(writable).toEqual([]);
  });
});
