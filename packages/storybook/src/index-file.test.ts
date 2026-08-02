import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseStoryIndex } from './index-file.js';
import { readStoryIndex } from './read.js';

/**
 * The reader, against files shaped like the ones Storybook writes.
 *
 * These fixtures are hand-written from the documented index formats, not
 * captured from a running Storybook — see the package report. What they can
 * check is the half that matters most here anyway: that a file which is *not* an
 * index is refused rather than half-parsed, and that everything not turned into
 * a subject is named. A reader that quietly returned fewer subjects would make
 * every downstream verdict a statement about a suite nobody chose.
 */

const fixture = (name: string): string =>
  fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url));

describe('reading a v4/v5 index', () => {
  it('takes every story entry the index declares as a subject', async () => {
    // Acceptance 1: the subject list is the index, with no fixture file in it.
    const index = await readStoryIndex(fixture('index-v5.json'));

    expect(index.shape).toBe('entries');
    expect(index.version).toBe(5);
    expect(index.stories.map((story) => story.id)).toEqual([
      'layout-stack--basic',
      'components-button--primary',
      'components-alert--danger',
      'components-button--disabled',
    ]);
  });

  it('preserves the file order, leaving ordering to the subject mapper', async () => {
    // The reader reports what the file says. Ordering is a policy decision with
    // consequences (ADR-0009 attributes pollution to the earlier subject), and
    // burying it here would put it out of reach of the code that owns it.
    const index = await readStoryIndex(fixture('index-v5.json'));
    expect(index.stories[0]?.id).toBe('layout-stack--basic');
  });

  it('carries the fields a report needs to name a subject and open its file', async () => {
    const index = await readStoryIndex(fixture('index-v5.json'));
    const story = index.stories.find((candidate) => candidate.id === 'components-button--primary');

    expect(story).toEqual({
      id: 'components-button--primary',
      title: 'Components/Button',
      name: 'Primary',
      importPath: './src/components/Button.stories.tsx',
      componentPath: './src/components/Button.tsx',
      tags: ['dev', 'test', 'autodocs'],
    });
  });

  it('reports a docs entry as excluded rather than dropping it', async () => {
    // A docs page is prose, not a render. Filtering it silently would leave the
    // difference between "this index has 4 stories" and "this reader ignored
    // one" invisible to whoever is counting.
    const index = await readStoryIndex(fixture('index-v5.json'));

    expect(index.excluded).toHaveLength(1);
    expect(index.excluded[0]?.id).toBe('components-button--docs');
    expect(index.excluded[0]?.reason).toContain('docs');
  });

  it('reports an entry type it has never seen as excluded, not as a story', async () => {
    // Forward compatibility that does not invent: an unfamiliar `type` is
    // well-formed and unrenderable, so it is named and skipped. Guessing "story"
    // would put something unmountable into the suite.
    const index = await readStoryIndex(fixture('index-future-version.json'));

    expect(index.stories.map((story) => story.id)).toEqual(['components-button--primary']);
    expect(index.excluded[0]?.id).toBe('components-button--experiment');
    expect(index.excluded[0]?.reason).toContain('experiment');
  });

  it('warns about a version it was not written against instead of refusing it', async () => {
    // The shape is readable; only the number is unfamiliar. Refusing would break
    // on a Storybook release that changed nothing this adapter reads.
    const index = await readStoryIndex(fixture('index-future-version.json'));

    expect(index.warnings.join(' ')).toContain('version 6');
    expect(index.stories).toHaveLength(1);
  });
});

describe('reading the older stories shape', () => {
  it('reads a v3 index the same way it reads a v5 one', async () => {
    const index = await readStoryIndex(fixture('stories-v3.json'));

    expect(index.shape).toBe('stories');
    expect(index.stories.map((story) => story.id)).toEqual([
      'components-button--primary',
      'foundations-colors--overview',
    ]);
  });

  it('accepts kind/story/parameters.fileName as the pre-v4 spellings', async () => {
    // An index written before v4 has no title, name, or importPath. Refusing it
    // for missing fields that never existed would reject a whole real format.
    const index = await readStoryIndex(fixture('stories-v3.json'));
    const story = index.stories.find((candidate) => candidate.id === 'foundations-colors--overview');

    expect(story?.title).toBe('Foundations/Colors');
    expect(story?.name).toBe('Overview');
    expect(story?.importPath).toBe('./src/foundations/Colors.stories.js');
  });

  it('reports a docsOnly entry as excluded, which is how v3 marks a docs page', async () => {
    const index = await readStoryIndex(fixture('stories-v3.json'));

    expect(index.excluded.map((entry) => entry.id)).toEqual(['components-button--page']);
    expect(index.excluded[0]?.reason).toContain('docs');
  });

  it('defaults tags to an empty list rather than leaving them absent', async () => {
    // The older shape has no tags at all. Absent-vs-empty would push a null
    // check into every consumer of a field that is never meaningfully unknown.
    const index = await readStoryIndex(fixture('stories-v3.json'));
    expect(index.stories[0]?.tags).toEqual([]);
  });
});

describe('refusing files that are not story indexes', () => {
  it('refuses a Storybook config instead of parsing its glob list', async () => {
    // `.storybook/main`'s `stories` is an array of globs. It passes a shallow
    // "has a stories key" check and yields zero subjects — a green run over
    // nothing, which is the worst available outcome.
    await expect(readStoryIndex(fixture('not-an-index-config.json'))).rejects.toThrow(
      /`stories` is an array/,
    );
  });

  it('refuses a file with neither entries nor stories, listing what it did have', async () => {
    // The message has to be actionable: whoever pointed this at the wrong file
    // needs to see which file they pointed it at.
    await expect(readStoryIndex(fixture('not-an-index-manifest.json'))).rejects.toThrow(
      /neither an `entries` object .* nor a `stories` object/s,
    );
  });

  it('refuses an entry missing importPath rather than inventing one', async () => {
    // importPath is the only route from a changed subject back to a file an
    // agent will open. An invented one sends it to edit the wrong module with
    // full confidence.
    await expect(readStoryIndex(fixture('index-malformed-entry.json'))).rejects.toThrow(
      /components-button--secondary.*importPath/s,
    );
  });

  it('says where a missing index comes from instead of only that it is missing', async () => {
    // ENOENT is the likeliest first encounter with this adapter, and "no such
    // file" does not tell anybody that a Storybook has to be built first.
    await expect(readStoryIndex(fixture('nonexistent.json'))).rejects.toThrow(/storybook build/);
  });

  it('refuses the preview shell, which is the file next door', async () => {
    // `iframe.html` sits beside `index.json` in every built Storybook, so it is
    // the wrong file most likely to be handed to this function. The message has
    // to name the path and say what went wrong, because `Unexpected token <` on
    // its own has sent a great many people to the wrong problem.
    await expect(readStoryIndex(fixture('iframe.html'))).rejects.toThrow(/iframe\.html is not JSON/);
  });

  it('refuses an entry whose id disagrees with its key', async () => {
    // The key addresses the story in the preview; the id keys the baseline. When
    // they disagree one of them names a subject that never renders, and nothing
    // in the file says which.
    expect(() =>
      parseStoryIndex(
        {
          v: 5,
          entries: {
            'components-button--primary': {
              type: 'story',
              id: 'components-button--secondary',
              name: 'Primary',
              title: 'Components/Button',
              importPath: './Button.stories.tsx',
            },
          },
        },
        'inline',
      ),
    ).toThrow(/must agree/);
  });

  it('refuses an entry with no type, which every v4/v5 entry has', () => {
    expect(() =>
      parseStoryIndex(
        { v: 5, entries: { 'a--b': { id: 'a--b', name: 'B', title: 'A', importPath: './a.tsx' } } },
        'inline',
      ),
    ).toThrow(/no string `type`/);
  });

  it('refuses an index whose entries are empty, which is what a build that found nothing writes', () => {
    // Zero subjects exits green. A project whose glob stopped matching would
    // otherwise get a passing run for a suite that no longer exists.
    expect(() => parseStoryIndex({ v: 5, entries: {} }, 'inline')).toThrow(/no entries at all/);
  });

  it('refuses a top level that is not an object', () => {
    expect(() => parseStoryIndex([], 'inline')).toThrow(/not an object/);
  });
});

describe('warnings that are not refusals', () => {
  it('says when a declared version and the shape present disagree', () => {
    // Read anyway — the shape is what can actually be parsed — but a v3 file
    // carrying v5's key is a file somebody assembled by hand, and that is worth
    // one line in a report.
    const index = parseStoryIndex(
      {
        v: 3,
        entries: {
          'a--b': { type: 'story', id: 'a--b', name: 'B', title: 'A', importPath: './a.tsx' },
        },
      },
      'inline',
    );

    expect(index.shape).toBe('entries');
    expect(index.warnings.join(' ')).toContain('whose shape is `stories`');
  });

  it('says when an index declares no version', () => {
    const index = parseStoryIndex(
      { entries: { 'a--b': { type: 'story', id: 'a--b', name: 'B', title: 'A', importPath: './a.tsx' } } },
      'inline',
    );

    expect(index.version).toBeUndefined();
    expect(index.warnings.join(' ')).toContain('declares no `v`');
  });

  it('prefers entries when a file carries both keys, and says so', () => {
    const index = parseStoryIndex(
      {
        v: 5,
        entries: { 'a--b': { type: 'story', id: 'a--b', name: 'B', title: 'A', importPath: './a.tsx' } },
        stories: { 'c--d': { id: 'c--d', name: 'D', title: 'C', importPath: './c.tsx' } },
      },
      'inline',
    );

    expect(index.stories.map((story) => story.id)).toEqual(['a--b']);
    expect(index.warnings.join(' ')).toContain('both');
  });
});
