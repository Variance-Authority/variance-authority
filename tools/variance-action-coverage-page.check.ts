import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MARKER, action, git, origin, pushed, ran, stepNamed } from './variance-action-review-steps.js';

/**
 * The page `coverage-page` draws: uploaded and linked on every run, and on a
 * push to the default branch kept at `refs/coverage/<branch>`, where the site
 * reads it from.
 */

describe('the coverage page the review action draws', () => {
  it('draws the coverage page of every suite, with the packages and the tests per file, named for the review\'s suite', async () => {
    const { status, said, output } = await ran('draw the coverage page', { SUITE: 'unit' });

    expect(status).toBe(0);
    expect(said).toEqual(['coverage --packages --fan-in --format html']);
    expect(output).toBe('path=<at>/variance-coverage/variance-coverage-unit.html\n');
    expect((await ran('draw the coverage page', { SUITE: '' })).output).toBe('path=<at>/variance-coverage/variance-coverage.html\n');
  });

  it('names no page it could not draw, so nothing is uploaded and the comment posts without a link', async () => {
    const { status, output, printed } = await ran('draw the coverage page', { SUITE: 'unit' }, 1);

    expect(status).toBe(0);
    expect(output).toBe('');
    expect(printed).toContain('::warning title=coverage page not drawn::');
    expect(stepNamed('upload the coverage page').if).toContain("steps.page.outputs.path != ''");
    expect(stepNamed('upload the coverage page')['continue-on-error']).toBe(true);
    expect(stepNamed('link the coverage page').if).toContain("steps.upload-page.outputs.artifact-url != ''");
  });

  it('links the page from the review, under its marker, and from the step summary', async () => {
    const { status, review, summary } = await ran('link the coverage page', { PAGE_URL: 'https://example.test/page' }, 0, true);

    expect(status).toBe(0);
    expect(review.split('\n')[0]).toBe(MARKER);
    expect(review).toContain('[Coverage page](https://example.test/page)');
    expect(summary).toContain('[Coverage page](https://example.test/page)');
  });

  describe('the page kept at `refs/coverage/<branch>`', () => {
    const PUBLISH = 'publish the badge and the page';

    /** Publishes a page reading `body` from the review directory, where the draw step leaves it on a push to the default branch. */
    async function kept(env: Readonly<Record<string, string>>, body: string) {
      const review = await mkdtemp(join(tmpdir(), 'variance-action-page-'));
      try {
        await writeFile(join(review, 'coverage.html'), body);
        return await ran(PUBLISH, { BADGE: 'false', ...env, REVIEW: review });
      } finally {
        await rm(review, { recursive: true, force: true });
      }
    }

    it('keeps the page as the one file of a commit with no parent, replaced on each push', async () => {
      const remote = await origin();
      try {
        await kept(remote.env, '<p>first</p>');
        const { status, summary, printed } = await kept(remote.env, '<p>second</p>');

        expect(status).toBe(0);
        expect(printed).not.toContain('::warning');
        expect(git(remote.dir, 'ls-tree', '--name-only', 'refs/coverage/main')).toBe('coverage.html');
        expect(git(remote.dir, 'show', 'refs/coverage/main:coverage.html')).toBe('<p>second</p>');
        expect(git(remote.dir, 'rev-list', '--count', 'refs/coverage/main')).toBe('1');
        expect(() => git(remote.dir, 'rev-parse', '--verify', '--quiet', 'refs/badge/main')).toThrow();
        expect(summary).toContain('refs/coverage/main');
      } finally {
        await remote.done();
      }
    });

    it('is handed on with the review on a push to the default branch, so the job with `from` keeps it', async () => {
      const review = await mkdtemp(join(tmpdir(), 'variance-action-page-review-'));
      const remote = await origin();
      try {
        await ran('draw the coverage page', { SUITE: 'unit', REVIEW: review, KEEP: 'false' });
        expect(existsSync(join(review, 'coverage.html'))).toBe(false);

        await ran('draw the coverage page', { SUITE: 'unit', REVIEW: review, KEEP: 'true' });
        const { status } = await ran(PUBLISH, { ...remote.env, FROM: 'variance-review', REVIEW: review });

        expect(status).toBe(0);
        expect(git(remote.dir, 'show', 'refs/coverage/main:coverage.html')).toBe(readFileSync(join(review, 'coverage.html'), 'utf8').trim());
      } finally {
        await remote.done();
        await rm(review, { recursive: true, force: true });
      }
    });

    it('leaves the page to the newer commit\'s run when the branch has moved past this one, and says so', async () => {
      const remote = await origin();
      try {
        await kept(remote.env, '<p>first</p>');
        const held = git(remote.dir, 'rev-parse', 'refs/coverage/main');
        pushed(remote.dir, 'newer');

        const { status, printed } = await kept(remote.env, '<p>older</p>');

        expect(status).toBe(0);
        expect(printed).toContain('::warning title=coverage page not kept::');
        expect(git(remote.dir, 'rev-parse', 'refs/coverage/main')).toBe(held);
      } finally {
        await remote.done();
      }
    });

    it('warns and fails nothing when the push is refused', async () => {
      const remote = await origin();
      try {
        const { status, printed } = await kept({ ...remote.env, GITHUB_REPOSITORY: 'elsewhere' }, '<p>page</p>');

        expect(status).toBe(0);
        expect(printed).toContain('::warning title=coverage page not kept::');
      } finally {
        await remote.done();
      }
    });

    it('is drawn into the review only on a push to the default branch, and published with the badge, before a failure can skip it', () => {
      expect(stepNamed('draw the coverage page').env?.['KEEP']).toBe(
        "${{ github.event_name == 'push' && github.ref == format('refs/heads/{0}', github.event.repository.default_branch) }}",
      );
      expect(stepNamed(PUBLISH).if).toContain("inputs.coverage-page == 'true'");
      const names = action().runs.steps.map((step) => step.name);
      expect(names.indexOf('draw the coverage page')).toBeLessThan(names.indexOf('hand the review on'));
      expect(names.indexOf(PUBLISH)).toBeLessThan(names.indexOf('fail on what the review counted'));
    });
  });
});
