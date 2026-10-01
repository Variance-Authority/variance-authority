import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { affectedProjects } from './changes.js';
import { OperatorError } from '../exit.js';

/**
 * Borrowing an answer, and refusing to invent one.
 *
 * Everything here runs a real subprocess against a script standing in for the
 * tool, because the interesting behaviour is entirely in the seam: which binary
 * is found, what is done with the progress lines both tools print alongside their
 * JSON, and — the one that matters — what happens when the tool does not answer.
 *
 * An empty project list is a legitimate answer meaning *this diff crosses no
 * package boundary*. So a failure must never be able to produce it: the two would
 * be indistinguishable, and the second one skips every consumer of whatever
 * changed while reporting a successful narrowing.
 */

const NX = `#!/bin/sh
case "$*" in
  "show projects --affected --base=main --json")
    echo '["app","design-system"]' ;;
  "show project app --json")
    echo '{"name":"app","root":"apps/app"}' ;;
  "show project design-system --json")
    echo '{"name":"design-system","root":"packages/design-system/"}' ;;
  *)
    echo "unexpected: $*" >&2; exit 3 ;;
esac
`;

const TURBO = `#!/bin/sh
echo "• Packages in scope: app"
echo '{"packages":["app"],"tasks":[{"package":"app","directory":"apps/app/"},{"package":"app","directory":"apps/app"},{"package":"root","directory":"."}]}'
`;

describe('asking a monorepo tool what a diff affects', () => {
  const made: string[] = [];

  afterAll(async () => {
    for (const dir of made) await rm(dir, { recursive: true, force: true });
  });

  async function workspace(binary: string, script: string): Promise<string> {
    const cwd = await mkdtemp(join(tmpdir(), 'variance-changes-'));
    made.push(cwd);

    const bin = join(cwd, 'node_modules', '.bin');
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, binary), script, 'utf8');
    await chmod(join(bin, binary), 0o755);

    return cwd;
  }

  it('reads project names and the directories the graph needs', async () => {
    const cwd = await workspace('nx', NX);

    const affected = await affectedProjects({ source: { tool: 'nx' }, base: 'main', cwd });

    // `nx` answers in names and the graph seeds in paths, and there is no single
    // command that gives both — so the second lookup is the point of this.
    expect(affected.names).toEqual(['app', 'design-system']);
    expect(affected.dirs).toEqual(['apps/app', 'packages/design-system']);
    expect(affected.because).toContain('--base=main');
  });

  it('finds the payload among the lines a tool prints around it', async () => {
    const cwd = await workspace('turbo', TURBO);

    const affected = await affectedProjects({
      source: { tool: 'turbo', task: 'build' },
      base: 'main',
      cwd,
    });

    expect(affected.names).toEqual(['app']);
    // One directory, whatever the task list repeats — and the workspace root is
    // dropped, because seeding it would mark every file in the repository.
    expect(affected.dirs).toEqual(['apps/app']);
  });

  it('refuses turbo without the task it answers about', async () => {
    const cwd = await workspace('turbo', TURBO);

    // `turbo` filters a task graph rather than describing a workspace. With no
    // task there is nothing to filter, and the answer would be every package —
    // which looks like a correct wide answer and is an unasked question.
    await expect(
      affectedProjects({ source: { tool: 'turbo' }, base: 'main', cwd }),
    ).rejects.toThrow(OperatorError);
  });

  it('fails rather than answering an unrun tool with no projects', async () => {
    const cwd = await workspace('nx', '#!/bin/sh\necho "not installed" >&2\nexit 127\n');

    const failure = affectedProjects({ source: { tool: 'nx' }, base: 'main', cwd });

    await expect(failure).rejects.toThrow(OperatorError);
    await expect(failure).rejects.toThrow(/skip every consumer/);
  });

  it('fails rather than narrowing on output it could not read', async () => {
    const cwd = await workspace('nx', '#!/bin/sh\necho "NX  no projects to show"\n');

    await expect(
      affectedProjects({ source: { tool: 'nx' }, base: 'main', cwd }),
    ).rejects.toThrow(/printed no JSON/);
  });

  it('runs the version the workspace pinned, not the one the machine has', async () => {
    const cwd = await workspace('nx', NX);
    const elsewhere = await workspace('nx', '#!/bin/sh\necho \'["everything"]\'\n');

    const path = process.env['PATH'];
    process.env['PATH'] = `${join(elsewhere, 'node_modules', '.bin')}:${path ?? ''}`;

    try {
      // A globally installed tool of another major answers about a workspace it
      // does not understand, in a shape this cannot parse or — worse — can.
      const affected = await affectedProjects({ source: { tool: 'nx' }, base: 'main', cwd });
      expect(affected.names).toEqual(['app', 'design-system']);
    } finally {
      if (path === undefined) delete process.env['PATH'];
      else process.env['PATH'] = path;
    }
  });
});
