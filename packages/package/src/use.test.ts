import { describe, expect, it } from 'vitest';
import { usageFrom } from './use.js';

describe('an import into a package the reading opens nothing of', () => {
  const importing = (specifier: string) => [
    { at: 'apps/app/src/a.ts', by: 'app', requests: [{ specifier, line: 1, names: [{ imported: 'hush', type: false, line: 1 }] }] },
  ];

  it('is past the entry of a published package whose declared entry leads to no file', () => {
    const usage = usageFrom(new Set(), importing('gone/src/hush'), { published: new Set(['gone']), unentered: new Set(), declared: new Set(['gone .']) });

    expect(usage.deep.map((held) => held.specifier)).toEqual(['gone/src/hush']);
    expect(usage.byPath).toEqual([]);
  });

  it('is of that entry, and not past it, when it names the entry the manifest declares', () => {
    const usage = usageFrom(new Set(), importing('gone'), { published: new Set(['gone']), unentered: new Set(), declared: new Set(['gone .']) });

    expect(usage.unfollowed.map((held) => held.specifier)).toEqual(['gone']);
    expect(usage.deep).toEqual([]);
  });

  it('is by path into a package that declares no entry, and not followed into a package that is neither', () => {
    const targets = { published: new Set<string>(), unentered: new Set(['kit']), declared: new Set<string>() };

    expect(usageFrom(new Set(), importing('kit/src/tax'), targets).byPath.map((held) => held.specifier)).toEqual(['kit/src/tax']);
    expect(usageFrom(new Set(), importing('react/jsx-runtime'), targets)).toMatchObject({ deep: [], byPath: [], unfollowed: [] });
  });

  it('names a file whose imports it could not all read, and keeps the ones the file does write', () => {
    const targets = { published: new Set<string>(), unentered: new Set(['kit']), declared: new Set<string>() };
    const usage = usageFrom(new Set(), importing('kit/src/tax').map((file) => ({ ...file, unknown: 'a specifier built at run time' })), targets);

    expect(usage.unreadable).toEqual(['apps/app/src/a.ts']);
    expect(usage.byPath.map((held) => held.specifier)).toEqual(['kit/src/tax']);
  });
});
