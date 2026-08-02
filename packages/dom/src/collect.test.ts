// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { normalize, diffSnapshots, type Viewport } from '@variance-authority/core';
import { collect } from './collect.js';

/**
 * The claim under test is ADR-0003's headline, and it is the one M0 could not
 * check until a collector existed:
 *
 * > a Storybook canvas carries Storybook's chrome CSS, the preview reset, the
 * > whole design system, and a CSS-in-JS `<style>` accreting a rule for every
 * > story rendered since page load — and none of it may invalidate a baseline.
 *
 * These tests build that page, grow the irrelevant CSS between runs, and assert
 * the hash does not move. Each is paired with a control that must move, because
 * a collector that returned nothing would satisfy every stability assertion here.
 */

const VIEWPORT: Viewport = {
  width: 1280,
  height: 720,
  deviceScaleFactor: 1,
  colorScheme: 'light',
};

const options = {
  subject: { id: 'story:button--primary', kind: 'fixture' as const },
  viewport: VIEWPORT,
  engine: 'jsdom@test',
  fonts: ['Inter/400/normal/deadbeef'],
};

function render(html: string, css: string): Element {
  document.head.innerHTML = `<style>${css}</style>`;
  document.body.innerHTML = `<div id="canvas">${html}</div>`;
  return document.getElementById('canvas')!;
}

function hashOf(html: string, css: string): string {
  return normalize(collect(render(html, css), options)).renderHash;
}

/** Storybook's own chrome, the preview reset, and dead design-system rules. */
const IRRELEVANT_CSS = `
  .sb-show-main { padding: 1rem; background: #fff; }
  .sb-nav a { color: #1ea7fd; text-decoration: none; }
  #storybook-root { min-height: 100vh; }
  .sidebar-item[data-selected="true"] { font-weight: 700; }
  html, body { margin: 0; -webkit-font-smoothing: antialiased; }
  .legacy-alert { border: 2px dashed red; }
  .u-mt-1 { margin-top: 4px; } .u-mt-2 { margin-top: 8px; } .u-mt-3 { margin-top: 12px; }
`;

/** Rules for stories rendered earlier in this page's life, still in the sheet. */
function accretedCss(generation: number): string {
  let css = '';
  for (let i = 0; i < generation; i += 1) {
    css += `.css-old${i} { color: rgb(${i % 255} 0 0); padding: ${i}px; }\n`;
    css += `.Card_root__h${i} { border-radius: ${i}px; }\n`;
  }
  return css;
}

const SUBJECT_CSS = `.btn { color: #0000ff; padding-top: 8px; }`;
const SUBJECT_HTML = `<button class="btn">Save</button>`;

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe('CSS applicability pruning', () => {
  it('is unmoved by a page full of CSS that matches nothing in the subject', () => {
    const bare = hashOf(SUBJECT_HTML, SUBJECT_CSS);
    const noisy = hashOf(SUBJECT_HTML, `${IRRELEVANT_CSS}\n${SUBJECT_CSS}`);

    expect(noisy).toBe(bare);
  });

  it('is unmoved as accreted CSS-in-JS keeps growing between runs', () => {
    // The failure this prevents: every story rendered adds rules to a shared
    // sheet, so without pruning a baseline decays simply by being run later.
    const first = hashOf(SUBJECT_HTML, `${accretedCss(5)}\n${SUBJECT_CSS}`);
    const later = hashOf(SUBJECT_HTML, `${accretedCss(500)}\n${SUBJECT_CSS}`);

    expect(later).toBe(first);
  });

  it('still reacts to a rule that does apply', () => {
    const before = hashOf(SUBJECT_HTML, `${IRRELEVANT_CSS}\n.btn { color: #0000ff; }`);
    const after = hashOf(SUBJECT_HTML, `${IRRELEVANT_CSS}\n.btn { color: #ff0000; }`);

    expect(after).not.toBe(before);
  });

  it('prunes far more rules than it keeps', () => {
    const root = render(SUBJECT_HTML, `${IRRELEVANT_CSS}\n${accretedCss(100)}\n${SUBJECT_CSS}`);
    const capture = collect(root, options);

    const kept = countRules(capture.root);
    expect(kept).toBeLessThan(10);
  });
});

describe('hashed class-name churn', () => {
  it('is unmoved when a generated class name changes but its declarations do not', () => {
    const styled = (hash: string) =>
      hashOf(`<button class="css-${hash}">Save</button>`, `.css-${hash} { color: #0000ff; }`);

    expect(styled('9z8y7x')).toBe(styled('1a2b3c'));
  });

  it('still reacts when the declaration behind the generated name changes', () => {
    const styled = (hash: string, color: string) =>
      hashOf(`<button class="css-${hash}">Save</button>`, `.css-${hash} { color: ${color}; }`);

    expect(styled('1a2b3c', '#0000ff')).not.toBe(styled('9z8y7x', '#ff0000'));
  });
});

describe('generated id churn', () => {
  const form = (suffix: string) => `
    <label for="i-${suffix}">Email</label>
    <input id="i-${suffix}" type="email" aria-describedby="h-${suffix}">
    <p id="h-${suffix}">We never share it.</p>
  `;

  it('is unmoved by a useId renumbering', () => {
    expect(hashOf(form('r7'), '')).toBe(hashOf(form('r0'), ''));
  });

  it('still reacts when the association actually breaks', () => {
    const broken = `
      <label for="nope">Email</label>
      <input id="i-r0" type="email" aria-describedby="h-r0">
      <p id="h-r0">We never share it.</p>
    `;
    expect(hashOf(broken, '')).not.toBe(hashOf(form('r0'), ''));
  });
});

describe('cascade behaviour on a real DOM', () => {
  it('discards a declaration that loses to a more specific rule', () => {
    const contested = hashOf(
      `<button class="btn" id="save">Save</button>`,
      `.btn { color: #0000ff; } #save { color: #ff0000; }`,
    );
    const uncontested = hashOf(
      `<button class="btn" id="save">Save</button>`,
      `#save { color: #ff0000; }`,
    );

    expect(contested).toBe(uncontested);
  });

  it('reads a shorthand and its longhands as the same declaration', () => {
    const short = hashOf(SUBJECT_HTML, `.btn { margin: 4px 8px; }`);
    const long = hashOf(
      SUBJECT_HTML,
      `.btn { margin-top: 4px; margin-right: 8px; margin-bottom: 4px; margin-left: 8px; }`,
    );

    expect(short).toBe(long);
  });
});

describe('media conditions', () => {
  it('applies a matching breakpoint', () => {
    const narrow = hashOf(SUBJECT_HTML, `@media (min-width: 2000px) { .btn { color: red; } }`);
    const wide = hashOf(SUBJECT_HTML, `@media (min-width: 800px) { .btn { color: red; } }`);

    // The declared viewport is 1280px wide, so only the second rule applies.
    expect(narrow).not.toBe(wide);
  });

  it('does not depend on window.matchMedia, which jsdom stubs to false', () => {
    // If matchMedia were consulted, this rule would be dropped and the hash
    // would equal the no-CSS case — a snapshot of the wrong breakpoint.
    const withRule = hashOf(SUBJECT_HTML, `@media (min-width: 800px) { .btn { color: red; } }`);
    const withoutRule = hashOf(SUBJECT_HTML, ``);

    expect(withRule).not.toBe(withoutRule);
  });
});

describe('ARIA extraction', () => {
  it('records role, name, and state from native markup', () => {
    const root = render(
      `<input id="a" type="checkbox" checked aria-describedby="d"><p id="d">hint</p>`,
      '',
    );
    const snapshot = normalize(collect(root, options));
    const input = snapshot.root.children[0]!;

    expect(input.role).toBe('checkbox');
    expect(input.state?.['checked']).toBe(true);
  });

  it('reads a native label as the accessible name', () => {
    const root = render(`<label for="e">Email</label><input id="e" type="email">`, '');
    const snapshot = normalize(collect(root, options));
    const input = snapshot.root.children.find((child) => child.tag === 'input')!;

    expect(input.name).toBe('Email');
  });
});

describe('profile detection', () => {
  it('declares jsdom, because this host has no layout engine', () => {
    const capture = collect(render(SUBJECT_HTML, SUBJECT_CSS), options);

    expect(capture.profile.id).toBe('jsdom');
    expect(capture.profile.layout).toBe(false);
  });

  it('reports geometry as unobserved rather than passing it', () => {
    const before = normalize(collect(render(SUBJECT_HTML, SUBJECT_CSS), options));
    const after = normalize(collect(render(SUBJECT_HTML, SUBJECT_CSS), options));

    expect(diffSnapshots(before, after).unobserved).toContain('geometry');
  });

  it('warns when font content hashes were not supplied', () => {
    const { fonts: _omitted, ...withoutFonts } = options;
    const capture = collect(render(SUBJECT_HTML, SUBJECT_CSS), withoutFonts);

    expect(capture.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'unverified-fonts' }),
    );
  });
});

describe('text handling', () => {
  it('ignores how much whitespace separates two elements', () => {
    const oneSpace = hashOf(`<p><span>a</span> <span>b</span></p>`, '');
    const reindented = hashOf(`<p><span>a</span>\n\t\t<span>b</span></p>`, '');

    expect(reindented).toBe(oneSpace);
  });

  it('treats leading and trailing whitespace inside a block as significant', () => {
    // Honest about a limit rather than asserting a convenience. In a block
    // formatting context these collapse away and the two render identically; in
    // an inline context they do not. Telling them apart needs a layout engine,
    // which this profile does not have, so the declared-only tier over-reports.
    // Under a chromium profile this is decidable and should be revisited.
    const padded = hashOf(`<p>\n  <span>a</span> <span>b</span>\n</p>`, '');
    const tight = hashOf(`<p><span>a</span> <span>b</span></p>`, '');

    expect(padded).not.toBe(tight);
  });

  it('notices whitespace between inline elements disappearing', () => {
    // `<span>a</span> <span>b</span>` renders "a b"; without the space it reads
    // "ab". Dropping whitespace-only text nodes as "just formatting" would
    // report that visible change as unchanged.
    const spaced = hashOf(`<p><span>a</span> <span>b</span></p>`, '');
    const joined = hashOf(`<p><span>a</span><span>b</span></p>`, '');

    expect(joined).not.toBe(spaced);
  });

  it('notices prose runs being reordered', () => {
    // Folding text into its parent would report this as no change.
    const before = hashOf(`<p>Hello <b>world</b></p>`, '');
    const after = hashOf(`<p><b>world</b> Hello</p>`, '');

    expect(after).not.toBe(before);
  });
});

function countRules(node: { matchedRules: readonly unknown[]; children: readonly unknown[] }): number {
  let total = node.matchedRules.length;
  for (const child of node.children) {
    total += countRules(child as Parameters<typeof countRules>[0]);
  }
  return total;
}
