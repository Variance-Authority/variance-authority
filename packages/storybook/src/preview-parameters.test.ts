import { describe, expect, it } from 'vitest';
import { readParameters, type StoryPage } from './preview.js';

/**
 * Reading every story's parameters imports every story file, so the page is
 * loaded again before the stories are shown on it. The order is the claim: a
 * load before the read would leave the imports in place, and no load at all
 * would hand each file's first story an import already done.
 */

const ADDRESS = 'http://localhost:6006/iframe.html?id=a--one&viewMode=story';

describe('reading the parameters of every story', () => {
  it('answers from the document it read, then loads that address again', async () => {
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
    expect(calls).toEqual(['read variance', `goto ${ADDRESS}`]);
  });
});
