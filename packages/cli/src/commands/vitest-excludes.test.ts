import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { selectionNotes, skippableTests } from './select.js';
import { vitestExclusions, vitestExcludes } from './vitest-excludes.js';

/** A root with a vitest manifest of `manifest`'s text installed, or none at all. */
function rootWith(manifest?: string): string {
  const root = mkdtempSync(join(tmpdir(), 'va-vitest-excludes-'));
  writeFileSync(join(root, 'package.json'), '{"name":"fixture"}\n');
  if (manifest !== undefined) {
    mkdirSync(join(root, 'node_modules', 'vitest'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'vitest', 'package.json'), manifest);
  }
  return root;
}

describe('the exclusion form is read from the installed vitest', () => {
  it('is relative under vitest 2, whose glob matches no absolute ignore', () => {
    expect(vitestExcludes(rootWith('{"name":"vitest","version":"2.1.9"}'))).toBe('relative');
  });

  it('is absolute from vitest 3 on, which a workspace of projects needs', () => {
    expect(vitestExcludes(rootWith('{"name":"vitest","version":"3.0.0"}'))).toBe('absolute');
    expect(vitestExcludes(rootWith('{"name":"vitest","version":"4.1.11"}'))).toBe('absolute');
  });

  it('is not read when no vitest resolves, or its manifest names no version or is not JSON', () => {
    expect(vitestExcludes(rootWith())).toBeUndefined();
    expect(vitestExcludes(rootWith('{"name":"vitest"}'))).toBeUndefined();
    expect(vitestExcludes(rootWith('{'))).toBeUndefined();
  });

  it('says on stderr that the form was assumed when it was not read', () => {
    const root = rootWith();
    const selection = skippableTests({
      at: join(root, 'coverage.bin'),
      commit: 'c0ffee',
      ground: {
        kind: 'read',
        narrowing: { whole: ['a.test.ts', 'b.test.ts'], entered: ['b.test.ts'], because: [], stale: [], unread: [] },
      },
    });

    expect(selectionNotes(selection, { vitestAt: root })).toContain(`no vitest resolves from ${root}`);
    expect(selectionNotes(selection)).not.toContain('no vitest resolves');
  });
});

describe('an exclusion names the one file the journal names', () => {
  it('escapes each glob character, in either form', () => {
    const skip = ['app/(shop)/cart[1].test.ts', 'test/a{b,c}+@!?*|.test.ts'];

    expect(vitestExclusions(skip, '/repo', 'relative')).toEqual([
      '--exclude=app/\\(shop\\)/cart\\[1\\].test.ts',
      '--exclude=test/a\\{b,c\\}\\+\\@\\!\\?\\*\\|.test.ts',
    ]);
    expect(vitestExclusions(skip, '/repo', 'absolute')[0]).toBe('--exclude=/repo/app/\\(shop\\)/cart\\[1\\].test.ts');
  });
});
