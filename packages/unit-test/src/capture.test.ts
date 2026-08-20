// @vitest-environment jsdom
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { capture } from './capture.js';
import { captureFiles, readCapture, writeCapture } from './archive.js';
import { captureCollector } from './collector.js';

const VIEWPORT = {
  width: 320,
  height: 200,
  deviceScaleFactor: 1,
  colorScheme: 'light',
} as const;

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

function mount(html: string): Element {
  document.body.innerHTML = html;
  return document.body.firstElementChild!;
}

describe('browserless capture archive', () => {
  it('writes a resource-closed document that a later collector can read', async () => {
    const root = mount('<button style="color:rgb(255, 0, 0)">Save</button>');
    const artifact = await capture(root, {
      subject: 'button/save',
      viewport: VIEWPORT,
    });
    const directory = await mkdtemp(join(tmpdir(), 'variance-unit-'));
    temporary.push(directory);

    const path = await writeCapture(directory, artifact);
    expect((await readCapture(path)).material).toMatchObject({ kind: 'document' });

    const collector = await captureCollector({ directory })({
      config: { viewport: VIEWPORT },
    });
    const plan = await collector.plan();
    const collected = await collector.collect(plan.subjects[0]!);

    expect(plan.subjects.map((entry) => entry.subject.id)).toEqual(['button/save']);
    expect(collected).toMatchObject({
      ok: true,
      document: { resources: {}, subject: { id: 'button/save' } },
    });
  });

  it('refuses an external resource unless its immutable bytes are supplied', async () => {
    const root = mount('<img src="https://assets.example/icon.svg">');

    await expect(
      capture(root, { subject: 'icon', viewport: VIEWPORT }),
    ).rejects.toThrow('supply resolveResource');

    const artifact = await capture(root, {
      subject: 'icon',
      viewport: VIEWPORT,
      resolveResource: async (url) =>
        url === 'https://assets.example/icon.svg'
          ? {
              contentType: 'image/svg+xml',
              bytes: new TextEncoder().encode(
                '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
              ),
            }
          : null,
    });

    expect(
      artifact.material.kind === 'document'
        ? Object.keys(artifact.material.document.resources ?? {})
        : [],
    ).toEqual(['https://assets.example/icon.svg']);
  });

  it('refuses an archive whose version is not understood', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'variance-unit-'));
    temporary.push(directory);
    const path = join(directory, 'broken.va-capture.json');
    await writeFile(path, '{"artifactVersion":2}\n', 'utf8');

    await expect(readCapture(path)).rejects.toThrow('not a capture artifact version 1');
  });

  it('refuses malformed required and optional archive fields', async () => {
    const artifact = await capture(mount('<button>Save</button>'), {
      subject: 'button/malformed',
      viewport: VIEWPORT,
    });
    const directory = await mkdtemp(join(tmpdir(), 'variance-unit-'));
    temporary.push(directory);

    const malformedViewport = structuredClone(artifact) as unknown as {
      material: { document: { viewport: { width: unknown } } };
    };
    malformedViewport.material.document.viewport.width = '320';
    const viewportPath = join(directory, 'viewport.va-capture.json');
    await writeFile(viewportPath, JSON.stringify(malformedViewport), 'utf8');
    await expect(readCapture(viewportPath)).rejects.toThrow('resource-closed render document');

    const malformedSource = { ...artifact, source: { Button: [{ file: 42 }] } };
    const sourcePath = join(directory, 'source.va-capture.json');
    await writeFile(sourcePath, JSON.stringify(malformedSource), 'utf8');
    await expect(readCapture(sourcePath)).rejects.toThrow('invalid source index');

    const malformedAttempt = { ...artifact, attempt: { retry: 0, repeat: -1 } };
    const attemptPath = join(directory, 'attempt.va-capture.json');
    await writeFile(attemptPath, JSON.stringify(malformedAttempt), 'utf8');
    await expect(readCapture(attemptPath)).rejects.toThrow('invalid capture attempt');

    const malformedNested = structuredClone(artifact) as unknown as {
      snapshot: { ignoreSites: unknown; root: { rect: unknown } };
    };
    malformedNested.snapshot.ignoreSites = 'not-an-array';
    const ignorePath = join(directory, 'ignore.va-capture.json');
    await writeFile(ignorePath, JSON.stringify(malformedNested), 'utf8');
    await expect(readCapture(ignorePath)).rejects.toThrow('invalid semantic snapshot');

    malformedNested.snapshot.ignoreSites = [];
    malformedNested.snapshot.root.rect = { x: 0, y: 0, width: 'wide', height: 1 };
    const nodePath = join(directory, 'node.va-capture.json');
    await writeFile(nodePath, JSON.stringify(malformedNested), 'utf8');
    await expect(readCapture(nodePath)).rejects.toThrow('invalid semantic snapshot');
  });
});

/**
 * One subject id, one capture, and a refusal for the second.
 *
 * The filename is the subject id, so two tests capturing `button/save` address
 * one file. The README has always said this is an error; `rename` made it a
 * silent last-write-wins, which means half a suite disappearing from a run that
 * reports green over the half that remained.
 */
describe('a colliding subject id', () => {
  async function captureInto(directory: string, html: string): Promise<void> {
    await writeCapture(
      directory,
      await capture(mount(html), { subject: 'button/save', viewport: VIEWPORT }),
    );
  }

  it('refuses the second write and names the file both wanted', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'variance-unit-'));
    temporary.push(directory);

    await captureInto(directory, '<button>Save</button>');

    await expect(captureInto(directory, '<button>Store</button>')).rejects.toThrow(
      'already has a capture at',
    );
  });

  it('leaves the first capture as the one on disk', async () => {
    // The point of refusing rather than overwriting: the earlier subject is
    // still there to be rendered, and the run reads it rather than missing it.
    const directory = await mkdtemp(join(tmpdir(), 'variance-unit-'));
    temporary.push(directory);

    await captureInto(directory, '<button>Save</button>');
    await captureInto(directory, '<button>Store</button>').catch(() => undefined);

    const files = await captureFiles(directory);
    expect(files).toHaveLength(1);
    const artifact = await readCapture(files[0]!);
    expect(
      artifact.material.kind === 'document' ? artifact.material.document.html : '',
    ).toContain('Save');
  });

  it('leaves no temporary file behind when it refuses', async () => {
    // The write lands under a `.tmp` name before it is published. A refusal that
    // left it there would put a file in the handoff directory that the next
    // `captureFiles` cannot explain and nothing will ever remove.
    const directory = await mkdtemp(join(tmpdir(), 'variance-unit-'));
    temporary.push(directory);

    await captureInto(directory, '<button>Save</button>');
    await captureInto(directory, '<button>Store</button>').catch(() => undefined);

    expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});
