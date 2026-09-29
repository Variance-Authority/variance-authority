import { describe, expect, it } from 'vitest';
import { motionGraph } from './review-graph.js';

const region = (file: string, name: string, startLine: number) => ({ file, kind: name === '' ? 'module' : 'function', name, startLine, endLine: startLine + 1 });

describe('the motion drawn for a comment', () => {
  it('draws one edge per test file and directory, counted in functions rather than regions', () => {
    const lines = motionGraph([
      {
        file: 'src/total.test.ts',
        entered: [region('src/lib/format.ts', 'format', 1), region('src/lib/format.ts', 'format/map.arg0', 2), region('src/lib/round.ts', 'round', 1)],
        left: [region('src/total.ts', 'total', 4)],
      },
    ]);
    expect(lines).toContain('```mermaid');
    expect(lines).toContain('  t0["src/total.test.ts"] -- "+2 functions" --> d1["src/lib"]');
    expect(lines).toContain('  t0 -. "−1 function" .-> d2["src"]');
  });

  it('draws nothing when no test file moved', () => {
    expect(motionGraph([])).toEqual([]);
    expect(motionGraph([{ file: 'a.test.ts', entered: [], left: [] }])).toEqual([]);
  });

  it('writes a quote in a path as an entity, so the label stays one label', () => {
    const lines = motionGraph([{ file: 'a"b.test.ts', entered: [region('src/x.ts', '', 1)], left: [] }]);
    expect(lines.join('\n')).toContain('t0["a#34;b.test.ts"]');
  });
});
