/**
 * Browser entry point: one case per page load, selected by query string.
 *
 * `?subject=card&variant=css-accretion` renders that pair into `#subject` and then
 * sets `data-va-ready` on `<html>`. A Playwright test waits for that attribute and
 * collects — no framework plumbing, no test runner in the page, and no polling for
 * a render that has already finished synchronously.
 *
 * One case per load rather than a gallery, because `renderCase` installs
 * document-level state: a second subject sharing the document would share the
 * first's noise sheets and its accreting CSS-in-JS tag, and a corpus about
 * cross-subject CSS contamination cannot afford to contaminate its own cases.
 */

import { CORPUS } from './corpus.js';
import { renderCase } from './render.js';
import { SUBJECT_IDS } from './subjects.js';
import type { SubjectId } from './subjects.js';
import { VARIANT_IDS } from './variants.js';
import type { VariantId } from './variants.js';

function isSubject(value: string | null): value is SubjectId {
  return value !== null && (SUBJECT_IDS as readonly string[]).includes(value);
}

function isVariant(value: string | null): value is VariantId {
  return value !== null && (VARIANT_IDS as readonly string[]).includes(value);
}

/** Renders every case as a pair of links, so the page is usable by hand too. */
function renderIndex(target: HTMLElement): void {
  const rows = CORPUS.map((c) => {
    const link = (variant: string) =>
      `<a href="?subject=${c.subject}&variant=${variant}">${variant}</a>`;
    const flag = c.contested === undefined ? '' : ' <strong>[contested]</strong>';
    return `<li><code>${c.id}</code> — ${c.expect}${flag}<br>${link(c.baseVariant)} vs ${link(
      c.perturbedVariant,
    )}</li>`;
  });
  target.innerHTML = `<h1>kitchen-sink corpus</h1><ol>${rows.join('')}</ol>`;
}

export function main(): void {
  const params = new URLSearchParams(window.location.search);
  const subject = params.get('subject');
  const variant = params.get('variant');
  const target = document.getElementById('subject');
  if (target === null) throw new Error('missing #subject container');

  if (!isSubject(subject) || !isVariant(variant)) {
    renderIndex(target);
    document.documentElement.setAttribute('data-va-ready', 'index');
    return;
  }

  renderCase(target, subject, variant);
  document.documentElement.setAttribute('data-va-ready', `${subject}/${variant}`);
}

main();
