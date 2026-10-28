import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { nativeBuildInputs } from '../packages/sense/native/build-inputs.mjs';

const made: string[] = [];
afterEach(() => { for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'va-native-inputs-'));
  made.push(root);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  mkdirSync(join(root, 'packages/sense/native'), { recursive: true });
  writeFileSync(join(root, 'packages/sense/native/Cargo.toml'), '[package]\n');
  writeFileSync(join(root, 'packages/sense/record-layout.json'), '{}\n');
  git('add', '.'); git('commit', '-qm', 'base');
  return { root, git };
}

describe('the native binary includes the external record layout', () => {
  it('changes identity after a layout-only commit even though the crate tree is unchanged', () => {
    const { root, git } = fixture();
    const before = nativeBuildInputs(root)!;
    writeFileSync(join(root, 'packages/sense/record-layout.json'), '{"run":2}\n');
    git('add', '.'); git('commit', '-qm', 'layout');
    const after = nativeBuildInputs(root)!;
    expect(after.tree).toBe(before.tree);
    expect(after.identity).not.toBe(before.identity);
  });
  it('does not stamp an uncommitted layout or crate edit as a clean build', () => {
    for (const file of ['record-layout.json', 'native/Cargo.toml']) {
      const { root } = fixture();
      expect(nativeBuildInputs(root)?.clean).toBe(true);
      writeFileSync(join(root, 'packages/sense', file), 'edited\n');
      expect(nativeBuildInputs(root)?.clean).toBe(false);
    }
  });
  it('allows an unrelated uncommitted edit and refuses a directory without git history', () => {
    const { root } = fixture();
    writeFileSync(join(root, 'notes.txt'), 'unrelated');
    expect(nativeBuildInputs(root)?.clean).toBe(true);
    const empty = mkdtempSync(join(tmpdir(), 'va-native-no-git-'));
    made.push(empty);
    expect(nativeBuildInputs(empty)).toBeUndefined();
  });
});
