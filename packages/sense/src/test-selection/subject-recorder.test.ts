import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { preconditionOf } from './journal.js';
import { collectJourneys } from './journey.js';
import { narrowByExecution, selectTestFiles } from './index.js';
import { createSubjectRecorder, type SubjectRecorder } from './subject-recorder.js';
import { DOLLAR_LINE, EURO_LINE, diffAt, forget, head, inRoot } from './__fixtures__/journey-head.js';

afterEach(forget);

/** A page built without probes: the server is the only realm that reports. */
const unprobed = { evaluate: async () => undefined };

const surface = { subject: 'page', uninstrumented: 'nothing had a collector' };

/** Serve one subject's request inside the head, under the journey the recorder minted for it. */
async function visit(
  recorder: SubjectRecorder,
  collector: ReturnType<typeof collectJourneys>,
  subject: string,
  serve: () => Promise<unknown>,
): Promise<void> {
  const cookies = await recorder.join(subject, 'http://localhost:8797');
  await collector.enter(cookies.map(({ name, value }) => `${name}=${value}`).join('; '), serve);
}

describe('a run of subjects whose server reports what each ran', () => {
  it('joins a head’s account to the subject its journey was minted for, beside what the subject read', async () => {
    await inRoot(async (root) => {
      const coverageFile = resolve(root, 'coverage.bin');
      await writeFile(resolve(root, 'euros.md'), '# Euros\n', 'utf8');
      const recorder = createSubjectRecorder(surface, { root, coverageFile, heads: ['api'] });
      const collector = collectJourneys({ head: 'api', enabled: true });
      const parts = await head(root);

      await visit(recorder, collector, 'page:euros', () => parts.currency('de'));
      await recorder.note(unprobed, 'page:euros', true, {
        preconditions: [(await preconditionOf(root, 'euros.md'))!],
      });
      await visit(recorder, collector, 'page:dollars', () => parts.currency('en'));
      await recorder.note(unprobed, 'page:dollars', true);
      await collector.flush();
      await recorder.close();
      await collector.close();

      expect(await selectTestFiles(coverageFile, diffAt('currency.js', EURO_LINE))).toEqual(['page:euros']);
      expect(await selectTestFiles(coverageFile, diffAt('currency.js', DOLLAR_LINE))).toEqual(['page:dollars']);
      expect(await selectTestFiles(coverageFile, diffAt('euros.md', 1))).toEqual(['page:euros']);
    });
  });

  it('lets a refused subject keep what its server ran and never justify skipping it', async () => {
    await inRoot(async (root) => {
      const coverageFile = resolve(root, 'coverage.bin');
      const recorder = createSubjectRecorder(surface, { root, coverageFile, heads: ['api'] });
      const collector = collectJourneys({ head: 'api', enabled: true });
      const parts = await head(root);

      await visit(recorder, collector, 'page:euros', () => parts.currency('de'));
      await recorder.note(unprobed, 'page:euros', false);
      await visit(recorder, collector, 'page:dollars', () => parts.currency('en'));
      await recorder.note(unprobed, 'page:dollars', true);
      await collector.flush();
      await recorder.close();
      await collector.close();

      // Its crossings are kept, and only the finished subject is whole: the one
      // a later run may skip.
      const narrowed = await narrowByExecution(coverageFile, diffAt('currency.js', EURO_LINE));
      expect(narrowed.entered).toEqual(['page:euros']);
      expect(narrowed.whole).toEqual(['page:dollars']);
    });
  });
});
