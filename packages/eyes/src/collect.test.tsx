// @vitest-environment jsdom

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { readEyesArchive } from './archive.js';
import { gatherEyesArchive, recordEyesTest, resetEyesJournals } from './collect.js';
import { watchTest } from './rtl.js';

afterEach(cleanup);

/**
 * The producing half, exercised the way a run exercises it.
 *
 * Everything here has been assertable one piece at a time since the reader was
 * written: an archive built by hand parses, a hand-built journal round-trips.
 * What was not assertable is the join — that what a React render and a real
 * query put in a log is what a reader in another process gets back. So the
 * attention in these archives is rendered, queried and clicked rather than
 * written out, and the last assertion is always against a file on disk.
 */

function SelfRemoving(): React.ReactElement {
  const [removed, setRemoved] = useState(false);
  if (removed) return <p>Removed</p>;
  return (
    <button type="button" onClick={() => setRemoved(true)}>
      Remove me
    </button>
  );
}

async function journalDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'variance-eyes-'));
}

describe('a run that records what its tests looked at', () => {
  it('reaches a reader in another process with the attribution intact', async () => {
    const directory = await journalDirectory();
    try {
      const attention = watchTest(screen, {
        id: 'collect.test.tsx > removes on click',
        title: 'removes on click',
        file: 'packages/eyes/src/collect.test.tsx',
      });
      render(<SelfRemoving />);
      const button = screen.getByRole('button', { name: 'Remove me' });
      fireEvent.click(button);
      const journal = attention.close();

      await recordEyesTest(directory, journal);
      const archive = await gatherEyesArchive(directory);
      const path = join(directory, 'eyes.json');
      await writeFile(path, `${JSON.stringify(archive, null, 2)}\n`, 'utf8');

      const read = await readEyesArchive(path);
      expect(read.eyesVersion).toBe(1);
      expect(read.tests).toHaveLength(1);
      const test = read.tests[0]!;
      expect(test).toMatchObject({
        id: 'collect.test.tsx > removes on click',
        title: 'removes on click',
        file: 'packages/eyes/src/collect.test.tsx',
        complete: true,
      });

      // The element is gone by the time the file is written, and the record of
      // what the test addressed is not.
      expect(button.isConnected).toBe(false);
      expect(test.attention.filter((entry) => entry.kind === 'rtl-query')).toMatchObject([
        {
          query: 'getByRole',
          outcome: 'resolved',
          targets: [{ nodeName: 'button', provenance: { status: 'resolved' } }],
        },
      ]);
      expect(test.attention.filter((entry) => entry.kind === 'document-event')).toMatchObject([
        { event: 'click', trusted: false, target: { nodeName: 'button' } },
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('folds one journal per worker into a single archive in id order', async () => {
    const directory = await journalDirectory();
    try {
      for (const title of ['second', 'first']) {
        const attention = watchTest(screen, { id: `suite > ${title}`, title });
        render(<SelfRemoving />);
        screen.getByRole('button', { name: 'Remove me' });
        await recordEyesTest(directory, attention.close());
        cleanup();
      }

      const archive = await gatherEyesArchive(directory);
      expect(archive.tests.map((test) => test.title)).toEqual(['first', 'second']);
      expect(archive.tests.every((test) => test.complete)).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('says a journal is partial when the log had already been drained', async () => {
    const directory = await journalDirectory();
    try {
      const attention = watchTest(screen, { id: 'suite > drained', title: 'drained' });
      render(<SelfRemoving />);
      screen.getByRole('button', { name: 'Remove me' });

      // What a reporter that flushes mid-test does, and the case a producer
      // deriving completeness from the entries in hand would get wrong: the
      // journal below is well-formed, ordered, and missing its opening.
      expect(attention.log.drain()).toHaveLength(2);
      fireEvent.click(screen.getByRole('button', { name: 'Remove me' }));

      const journal = attention.close();
      expect(journal.complete).toBe(false);
      expect(journal.complete === false && journal.because).toContain('2 attention entries');

      const path = await recordEyesTest(directory, journal);
      const read = await readEyesArchive(path);
      expect(read.tests[0]).toMatchObject({ complete: false });
      expect(read.tests[0]!.attention[0]!.sequence).toBe(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('refuses to be the second journal for one test id', async () => {
    const directory = await journalDirectory();
    try {
      const first = watchTest(screen, { id: 'suite > twice', title: 'twice' });
      await recordEyesTest(directory, first.close());

      const second = watchTest(screen, { id: 'suite > twice', title: 'twice' });
      await expect(recordEyesTest(directory, second.close())).rejects.toThrow(
        'already has a journal',
      );

      // And the reset the message names is what makes the id writable again.
      await resetEyesJournals(directory);
      const third = watchTest(screen, { id: 'suite > twice', title: 'twice' });
      await expect(recordEyesTest(directory, third.close())).resolves.toContain('.va-eyes.json');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('refuses a journal directory that is not there instead of reporting no tests', async () => {
    await expect(gatherEyesArchive(join(tmpdir(), 'variance-eyes-never-written'))).rejects.toThrow(
      'cannot read eyes journal directory',
    );
  });

  it('refuses a journal the reader would refuse, at the run that wrote it', async () => {
    const directory = await journalDirectory();
    try {
      await writeFile(join(directory, 'broken.va-eyes.json'), '{"eyesVersion":2}\n', 'utf8');
      await expect(gatherEyesArchive(directory)).rejects.toThrow('cannot read eyes journal');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('writes the journal as JSON a reader parses without this package', async () => {
    const directory = await journalDirectory();
    try {
      const attention = watchTest(screen, { id: 'suite > plain json', title: 'plain json' });
      const path = await recordEyesTest(directory, attention.close());
      const parsed = JSON.parse(await readFile(path, 'utf8')) as { eyesVersion: number };
      expect(parsed.eyesVersion).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
