import { describe, expect, it } from 'vitest';
import { casesReached, closureOf, packageChange, workspacesOf } from './cases-reached.mjs';

/**
 * Which cases the `cases` job in `check.yml` runs on a pull request.
 *
 * Read against this repository's own manifests, because the closure is the
 * claim: a case that runs a package its manifest does not reach would be
 * skipped over a change to that package, and the run would be green over a case
 * that never ran.
 */

const workspaces = workspacesOf();
const counts = packageChange();
const reached = (...changed: string[]) => casesReached(changed, { workspaces, counts });
const allCases = [...workspaces.values()].map(({ dir }) => dir).filter((dir) => dir.startsWith('cases/'));

describe('the cases a change reached', () => {
  it('are none for prose, the site, a changeset and a repository rule', () => {
    const { whole, reached: cases } = reached(
      'README.md',
      'docs/sharing.md',
      'site/index.html',
      '.changeset/a-change.md',
      'tools/boundaries.check.ts',
      'cases/README.md',
    );
    expect(whole).toBeUndefined();
    expect([...cases.keys()]).toEqual([]);
  });

  it('are none for a package test, fixture or README, which no case loads', () => {
    const { reached: cases } = reached(
      'packages/cli/src/clone-cut.test.ts',
      'packages/sense/native/src/journeys_graph_tests.rs',
      'packages/cli/README.md',
    );
    expect([...cases.keys()]).toEqual([]);
  });

  it('is the case itself for a change inside it, its tests included', () => {
    const { reached: cases } = reached('cases/rstest-case/src/workflow.chromium.test.js');
    expect([...cases.keys()]).toEqual(['cases/rstest-case']);
  });

  it('is every case whose manifests reach a changed package, and only those', () => {
    const { reached: cases } = reached('packages/event/src/index.ts');
    const expected = allCases.filter((dir) => {
      const { manifest } = [...workspaces.values()].find((one) => one.dir === dir)!;
      return closureOf(manifest.name, workspaces).has('packages/event');
    });
    expect(expected).toContain('cases/event-announcement-case');
    expect([...cases.keys()]).toEqual(expected.sort());
  });

  it('follows a package to what it requires: the native scanner reaches every case that runs `sense`', () => {
    const { reached: cases } = reached('packages/sense/native/src/git.rs');
    expect([...cases.keys()]).toContain('cases/journey-tracing-case');
  });

  it('is every case for a path no workspace owns and nothing declares inert', () => {
    for (const path of ['yarn.lock', 'vitest.chromium.config.mts', '.github/workflows/check.yml', 'tools/page-agents.mjs']) {
      const { whole, reached: cases } = reached('docs/x.md', path);
      expect(whole).toBe(path);
      expect([...cases.keys()].sort()).toEqual([...allCases].sort());
    }
  });
});
