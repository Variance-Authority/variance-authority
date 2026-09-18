// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { accessibleName } from './aria.js';

/**
 * The oracle for every assertion here is Chrome's own accessibility tree, read
 * through `Accessibility.getFullAXTree` over this project's site. Two classes of
 * disagreement were measured there and both are closed below; the run that
 * followed agreed with Chrome on all 1702 named elements.
 */

function render(html: string): Element {
  document.body.innerHTML = html;
  return document.body.firstElementChild!;
}

describe('the casing a browser announces', () => {
  it('names a link by its transformed text, not by what was typed', () => {
    const link = render('<a href="#" style="text-transform: uppercase">Run less of the suite</a>');
    expect(accessibleName(link, window)).toBe('RUN LESS OF THE SUITE');
  });

  it('lowercases and capitalizes by the same rule', () => {
    const down = render('<a href="#" style="text-transform: lowercase">NEXT</a>');
    expect(accessibleName(down, window)).toBe('next');

    const up = render('<a href="#" style="text-transform: capitalize">run less</a>');
    expect(accessibleName(up, window)).toBe('Run Less');
  });

  it('transforms each run by the element that owns it', () => {
    const link = render(
      '<a href="#"><span style="text-transform: uppercase">next</span> <span>Follow the loop</span></a>',
    );
    expect(accessibleName(link, window)).toBe('NEXT Follow the loop');
  });

  it('leaves the text alone without a view, because nothing computed a value', () => {
    const link = render('<a href="#" style="text-transform: uppercase">Run less</a>');
    expect(accessibleName(link)).toBe('Run less');
  });
});

describe('roles a browser leaves unnamed', () => {
  it('gives a description no name, however much prose it holds', () => {
    const list = render('<dl><dt>Requires</dt><dd>A Playwright test and a bounded Locator.</dd></dl>');
    const [term, description] = [list.querySelector('dt')!, list.querySelector('dd')!];

    expect(accessibleName(term, window)).toBe('Requires');
    expect(accessibleName(description, window)).toBeNull();
  });

  it('gives a row no name, so a table is not read out twice', () => {
    const table = render('<table><tr><td>Argos</td><td>no</td></tr></table>');
    const row = table.querySelector('tr')!;

    expect(accessibleName(row, window)).toBeNull();
    expect(accessibleName(table.querySelector('td')!, window)).toBe('Argos');
  });

  it('still answers with a name the author wrote on one', () => {
    const list = render('<dl><dd aria-label="Requirement">A Playwright test.</dd></dl>');
    expect(accessibleName(list.querySelector('dd')!, window)).toBe('Requirement');
  });
});
