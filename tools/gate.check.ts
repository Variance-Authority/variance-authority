import { describe, expect, it } from 'vitest';
import { gatedCalls } from './gate.mjs';

/**
 * The push gate refuses only what it gates: `git push` as the subcommand and
 * `gh pr create`, each in the directory it acts in. A command that only spells
 * the word is not a push, so the gate never blocks the commit that would let
 * a wave be stamped.
 */
describe('gatedCalls', () => {
  it.each([
    'git commit -m "push the gate"',
    "git commit -m 'fix push hook'",
    'git stash push -u -m tag',
    'git subtree push --prefix x origin y',
    'git log --grep push',
    'echo git push',
    'git push --delete origin x',
    'git push origin --tags',
  ])('lets %s through', (command) => {
    expect(gatedCalls(command, '/repo')).toEqual([]);
  });

  it.each([
    ['git push', ['/repo']],
    ['git -c a=b push -u origin x', ['/repo']],
    ['git -C /other push', ['/other']],
    ['cd /other && git push', ['/other']],
    ['(cd /other && git push)', ['/other']],
    ['cd /tmp && git -C /other push', ['/other']],
    ['cd /other && gh pr create --fill', ['/other']],
  ])('gates %s', (command, dirs) => {
    expect(gatedCalls(command, '/repo')).toEqual(dirs);
  });
});
