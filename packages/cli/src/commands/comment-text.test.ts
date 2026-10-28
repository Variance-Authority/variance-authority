import { describe, expect, it } from 'vitest';
import { clampComment } from './comment-text.js';

const MARKER = '<!-- marker -->';
const notice = (dropped: number): string => `\n\n> ${dropped} characters are not shown.`;

describe('a comment cut to fit', () => {
  it('leaves a body that fits as it is', () => {
    expect(clampComment(`${MARKER}\nshort`, 100, notice)).toBe(`${MARKER}\nshort`);
  });

  it('keeps the marker, cuts at a line break, and says how much it cut', () => {
    const body = [MARKER, ...Array.from({ length: 50 }, (_, line) => `line ${line}`)].join('\n');

    const cut = clampComment(body, 120, notice);

    expect(cut.length).toBeLessThanOrEqual(120);
    expect(cut.startsWith(`${MARKER}\n`)).toBe(true);
    const [head, said] = cut.split('\n\n> ');
    expect(body.startsWith(head!)).toBe(true);
    expect(said).toBe(`${body.length - head!.length} characters are not shown.`);
  });

  it('closes the code fence and the folds a cut leaves open, so the notice is outside both', () => {
    const body = [
      MARKER,
      '<details><summary>More</summary>',
      '',
      '<details><summary>Moved</summary>',
      '',
      '```',
      ...Array.from({ length: 50 }, (_, line) => `  lost src/total.ts ${line}`),
      '```',
      '',
      '</details>',
      '',
      '</details>',
    ].join('\n');

    const cut = clampComment(body, 300, notice);

    expect(cut.length).toBeLessThanOrEqual(300);
    expect(cut).toMatch(/\n```\n\n<\/details>\n\n<\/details>\n\n> \d+ characters are not shown\.$/);
  });
});
