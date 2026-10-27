import { describe, expect, it } from 'vitest';
import { packageOwner } from './coverage-source.js';

describe('the package that holds a file', () => {
  it('is the deepest listed package around it, so a package nested in another owns its own files', () => {
    const ownerOf = packageOwner(['libs/ui', 'libs/ui/icons', 'libs/uikit']);

    expect(ownerOf('libs/ui/src/button.ts')).toBe('libs/ui');
    expect(ownerOf('libs/ui/icons/star.ts')).toBe('libs/ui/icons');
    expect(ownerOf('libs/uikit/index.ts')).toBe('libs/uikit');
  });

  it('is the root for a file outside every listed package', () => {
    expect(packageOwner(['libs/ui'])('tools/build.ts')).toBe('.');
  });
});
