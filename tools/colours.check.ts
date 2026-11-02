import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BASELINE, COLOURS, DOMAINS, counted, packages, sites, sitesIn } from './colours.mjs';

/**
 * A specialist package keeps its colour.
 *
 * `tools/colours.mjs` says what colour each package is and why the rule exists.
 * This file holds the declarations to the packages on disk, pins what the reader
 * sees, and holds the ratchet: a new site fails and names the package that owns
 * the colour, and a site that moved home fails too, until the baseline is
 * tightened.
 *
 * ```bash
 * yarn colours --write
 * ```
 *
 * Recording a new site is not the fix. A colour finding is never set aside: the
 * specialist exposes an extension point and the package of that colour fills it.
 */

interface Site {
  readonly colour: string;
  readonly at: string;
  readonly line: number;
  readonly what: string;
}

interface Row {
  readonly colour: string;
  readonly at: string;
  readonly count: number;
}

const read = (text: string, own = 'none'): readonly string[] =>
  (sitesIn('packages/sense/src/a.ts', text, own) as readonly Site[]).map((site) => `${site.colour} ${site.what}`);

describe('the colour reader', () => {
  it("finds React's element brands named outside React, as a story tap in `sense` named them", () => {
    expect(
      read(
        [
          'export function kind(type: { $$typeof?: symbol }) {',
          "  if (type.$$typeof?.description === 'react.memo') return 'memo';",
          '  return `${String(type.$$typeof)}`;',
          '}',
        ].join('\n'),
      ),
    ).toEqual(['react $$typeof', 'react $$typeof', 'react react.memo', 'react $$typeof']);
  });

  it("finds a fiber's private fields and the devtools hook", () => {
    expect(read("const owner = (fiber: any) => fiber._debugOwner ?? globalThis['__REACT_DEVTOOLS_GLOBAL_HOOK__'];")).toEqual([
      'react _debugOwner',
      'react __REACT_DEVTOOLS_GLOBAL_HOOK__',
    ]);
  });

  it('finds an import of a domain, and of one of ours with that colour', () => {
    expect(
      read(
        [
          "import { act } from 'react-dom/test-utils';",
          "export { compose } from '@variance-authority/react';",
          "const circus = require('jest-circus');",
          "const config = await import('vitest/config');",
          "import type { Page } from '@playwright/test';",
        ].join('\n'),
      ),
    ).toEqual([
      'react react-dom/test-utils',
      'react @variance-authority/react',
      'jest jest-circus',
      'vitest vitest/config',
      'playwright @playwright/test',
    ]);
  });

  it("finds TypeScript's import forms, a resolve and a mock of a domain", () => {
    expect(
      read(
        [
          "import globals = require('@jest/globals');",
          "declare module 'react' {}",
          "type FC = import('react').FC;",
          "const entry = require.resolve('vitest');",
          "vi.mock('react-dom');",
        ].join('\n'),
      ),
    ).toEqual(['jest @jest/globals', 'react react', 'react react', 'vitest vitest', 'react react-dom']);
  });

  it('finds an import of a mixed package, which carries every colour it composes', () => {
    expect(read("import { tools } from '@variance-authority/mcp/tools';")).toEqual(['mixed @variance-authority/mcp/tools']);
  });

  it('leaves a comment, which may say what another domain does', () => {
    expect(read("// React's `_debugOwner` says who rendered it; `react.memo` wraps it.\nexport const x = 1;")).toEqual([]);
  });

  it('leaves a name that only starts like a private one', () => {
    expect(read("const reactive = 'reactor'; const $$typeOfThing = 1; import x from 'reactjs-popup';")).toEqual([]);
  });

  it('leaves a package its own colour', () => {
    expect(read("import React from 'react';\nconst brand = (x: any) => x.$$typeof;", 'react')).toEqual([]);
  });

  it('leaves a mixed package every colour', () => {
    expect(read("import 'react';\nimport 'vitest';\nconst brand = (x: any) => x.$$typeof;", 'mixed')).toEqual([]);
  });

  it('refuses a file it cannot parse rather than finding nothing in it', () => {
    expect(() => read('const = ;')).toThrow('packages/sense/src/a.ts');
  });
});

describe('every package has a colour', () => {
  const declared = Object.keys(COLOURS).sort();
  const onDisk = [...packages().values()].sort();
  const allowed = new Set(['none', 'mixed', ...Object.keys(DOMAINS)]);

  it('declares one for each package, and none for a package that is gone', () => {
    // Both directions: a package without a colour is not checked, and a
    // colour for a package that left is a declaration nobody is making.
    expect(declared).toEqual(onDisk);
  });

  it.each(Object.entries(COLOURS))('%s is %s, which is a colour', (_name, colour) => {
    expect(allowed.has(colour)).toBe(true);
  });
});

describe('specialist packages', () => {
  const found = sites() as readonly Site[];
  const now = counted(found) as readonly Row[];
  const before = JSON.parse(readFileSync(BASELINE, 'utf8')) as readonly Row[];
  const key = (row: Row): string => `${row.colour} ${row.at}`;
  const recorded = new Map(before.map((row) => [key(row), row.count]));
  const counts = new Map(now.map((row) => [key(row), row.count]));

  it('take on no colour but their own', () => {
    const grown = now.filter((row) => row.count > (recorded.get(key(row)) ?? 0));
    const report = grown
      .flatMap((row) =>
        found
          .filter((site) => site.colour === row.colour && site.at === row.at)
          .map((site) => `  ${site.at}:${site.line} ${site.what} — ${site.colour}`),
      )
      .join('\n');
    const homes = [...new Set(grown.map((row) => row.colour))]
      .map((colour) => `  ${colour}: ${homeOf(colour)}`)
      .join('\n');

    expect(
      grown.length === 0
        ? ''
        : `${grown.length} file(s) in a specialist package take on another colour:\n\n${report}\n\n` +
            `Expose an extension point here and fill it from the package of that colour:\n\n${homes}\n\n` +
            'Recording the site is not the fix. A colour finding is never set aside.',
    ).toBe('');
  });

  it('leave the baseline no longer than what it records', () => {
    const closed = before
      .filter((row) => (counts.get(key(row)) ?? 0) < row.count)
      .map((row) => `${key(row)}: ${row.count} recorded, ${counts.get(key(row)) ?? 0} now`);

    expect(
      closed.length === 0
        ? ''
        : `${closed.length} recorded row(s) moved home:\n\n  ${closed.join('\n  ')}\n\n` +
            'Tighten the ratchet with `yarn colours --write`.',
    ).toBe('');
  });

  it('are read from a repository that was actually read', () => {
    // A reader that fails by returning less would empty both lists, and an
    // empty list recorded is a check that agrees with that bug forever.
    expect(found.length + before.length).toBeGreaterThan(0);
  });
});

/** The packages that hold a colour, or what to do when none does yet. */
function homeOf(colour: string): string {
  if (colour === 'mixed') return 'import the specialist the composer uses, not the composer';
  const homes = Object.entries(COLOURS)
    .filter(([, own]) => own === colour)
    .map(([name]) => name);
  return homes.length === 0 ? `no package is ${colour} yet; that package is the change` : homes.join(', ');
}
