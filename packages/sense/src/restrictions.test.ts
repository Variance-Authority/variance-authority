import { describe, expect, it } from 'vitest';
import { relationBetween, restrictedImports, type RuleFile } from './restrictions.js';

const record = (file: string, ...targets: string[]) => ({ file, edges: targets.map((to) => ({ to, kind: 'value' as const })) });

/** `packages/core` is closed to the outside; inside it everything may reach everything. */
const fenced: RuleFile[] = [
  {
    directory: 'packages/core',
    rules: [
      { from: '.', to: '.', type: 'allowed' },
      { to: '.', type: 'restricted', message: 'core is internal' },
    ],
  },
];

describe('relationBetween', () => {
  it('lets a folder reach itself and closes it to the outside, first match winning', () => {
    expect(relationBetween(fenced, 'packages/core/a.ts', 'packages/core/b.ts')?.rule.type).toBe('allowed');
    expect(relationBetween(fenced, 'packages/app/a.ts', 'packages/core/b.ts')?.rule.message).toBe('core is internal');
  });

  it('decides nothing for an import no rule names', () => {
    expect(relationBetween(fenced, 'packages/app/a.ts', 'packages/app/b.ts')).toBeUndefined();
  });

  it('reads the rules of a file above both ends, and lets the deeper file override', () => {
    const files: RuleFile[] = [
      { directory: '', rules: [{ from: '*', to: '**/__tests__/**', type: 'restricted', message: 'do not import tests' }] },
      { directory: 'packages/web', rules: [{ from: '.', to: '**/__tests__/**', type: 'allowed' }] },
    ];
    expect(relationBetween(files, 'packages/api/a.ts', 'packages/api/__tests__/x.ts')?.rule.type).toBe('restricted');
    expect(relationBetween(files, 'packages/web/a.test.ts', 'packages/web/__tests__/x.ts')?.rule.type).toBe('allowed');
  });

  it('matches a glob against the path or any folder above it', () => {
    const files: RuleFile[] = [{ directory: '', rules: [{ from: 'pages/*', to: 'pages/*', type: 'restricted' }] }];
    expect(relationBetween(files, 'pages/a/index.ts', 'pages/b/index.ts')?.rule.type).toBe('restricted');
  });
});

describe('restrictedImports', () => {
  it('lists each restricted import once, in code-unit order, with the rule file that decided it', () => {
    const records = [
      record('packages/app/z.ts', 'packages/core/a.ts', 'packages/core/a.ts'),
      record('packages/app/a.ts', 'packages/core/a.ts', 'packages/app/z.ts'),
      record('packages/core/a.ts', 'packages/core/b.ts'),
    ];

    expect(restrictedImports(records, fenced)).toEqual([
      { from: 'packages/app/a.ts', to: 'packages/core/a.ts', message: 'core is internal', directory: 'packages/core' },
      { from: 'packages/app/z.ts', to: 'packages/core/a.ts', message: 'core is internal', directory: 'packages/core' },
    ]);
  });

  it('finds nothing without rules', () => {
    expect(restrictedImports([record('a.ts', 'b.ts')], [])).toEqual([]);
  });
});
