import { describe, expect, it } from 'vitest';
import { readParameters, type StoryPage } from './preview.js';

/**
 * Reading every story's parameters costs one `extract()` and nothing else. A
 * load after it would cost the run a preview boot before its first story; the
 * caller keeps the read off the stories' page instead.
 */

const ADDRESS = 'http://localhost:6006/iframe.html?id=a--one&viewMode=story';

describe('reading the parameters of every story', () => {
  it('answers from the document it was handed, and loads nothing', async () => {
    const calls: string[] = [];
    const page: StoryPage = {
      url: () => ADDRESS,
      goto: async (url) => void calls.push(`goto ${url}`),
      evaluate: async <A, R>(_fn: (argument: A) => R | Promise<R>, argument: A) => {
        calls.push(`read ${String(argument)}`);
        return { parameters: { 'a--one': { widths: [375] } } } as R;
      },
    };

    expect(await readParameters(page)).toEqual({ parameters: { 'a--one': { widths: [375] } } });
    expect(calls).toEqual(['read variance']);
  });
});
