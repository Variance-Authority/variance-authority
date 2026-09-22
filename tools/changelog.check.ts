import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — a sibling tool, imported the way the other checks import theirs.
import { LOCKSTEP, ROOT, changelogs, tidy } from './changelog-tidy.mjs';

/**
 * The changelogs carry what somebody wrote, and nothing a generator inferred.
 *
 * `tools/markdown.ts` exempts `CHANGELOG.md` from every prose rule, on the
 * grounds that generated output cannot answer for a standard a person writes to.
 * That exemption is why this is worth checking at all: nothing else in the
 * repository reads these files, so the twelve packages whose whole 0.1.1 entry
 * was `Updated dependencies` reached the registry that way without a single
 * gate having an opinion.
 *
 * The fix is a generator that produces the right thing —
 * `tools/changelog-tidy.mjs`, run from `release:version`. This is what notices
 * when a release was versioned some other way, which is the only way the
 * bookkeeping can come back.
 */
describe('a published changelog', () => {
  const written = changelogs().filter((one: { at: string }) => existsSync(one.at));

  // A release that wrote no changelog at all, or a walk that found no packages,
  // would otherwise pass everything below by having nothing to assert on. Not
  // one per package: a package added between releases has no changelog yet, and
  // that is the correct state rather than a defect to report.
  it('is found at all', () => {
    expect(written.length).toBeGreaterThan(0);
  });

  it.each(written)('$name carries no dependency bookkeeping', ({ at }: { at: string }) => {
    const text = readFileSync(at, 'utf8');
    expect(tidy(text), 'run `node tools/changelog-tidy.mjs`').toBe(text);
  });

  // The three `sense-<platform>` packages are the only names here carrying
  // digits, and they first entered a dependency list at 0.5.6 — where a name
  // class of letters alone ended the block at the first of them and published
  // every sibling under it as bookkeeping.
  it('removes a block whose first sibling is a platform package', () => {
    const generated = [
      '# x',
      '',
      '## 0.5.6',
      '',
      '### Patch Changes',
      '',
      '- Updated dependencies [9e1b8ef]',
      '  - @variance-authority/sense-darwin-arm64@0.5.6',
      '  - @variance-authority/core@0.5.6',
      '',
      '## 0.5.5',
      '',
      'Something a person wrote.',
      '',
    ].join('\n');

    expect(tidy(generated)).toBe(
      `# x\n\n## 0.5.6\n\n${LOCKSTEP}\n\n## 0.5.5\n\nSomething a person wrote.\n`,
    );
  });

  // A changeset versioned before it is committed has no commit to name, so the
  // header arrives without its hash. That is every release versioned from a
  // machine rather than from the version pull request.
  it('removes a block whose header carries no hash', () => {
    const generated = ['# x', '', '## 0.5.7', '', '### Patch Changes', '', '- Updated dependencies', '  - @variance-authority/core@0.5.7', '', '## 0.5.6', '', 'Something a person wrote.', ''].join('\n');

    expect(tidy(generated)).toBe(
      `# x\n\n## 0.5.7\n\n${LOCKSTEP}\n\n## 0.5.6\n\nSomething a person wrote.\n`,
    );
  });

  // A header removed by an earlier run leaves its siblings behind, and a rule
  // that needs to have just seen one can never reach them again.
  it('removes siblings their header no longer stands above', () => {
    const orphaned = ['# x', '', '## 0.5.7', '', '### Patch Changes', '', '  - @variance-authority/sense@0.5.7', '', '## 0.5.6', '', 'Something a person wrote.', ''].join('\n');

    expect(tidy(orphaned)).toBe(
      `# x\n\n## 0.5.7\n\n${LOCKSTEP}\n\n## 0.5.6\n\nSomething a person wrote.\n`,
    );
  });

  // The generator only helps where it runs, and `release:version` is the one
  // command that reaches these files — including in CI, where the version pull
  // request is written.
  it('is tidied by the command that writes it', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(manifest.scripts['release:version']).toContain('tools/changelog-tidy.mjs');
  });
});
