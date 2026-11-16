import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gitReads } from './__fixtures__/git-reads.js';
import { editsBetween, NO_EDIT, regionTouched } from './region-edit.js';
import { NO_LINE } from './written-lines.js';

describe('editsBetween', () => {
  it('is no edit between a text and itself, and reads no text for it', () => {
    expect(editsBetween('/nowhere', undefined, [])('src/a.ts', 'v1:same', 'v1:same')).toBe(NO_EDIT);
  });

  it('has no edit when a text cannot be found', () => {
    // A repository whose one commit holds neither text.
    const root = mkdtempSync(join(tmpdir(), 'variance-region-edit-'));
    try {
      execFileSync('git', ['init', '--quiet'], { cwd: root });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '--allow-empty', '--message', 'empty'], { cwd: root });
      const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
      expect(editsBetween(root, undefined, [commit])('src/a.ts', 'v1:one', 'v1:two')).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails naming the commit the texts were recorded at when the clone does not hold it, rather than finding no edit', () => {
    const root = mkdtempSync(join(tmpdir(), 'variance-region-edit-'));
    try {
      execFileSync('git', ['init', '--quiet'], { cwd: root });
      expect(() => editsBetween(root, undefined, ['0'.repeat(40)])('src/a.ts', 'v1:one', 'v1:two')).toThrow(/commit 000000000000 is not in this checkout's object store/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reads a path once at each commit, though every text it looks for turns from one commit to the other', () => {
    const root = mkdtempSync(join(tmpdir(), 'variance-region-edit-'));
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8' }).trim();
    const commitOf = (text: string): string => {
      writeFileSync(join(root, 'a.ts'), text);
      git('add', '.');
      git('commit', '--quiet', '-m', text);
      return git('rev-parse', 'HEAD');
    };
    try {
      git('init', '--quiet');
      const commits = [commitOf('export const a = 1;\n'), commitOf('export const a = 2;\n')];
      writeFileSync(join(root, 'a.ts'), 'export const a = 3;\n');
      const edits = editsBetween(root, undefined, commits);
      const reads = gitReads(() => {
        for (const file of ['a.ts', 'added-since.ts']) {
          for (const ask of [1, 2, 3, 4, 5]) expect(edits(file, `v1:before${ask}`, `v1:after${ask}`)).toBeUndefined();
        }
      });

      for (const commit of commits) {
        for (const file of ['a.ts', 'added-since.ts']) {
          expect(reads(commit, file), `${file} at ${commit}`).toBe(1);
        }
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  describe('between texts named by git', () => {
    const before = 'export const a = 1;\n';
    const after = 'export const a = 1;\nexport const b = 2;\n';
    /** A checkout whose commit holds `before` and whose working tree `after`, with git's name for each and the commit. */
    const checkout = async (check: (root: string, names: { before: string; after: string; commit: string }) => void) => {
      const root = await realpath(await mkdtemp(join(tmpdir(), 'variance-edits-between-')));
      const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8' }).trim();
      try {
        git('init', '--quiet');
        await writeFile(join(root, 'a.ts'), before);
        git('add', '.');
        git('commit', '--quiet', '-m', 'a');
        await writeFile(join(root, 'a.ts'), after);
        check(root, { before: `git:${git('rev-parse', 'HEAD:a.ts')}`, after: `git:${git('hash-object', 'a.ts')}`, commit: git('rev-parse', 'HEAD') });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    };

    it('reads the text a commit holds by its name there, and the checkout\'s by the name the source index gives it now', async () => {
      await checkout((root, { before, after, commit }) => {
        const edit = editsBetween(root, undefined, [commit], { now: (file) => (file === 'a.ts' ? after : undefined) })('a.ts', before, after);

        expect(edit?.hunks).toEqual([{ oldStart: 1, oldCount: 0, newStart: 2, newCount: 1 }]);
      });
    });

    it('has no edit for a name neither a commit nor the source index gives the file', async () => {
      await checkout((root, { before, after, commit }) => {
        expect(editsBetween(root, undefined, [commit], { now: () => undefined })('a.ts', before, after)).toBeUndefined();
        expect(editsBetween(root, undefined, [], { now: () => after })('a.ts', before, after)).toBeUndefined();
      });
    });

    it('takes a text a reader already holds by its name, reading none', () => {
      const held = new Map([['git:one', before], ['git:two', after]]);
      const edit = editsBetween('/nowhere', undefined, [], { inHand: (_, name) => held.get(name) })('a.ts', 'git:one', 'git:two');

      expect(edit?.hunks).toEqual([{ oldStart: 1, oldCount: 0, newStart: 2, newCount: 1 }]);
    });

    it('reads each text and each edit once, however often a pair is asked', () => {
      const held = new Map([['git:one', before], ['git:two', after], ['git:three', before]]);
      const looked: string[] = [];
      const edits = editsBetween('/nowhere', undefined, [], { inHand: (_, name) => (looked.push(name), held.get(name)) });

      const first = edits('a.ts', 'git:one', 'git:two');
      expect(edits('a.ts', 'git:one', 'git:two')).toBe(first);
      edits('a.ts', 'git:two', 'git:three');
      expect(looked).toEqual(['git:one', 'git:two', 'git:three']);
    });
  });
});

describe('regionTouched', () => {
  const region = (kind: string, startLine: number, endLine: number) => ({ kind, startLine, endLine });
  // Line 6 of a nine-line text rewritten in place.
  const body = { oldStart: 6, oldCount: 1, newStart: 6, newCount: 1 };

  it('touches the regions a hunk rewrote, and no region the edit only shifted or left alone', () => {
    const edit = { hunks: [{ oldStart: 1, oldCount: 0, newStart: 2, newCount: 1 }, body] };

    expect(regionTouched(region('function', 5, 7), [edit])).toBe(true);
    expect(regionTouched(region('function', 2, 4), [edit])).toBe(false);
    expect(regionTouched(region('function', 5, 7), [NO_EDIT])).toBe(false);
  });

  it('follows the region through each edit of a chain, at the lines the one before shifted it to', () => {
    const shift = { hunks: [{ oldStart: 1, oldCount: 0, newStart: 2, newCount: 3 }] };

    // 2-4 shifts to 5-7, which the rewrite of line 6 then touches.
    expect(regionTouched(region('function', 2, 4), [shift, { hunks: [body] }])).toBe(true);
    expect(regionTouched(region('function', 2, 4), [{ hunks: [body] }, shift])).toBe(false);
  });

  it('spares a region whose kind the reading says the edit does not reach, as a landing spares it', () => {
    expect(regionTouched(region('module', 1, 9), [{ hunks: [body], reading: 'bodies' }])).toBe(false);
    expect(regionTouched(region('module', 1, 9), [{ hunks: [body], reading: 'load' }])).toBe(true);
    expect(regionTouched(region('module', 1, 9), [{ hunks: [body] }])).toBe(true);
  });

  it('leaves a region with no lines of its own where it was, whatever the edit wrote', () => {
    const rewritten = { hunks: [{ oldStart: 1, oldCount: 9, newStart: 1, newCount: 9 }] };

    expect(regionTouched(region('function', NO_LINE, NO_LINE), [rewritten, rewritten])).toBe(false);
  });
});
