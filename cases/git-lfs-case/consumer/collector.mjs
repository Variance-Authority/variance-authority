import { readFile } from 'node:fs/promises';

/**
 * One subject, a coloured box whose colour is read from `swatch.txt`.
 *
 * The document is written by hand rather than acquired, because what this case
 * asserts is where the image goes and what comes back — git-lfs's half — and an
 * acquisition library would add a dependency without adding a question. Editing
 * `swatch.txt` moves the document, which is what makes a run look a baseline up.
 */

const VIEWPORT = { width: 200, height: 100, deviceScaleFactor: 1, colorScheme: 'light' };

export default async function collector({ plan }) {
  return {
    async plan() {
      return plan;
    },

    async collect({ subject }) {
      const colour = (await readFile(new URL('./swatch.txt', import.meta.url), 'utf8')).trim();
      return {
        ok: true,
        document: {
          documentVersion: 1,
          subject: { id: subject.id, kind: subject.kind },
          html: `<div data-va-path="0" style="width:120px;height:60px;background:${colour}"></div>`,
          frame: { html: {}, body: {}, ancestors: [] },
          css: [],
          viewport: VIEWPORT,
          inherited: {},
          fonts: [],
          diagnostics: [],
        },
      };
    },

    async close() {
      /* nothing opened */
    },
  };
}
