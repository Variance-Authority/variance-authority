import { describe, expect, it } from 'vitest';
import { specifiersIn } from './workspaces.js';

/**
 * What the declared-dependency rules read out of one file.
 *
 * The rules in `boundaries.check.ts` are only as wide as `specifiersIn`: a load
 * it does not return is a requirement no manifest is held to. CommonJS is how a
 * module loaded inside another runner's sandbox has to be written, and it loads
 * with `require`, in TypeScript as `import x = require()`.
 */
describe('specifiersIn', () => {
  it('reads a `require` call and an `import x = require()`', () => {
    const text = [
      "import globals = require('@jest/globals');",
      "const circus = require('jest-circus');",
      '',
    ].join('\n');

    expect(specifiersIn('setup.cts', text)).toEqual(expect.arrayContaining(['@jest/globals', 'jest-circus']));
  });

  it('reads a `require` in a `.cjs` and a `.ts` file, which the walk already opens', () => {
    expect(specifiersIn('loader.cjs', "module.exports = require('alpha');\n")).toEqual(['alpha']);
    expect(specifiersIn('loader.ts', "import beta = require('beta');\n")).toEqual(['beta']);
  });

  it('still reads static imports, re-exports and a literal `import()`', () => {
    const text = [
      "import a from 'alpha';",
      "export { b } from 'beta';",
      "await import('gamma');",
      '',
    ].join('\n');

    expect([...specifiersIn('module.ts', text)].sort()).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('reads no load a string or a comment only spells', () => {
    const text = ["const fixture = `require('alpha')`;", "// import beta = require('beta')", ''].join('\n');

    expect(specifiersIn('fixture.ts', text)).toEqual([]);
  });

  it('throws on a file it cannot parse rather than reading it as importing nothing', () => {
    expect(() => specifiersIn('broken.ts', "import a from 'alpha'; const = ;\n")).toThrow(/broken\.ts/);
  });
});
