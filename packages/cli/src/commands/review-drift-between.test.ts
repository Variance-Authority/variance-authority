import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { relationsOfFiles } from '@variance-authority/core/relate';
import { describe, expect, it } from 'vitest';
import { movedBetweenOf } from './review-drift.js';

/**
 * A mainline record at an earlier commit stands in for the merge base's only
 * when the commits between move nothing the run rests on, read off those
 * commits alone, never off the checkout the change left.
 */

const lock = (lodash: string, ms: string) =>
  `# yarn lockfile v1\n\n\nlodash@^4.17.21:\n  version "${lodash}"\n  resolved "https://example.test/lodash.tgz#${lodash}"\n  integrity sha512-${lodash}\n\nms@^2.1.0:\n  version "${ms}"\n  resolved "https://example.test/ms.tgz#${ms}"\n  integrity sha512-${ms}\n`;

/** Commit A publishes the record, commit B upgrades lodash, and the checkout writes `checkout` over the lockfile. */
function mainline(checkout: string) {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'va-drift-between-')));
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' }).trim();
  git('init', '-q');
  writeFileSync(join(repo, 'yarn.lock'), lock('4.17.21', '2.1.0'));
  git('add', '.');
  git('commit', '-qm', 'A');
  const a = git('rev-parse', 'HEAD');
  writeFileSync(join(repo, 'yarn.lock'), lock('4.17.22', '2.1.0'));
  git('commit', '-qam', 'B');
  const b = git('rev-parse', 'HEAD');
  writeFileSync(join(repo, 'yarn.lock'), checkout);
  return { repo, a, b };
}

const RELATIONS = relationsOfFiles([{ file: 'src/a.ts' }]);

describe('the commits between a mainline record and the merge base', () => {
  it('name the install they moved, whatever the change left in the checkout', async () => {
    // The change upgrades `ms` and puts lodash back where the record ran it.
    const { repo, a, b } = mainline(lock('4.17.21', '2.1.3'));

    const moved = await movedBetweenOf(repo, undefined, RELATIONS, a, b, [], ['yarn.lock']);

    expect(moved).toMatch(/lodash/);
    expect(moved).not.toMatch(/\bms\b/);
  });

  it('move nothing when only the change touched the install', async () => {
    const { repo, a } = mainline(lock('4.17.21', '2.1.3'));

    expect(await movedBetweenOf(repo, undefined, RELATIONS, a, a, [], [])).toBeUndefined();
  });

  it('name a `before` the record\'s commit declared differently from the merge base', async () => {
    const { repo, a, b } = mainline(lock('4.17.22', '2.1.0'));

    expect(await movedBetweenOf(repo, undefined, RELATIONS, a, b, ['src/a.ts'], [])).toBe('declared `before` differently');
  });
});
