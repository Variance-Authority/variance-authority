import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { answersOf } from '../stories/answers.mjs';
import { createMemoryR2, createSqliteD1 } from '../src/testing.js';
import { createReviewClient } from '../src/ui/client.js';
import { createTribunal } from '../src/worker.js';

/**
 * The stories' answers are what this service answers today.
 *
 * The Storybook the visual gate photographs draws every page over
 * `stories/recorded/answers.json`, and a photograph of an answer the service no
 * longer gives is a baseline of a page no reviewer can reach. So the answers are
 * worked out again here, from the writes `stories/record.mjs` kept, through
 * `src/` — and a service that changes what it answers fails this file until
 * `vitest -u` writes the new answers, which the gate then photographs.
 */

const RECORDED = join(dirname(fileURLToPath(import.meta.url)), '../stories/recorded');

describe('the recording the stories replay', () => {
  it('is what the service answers to the writes it was recorded from', async () => {
    const recording = JSON.parse(readFileSync(join(RECORDED, 'writes.json'), 'utf8'));
    const { answers, images } = await answersOf(recording, (file: string) => readFileSync(join(RECORDED, 'images', file)), {
      createTribunal,
      createSqliteD1,
      createMemoryR2,
      createReviewClient,
    });

    await expect(`${JSON.stringify({ answers, images }, null, 2)}\n`).toMatchFileSnapshot(join(RECORDED, 'answers.json'));

    // An image is named for its bytes, so a name that is not on disk is an image
    // the service now serves and the recording never pushed.
    const served = Object.values(images).flatMap((subjects) =>
      Object.values(subjects as Record<string, Record<string, string>>).flatMap((kinds) => Object.values(kinds)),
    );
    expect(served.filter((file) => !existsSync(join(RECORDED, 'images', file)))).toEqual([]);
  });
});
