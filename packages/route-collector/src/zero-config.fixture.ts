import type { CallSiteResolver } from '@variance-authority/core/attribute';
import type { SemanticNode, SemanticSnapshot, SourceLocation } from '@variance-authority/core/format';
import type { Plan } from './index.js';

/**
 * The component under observation, with its line numbers stated.
 *
 * Written as an array so the numbering lives in the file a reader is looking at
 * rather than in their head. `title` marks the elements because it survives
 * normalization and `data-testid` does not — the attribute allowlist admits what
 * a user can perceive, and a test hook is not that.
 */
export function appSource(lead: readonly string[]): string {
  return [
    ...lead,
    /* +1 */ 'export function Badge({ label }) {',
    /* +2 */ '  return <span title="badge">{label}</span>;',
    /* +3 */ '}',
    /* +4 */ '',
    /* +5 */ 'export function App() {',
    /* +6 */ '  return (',
    /* +7 */ '    <main id="app">',
    /* +8 */ '      <section title="panel">',
    /* +9 */ '        <Badge label="ready" />',
    /* +10 */ '      </section>',
    /* +11 */ '    </main>',
    /* +12 */ '  );',
    /* +13 */ '}',
  ].join('\n');
}

/** Where each element is written, given how many lines precede the component. */
export function writtenAt(lead: number, file: string): Record<'badge' | 'panel' | 'main', SourceLocation> {
  return {
    badge: { file, line: lead + 2, column: 10 },
    panel: { file, line: lead + 8, column: 7 },
    main: { file, line: lead + 7, column: 5 },
  };
}

/**
 * React 18 in a directory that has React 19 installed.
 *
 * An adopter writes none of this: their `react` *is* the version they depend on.
 * It is here because the fixture resolves through this repository's own install,
 * and pointing a whole second application at a second copy of node_modules would
 * test the package manager. The aliases are the shortest way to say "this run is
 * React 18" and they change nothing the mechanism can see — React 18's own
 * `jsx-dev-runtime` and `react-dom` are what load.
 */
export const REACT_18 =
  "  resolve: { alias: {\n" +
  "    react: 'react-18',\n" +
  "    'react-dom': 'react-dom-18',\n" +
  "    'react-dom/client': 'react-dom-18/client',\n" +
  "    'react/jsx-runtime': 'react-18/jsx-runtime',\n" +
  "    'react/jsx-dev-runtime': 'react-18/jsx-dev-runtime',\n" +
  '  } },\n';

export const INDEX_HTML =
  '<!doctype html><html><body><div id="root"></div>' +
  '<script type="module" src="/src/main.jsx"></script></body></html>';

export interface Fixture {
  readonly nodes: readonly SemanticNode[];
  readonly snapshot: SemanticSnapshot;
  /** The collector's resolver, because resolution is asked for and never done for you. */
  readonly callSites: CallSiteResolver;
  /**
   * What the capture came back holding: React 18's recorded location, or React
   * 19's unspent frames. The distinction is the whole reason both are tested —
   * one of them has already paid, and the other has not paid yet.
   */
  readonly carries: 'source' | 'stack';
  readonly at: Record<'badge' | 'panel' | 'main', SourceLocation>;
}

export const PLAN: Plan = {
  subjects: [{ subject: { id: 'page/app', kind: 'route' } }],
  notObserved: [],
  warnings: [],
};
