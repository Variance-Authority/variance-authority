import { describe, expect, it } from 'vitest';
import { mergeSourceIndexes, overlaySourceIndex, resolveSource } from './source.js';

const scan = {
  Button: [
    { file: 'src/ds/button.tsx', line: 3, via: 'function' as const },
    { file: 'src/legacy/button.tsx', line: 9, via: 'const' as const },
  ],
  Card: [{ file: 'src/ds/card.tsx', line: 1, via: 'function' as const }],
};

describe('overlaySourceIndex', () => {
  it('replaces the refs of a name the overlay holds and keeps the rest', () => {
    const engine = { Button: [{ file: 'src/ds/button.tsx', line: 3, via: 'engine' as const }] };
    const index = overlaySourceIndex(scan, engine);
    expect(index['Button']).toEqual(engine.Button);
    expect(index['Card']).toEqual(scan.Card);
  });

  it('turns an ambiguous name into a resolved one, which a merge cannot', () => {
    const engine = { Button: [{ file: 'src/ds/button.tsx', line: 3, via: 'engine' as const }] };
    expect(resolveSource('Button', scan)?.ambiguous).toBe(true);
    expect(resolveSource('Button', overlaySourceIndex(scan, engine))?.ambiguous).toBe(false);
    expect(resolveSource('Button', mergeSourceIndexes([scan, engine]))?.ambiguous).toBe(true);
  });

  it('adds a name the scan never saw', () => {
    const engine = { Vendor: [{ file: 'node_modules/lib/index.js', line: 1, via: 'engine' as const }] };
    expect(overlaySourceIndex(scan, engine)['Vendor']).toEqual(engine.Vendor);
  });
});
